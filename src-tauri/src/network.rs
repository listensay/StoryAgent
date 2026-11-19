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
    fn begin(&mut self, id: &str, sender: watch::Sender<bool>) -> Result<(), String> {
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
    provider_id: Option<String>,
    key_header: Option<String>,
    key_prefix: Option<String>,
    stream: bool,
    binary: bool,
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
        let client = reqwest::Client::builder().timeout(Duration::from_secs(600)).connect_timeout(Duration::from_secs(20)).redirect(if request.provider_id.is_some() { reqwest::redirect::Policy::none() } else { reqwest::redirect::Policy::limited(5) }).build().map_err(|e| e.to_string())?;
        let method = request.method.parse::<reqwest::Method>().map_err(|_| "请求方法无效")?;
        let mut builder = client.request(method, url);
        for (key, value) in &request.headers { builder = builder.header(key, value); }
        if let Some(id) = &request.provider_id {
            match crate::storage::credential(id)?.get_password() {
                Ok(key) => { builder = builder.header(request.key_header.as_deref().unwrap_or("Authorization"), format!("{}{}", request.key_prefix.as_deref().unwrap_or("Bearer "), key)); }
                Err(keyring::Error::NoEntry) => {}
                Err(e) => return Err(format!("读取密钥失败：{e}")),
            }
        }
        if let Some(body) = &request.body { builder = builder.body(body.clone()); }
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    title: String,
    text: String,
    links: Vec<PageLink>,
}
#[derive(Serialize)]
pub struct PageLink {
    title: String,
    url: String,
}

#[tauri::command]
pub async fn fetch_page(url: String) -> Result<Page, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "网址无效")?;
    if !["http", "https"].contains(&parsed.scheme()) {
        return Err("网址无效".into());
    }
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?
        .get(parsed.clone())
        .header("User-Agent", "StoryAgent/0.1")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("采集失败：HTTP {}", response.status()));
    }
    let page_url = response.url().clone();
    let mut stream = response.bytes_stream();
    let mut bytes = vec![];
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() + chunk.len() > 5 * 1024 * 1024 {
            return Err("页面超过 5 MB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let html = String::from_utf8_lossy(&bytes);
    let document = scraper::Html::parse_document(&html);
    let selector = |s| scraper::Selector::parse(s).map_err(|_| "页面解析失败".to_string());
    let title = document
        .select(&selector("title")?)
        .next()
        .map(|el| el.text().collect::<String>())
        .unwrap_or_default();
    let text = document
        .select(&selector("body")?)
        .next()
        .map(|body| {
            body.descendants()
                .filter_map(|node| {
                    let text = node.value().as_text()?;
                    if node.ancestors().any(|parent| {
                        parent.value().as_element().is_some_and(|el| {
                            ["script", "style", "nav", "footer", "header", "noscript"]
                                .contains(&el.name())
                        })
                    }) {
                        return None;
                    }
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();
    let links = document
        .select(&selector("a[href]")?)
        .filter_map(|el| {
            let title = el.text().collect::<String>().trim().to_string();
            let url = page_url.join(el.value().attr("href")?).ok()?;
            if title.is_empty() || !["https", "http"].contains(&url.scheme()) {
                return None;
            }
            Some(PageLink {
                title,
                url: url.to_string(),
            })
        })
        .take(300)
        .collect();
    Ok(Page {
        title,
        text: text.chars().take(120_000).collect(),
        links,
    })
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
