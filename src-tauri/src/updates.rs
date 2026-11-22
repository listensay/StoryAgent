use reqwest::{Client, StatusCode, Url};
use std::time::Duration;
use tauri::AppHandle;

fn github_repository(endpoint: &Url) -> Option<String> {
    if endpoint.scheme() != "https" || endpoint.host_str() != Some("github.com") {
        return None;
    }
    let segments: Vec<_> = endpoint.path_segments()?.collect();
    if segments.len() != 6 || segments[2..] != ["releases", "latest", "download", "latest.json"] {
        return None;
    }
    Some(format!("{}/{}", segments[0], segments[1]))
}

fn response_error(status: StatusCode) -> String {
    match status {
        StatusCode::FORBIDDEN | StatusCode::TOO_MANY_REQUESTS => "更新检查请求受限，请稍后重试".into(),
        status if status.is_server_error() => "更新服务器暂时不可用".into(),
        _ => format!("更新服务器响应异常（HTTP {}）", status.as_u16()),
    }
}

async fn status(client: &Client, url: Url) -> Result<StatusCode, String> {
    client.get(url).send().await.map(|response| response.status()).map_err(|error| {
        if error.is_timeout() { "更新检查超时".into() } else { "无法连接更新服务器".into() }
    })
}

async fn missing_github_release(client: &Client, api: &Url, repository: &str) -> Result<String, String> {
    let latest = api.join(&format!("repos/{repository}/releases/latest")).map_err(|_| "更新地址无效")?;
    let latest_status = status(client, latest).await?;
    if latest_status.is_success() { return Err("更新信息尚未发布".into()); }
    if latest_status != StatusCode::NOT_FOUND { return Err(response_error(latest_status)); }
    let repository_url = api.join(&format!("repos/{repository}")).map_err(|_| "更新地址无效")?;
    let repository_status = status(client, repository_url).await?;
    if repository_status.is_success() { return Ok("unpublished".into()); }
    if repository_status == StatusCode::NOT_FOUND { return Err("更新仓库不可访问".into()); }
    Err(response_error(repository_status))
}

#[tauri::command]
pub async fn diagnose_update_source(app: AppHandle) -> Result<String, String> {
    let config = &app.config().plugins.0;
    let endpoint = config.get("updater").and_then(|updater| updater.get("endpoints"))
        .and_then(|endpoints| endpoints.get(0)).and_then(|endpoint| endpoint.as_str()).ok_or("更新地址未配置")?;
    let endpoint = Url::parse(endpoint).map_err(|_| "更新地址无效")?;
    let client = Client::builder().user_agent("StoryAgent-Updater")
        .timeout(Duration::from_secs(10)).connect_timeout(Duration::from_secs(5))
        .build().map_err(|_| "无法连接更新服务器")?;
    let source_status = status(&client, endpoint.clone()).await?;
    if source_status == StatusCode::NOT_FOUND {
        if let Some(repository) = github_repository(&endpoint) {
            return missing_github_release(&client, &Url::parse("https://api.github.com/").unwrap(), &repository).await;
        }
        return Err("更新信息尚未发布".into());
    }
    if source_status.is_success() { return Err("更新信息无效".into()); }
    Err(response_error(source_status))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::{Read, Write}, net::TcpListener, thread};

    fn api_fixture(responses: Vec<(String, u16)>) -> (Url, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = Url::parse(&format!("http://{}/", listener.local_addr().unwrap())).unwrap();
        let handle = thread::spawn(move || {
            for (path, code) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = [0; 4096];
                let count = stream.read(&mut request).unwrap();
                assert!(String::from_utf8_lossy(&request[..count]).starts_with(&format!("GET {path} ")));
                write!(stream, "HTTP/1.1 {code} Status\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}").unwrap();
            }
        });
        (url, handle)
    }

    #[test]
    fn recognizes_only_the_configured_github_latest_manifest_pattern() {
        assert_eq!(github_repository(&Url::parse("https://github.com/listensay/StoryAgent/releases/latest/download/latest.json").unwrap()).as_deref(), Some("listensay/StoryAgent"));
        for url in ["https://github.com/owner/repo/releases/download/v1/latest.json", "https://example.com/owner/repo/releases/latest/download/latest.json", "https://github.com/owner/repo"] {
            assert!(github_repository(&Url::parse(url).unwrap()).is_none());
        }
    }

    #[tokio::test]
    async fn distinguishes_an_empty_public_repository_from_a_release_missing_its_manifest() {
        let client = Client::builder().no_proxy().build().unwrap();
        let (api, server) = api_fixture(vec![("/repos/owner/repo/releases/latest".into(), 404), ("/repos/owner/repo".into(), 200)]);
        assert_eq!(missing_github_release(&client, &api, "owner/repo").await.unwrap(), "unpublished");
        server.join().unwrap();
        let (api, server) = api_fixture(vec![("/repos/owner/repo/releases/latest".into(), 200)]);
        assert_eq!(missing_github_release(&client, &api, "owner/repo").await.unwrap_err(), "更新信息尚未发布");
        server.join().unwrap();
    }

    #[tokio::test]
    async fn keeps_permission_rate_limit_and_server_failures_as_errors() {
        let client = Client::builder().no_proxy().build().unwrap();
        for (responses, message) in [
            (vec![("/repos/owner/repo/releases/latest".into(), 404), ("/repos/owner/repo".into(), 404)], "更新仓库不可访问"),
            (vec![("/repos/owner/repo/releases/latest".into(), 403)], "更新检查请求受限，请稍后重试"),
            (vec![("/repos/owner/repo/releases/latest".into(), 503)], "更新服务器暂时不可用"),
        ] {
            let (api, server) = api_fixture(responses);
            assert_eq!(missing_github_release(&client, &api, "owner/repo").await.unwrap_err(), message);
            server.join().unwrap();
        }
    }
}
