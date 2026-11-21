use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::watch;

#[derive(Default)]
pub struct Requests(pub Mutex<RequestState>);
#[derive(Default)]
pub struct RequestState {
    active: HashMap<String, watch::Sender<bool>>,
    cancelled: HashMap<String, Instant>,
}
impl RequestState {
    pub(crate) fn begin(&mut self, id: &str, sender: watch::Sender<bool>) -> Result<(), String> {
        self.cancelled
            .retain(|_, time| time.elapsed() < Duration::from_secs(60));
        if self.cancelled.remove(id).is_some() {
            return Err("请求已停止".into());
        }
        if self.active.contains_key(id) {
            return Err("重复的请求标识".into());
        }
        self.active.insert(id.to_string(), sender);
        Ok(())
    }
    pub(crate) fn finish(&mut self, id: &str) {
        self.active.remove(id);
    }
    fn cancel(&mut self, id: String) {
        if let Some(sender) = self.active.get(&id) {
            let _ = sender.send(true);
        } else {
            self.cancelled
                .retain(|_, time| time.elapsed() < Duration::from_secs(60));
            if self.cancelled.len() < 1000 {
                self.cancelled.insert(id, Instant::now());
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpRequest {
    id: String,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    form: Option<Multipart>,
    provider_id: Option<String>,
    key_header: Option<String>,
    key_prefix: Option<String>,
    stream: bool,
    binary: bool,
}

#[derive(Deserialize)]
struct Multipart {
    fields: HashMap<String, String>,
    files: Vec<MultipartFile>,
}

#[derive(Deserialize)]
struct MultipartFile {
    field: String,
    name: String,
    mime: String,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    status: u16,
    text: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Chunk {
    id: String,
    bytes: Vec<u8>,
}

#[tauri::command]
pub fn cancel_http(id: String, state: State<'_, Requests>) -> Result<(), String> {
    state.0.lock().map_err(|_| "请求状态不可用")?.cancel(id);
    Ok(())
}

#[tauri::command]
pub async fn http_request(
    app: AppHandle,
    state: State<'_, Requests>,
    request: HttpRequest,
) -> Result<HttpResponse, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|_| "API 地址无效")?;
    if !["https", "http"].contains(&url.scheme()) {
        return Err("仅支持 HTTP 或 HTTPS 地址".into());
    }
    let (sender, mut cancel) = watch::channel(false);
    {
        let mut requests = state.0.lock().map_err(|_| "请求状态不可用")?;
        requests.begin(&request.id, sender)?;
    }
    let result = async {
        let authenticated = request.provider_id.is_some() || request.headers.keys().any(|key| ["authorization", "x-api-key", "x-goog-api-key"].iter().any(|name| key.eq_ignore_ascii_case(name)));
        let client = reqwest::Client::builder().timeout(Duration::from_secs(600)).connect_timeout(Duration::from_secs(20)).redirect(if authenticated { reqwest::redirect::Policy::none() } else { reqwest::redirect::Policy::limited(5) }).build().map_err(|e| e.to_string())?;
        let method = request.method.parse::<reqwest::Method>().map_err(|_| "请求方法无效")?;
        let mut builder = client.request(method, url);
        for (key, value) in &request.headers { builder = builder.header(key, value); }
        if let Some(id) = &request.provider_id {
            if let Some(key) = crate::storage::provider_key(id)? {
                builder = builder.header(request.key_header.as_deref().unwrap_or("Authorization"), format!("{}{}", request.key_prefix.as_deref().unwrap_or("Bearer "), key));
            }
        }
        if let Some(body) = &request.body { builder = builder.body(body.clone()); }
        if let Some(form) = &request.form {
            let mut multipart = reqwest::multipart::Form::new();
            for (name, value) in &form.fields { multipart = multipart.text(name.clone(), value.clone()); }
            let mut total = 0;
            for file in &form.files {
                total += file.bytes.len();
                if total > 20 * 1024 * 1024 { return Err("图片超过 20 MB".into()); }
                let part = reqwest::multipart::Part::bytes(file.bytes.clone()).file_name(file.name.clone()).mime_str(&file.mime).map_err(|_| "图片类型无效")?;
                multipart = multipart.part(file.field.clone(), part);
            }
            builder = builder.multipart(multipart);
        }
        let response = tokio::select! { result = builder.send() => result.map_err(|e| format!("请求失败：{e}"))?, _ = cancel.changed() => return Err("请求已停止".into()) };
        let status = response.status().as_u16();
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        loop {
            let part = tokio::select! { part = stream.next() => part, _ = cancel.changed() => return Err("请求已停止".into()) };
            let Some(part) = part else { break };
            let part = part.map_err(|e| e.to_string())?;
            if bytes.len() + part.len() > 20 * 1024 * 1024 { return Err("响应超过 20 MB".into()); }
            if request.stream && status < 300 { let _ = app.emit("http-chunk", Chunk { id: request.id.clone(), bytes: part.to_vec() }); }
            bytes.extend_from_slice(&part);
        }
        Ok(HttpResponse { status, text: if request.binary { String::new() } else { String::from_utf8_lossy(&bytes).into_owned() }, bytes: if request.binary { bytes } else { vec![] } })
    }.await;
    state
        .0
        .lock()
        .map_err(|_| "请求状态不可用")?
        .active
        .remove(&request.id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_before_registration_is_retained() {
        let mut state = RequestState::default();
        state.cancel("early".into());
        let (tx, _) = watch::channel(false);
        assert_eq!(state.begin("early", tx).unwrap_err(), "请求已停止");
        assert!(state.active.is_empty());
    }
    #[test]
    fn cancellation_wakes_registered_request() {
        let mut state = RequestState::default();
        let (tx, rx) = watch::channel(false);
        state.begin("live", tx).unwrap();
        state.cancel("live".into());
        assert!(*rx.borrow());
    }
}
