use crate::network::Requests;
use encoding_rs::{Encoding, GBK, UTF_8};
use futures_util::StreamExt;
use reqwest::{Client, Url};
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, error::Error, time::Duration};
use tauri::State;
use tokio::sync::watch;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleRule {
    name: String,
    site_url: String,
    encoding: String,
    catalog_title_selector: String,
    chapter_link_selector: String,
    chapter_title_selector: String,
    content_selector: String,
    exclude_selector: String,
    #[serde(default)]
    catalog_link_selector: String,
    #[serde(default)]
    search: Option<BookSearchRule>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BookSearchRule {
    url: String,
    method: String,
    body: String,
    encoding: String,
    result_selector: String,
    title_selector: String,
    link_selector: String,
    author_selector: String,
    intro_selector: String,
    next_selector: String,
    empty_selector: String,
}
#[derive(Debug, Serialize)]
pub struct SearchBook {
    title: String,
    author: String,
    intro: String,
    url: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSearchPage {
    books: Vec<SearchBook>,
    has_more: bool,
}
#[derive(Debug, Serialize)]
pub struct ChapterLink {
    title: String,
    url: String,
}
#[derive(Debug, Serialize)]
pub struct ArticlePage {
    title: String,
    url: String,
    text: String,
    chapters: Vec<ChapterLink>,
}

fn selector(value: &str) -> Result<Selector, String> {
    if value.trim().is_empty() {
        return Err("请填写 CSS 选择器".into());
    }
    Selector::parse(value).map_err(|_| format!("CSS 选择器无效：{value}"))
}
fn site_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "网址无效")?;
    if !["https", "http"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("请填写有效的 HTTP 或 HTTPS 网址".into());
    }
    Ok(url)
}
fn same_site(url: &Url, site: &Url) -> bool {
    url.host_str().map(|h| h.trim_start_matches("www."))
        == site.host_str().map(|h| h.trim_start_matches("www."))
        && url.port() == site.port()
        && ["http", "https"].contains(&url.scheme())
        && url.username().is_empty()
        && url.password().is_none()
}
#[tauri::command]
pub fn validate_article_rule(rule: ArticleRule) -> Result<(), String> {
    if rule.name.trim().is_empty() {
        return Err("请填写规则名称".into());
    }
    site_url(&rule.site_url)?;
    if !["auto", "utf-8", "gbk"].contains(&rule.encoding.as_str()) {
        return Err("页面编码无效".into());
    }
    for value in [
        &rule.catalog_title_selector,
        &rule.chapter_link_selector,
        &rule.chapter_title_selector,
        &rule.content_selector,
    ] {
        selector(value)?;
    }
    if !rule.exclude_selector.trim().is_empty() {
        selector(&rule.exclude_selector)?;
    }
    if !rule.catalog_link_selector.trim().is_empty() {
        selector(&rule.catalog_link_selector)?;
    }
    if let Some(search) = &rule.search {
        search_request(&rule, "样本", 1)?;
        for value in [&search.result_selector, &search.title_selector, &search.link_selector] {
            selector(value)?;
        }
        for value in [&search.author_selector, &search.intro_selector, &search.next_selector, &search.empty_selector] {
            if !value.trim().is_empty() { selector(value)?; }
        }
    }
    Ok(())
}
fn charset(value: &str) -> Option<&'static Encoding> {
    let lower = value.to_ascii_lowercase();
    let value = lower
        .split("charset=")
        .nth(1)?
        .trim_start_matches(['\'', '"', ' ']);
    Encoding::for_label(value.split([';', ' ', '"', '\'', '>']).next()?.as_bytes())
}
fn decode(bytes: &[u8], content_type: &str, encoding: &str) -> Result<String, String> {
    let selected = match encoding {
        "utf-8" => UTF_8,
        "gbk" => GBK,
        _ => {
            if let Some((enc, _)) = Encoding::for_bom(bytes) {
                enc
            } else if let Some(enc) = charset(content_type) {
                enc
            } else {
                let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
                charset(&head).unwrap_or_else(|| {
                    if std::str::from_utf8(bytes).is_ok() {
                        UTF_8
                    } else {
                        GBK
                    }
                })
            }
        }
    };
    let (text, _, errors) = selected.decode(bytes);
    if errors {
        return Err("页面解码失败，请检查规则中的页面编码".into());
    }
    Ok(text.into_owned())
}
pub(crate) fn text_content(element: ElementRef<'_>, excluded: &Selector, output: &mut String) {
    if excluded.matches(&element) {
        return;
    }
    let block =
        ["p", "div", "br", "section", "li", "h1", "h2", "h3"].contains(&element.value().name());
    if block {
        output.push('\n');
    }
    for child in element.children() {
        if let Some(text) = child.value().as_text() {
            output.push_str(text);
        } else if let Some(element) = ElementRef::wrap(child) {
            text_content(element, excluded, output);
        }
    }
    if block {
        output.push('\n');
    }
}
fn check_page(html: &str) -> Result<(), String> {
    let doc = Html::parse_document(html);
    if doc.select(&selector("#challenge-form, #cf-challenge-running, .g-recaptcha")?).next().is_some()
        || html.contains("/cdn-cgi/challenge-platform/") {
        return Err("网站要求验证，暂时无法采集".into());
    }
    Ok(())
}
fn chapter_links(doc: &Html, url: &Url, rule: &ArticleRule, css: &str) -> Result<Vec<ChapterLink>, String> {
    let site = site_url(&rule.site_url)?;
    let mut seen = HashSet::new();
    let mut chapters = vec![];
    for link in doc.select(&selector(css)?) {
        let Some(href) = link.value().attr("href") else { continue; };
        if href.starts_with('#') { continue; }
        let Ok(mut target) = url.join(href) else { continue; };
        target.set_fragment(None);
        let title = link.text().collect::<String>().trim().to_string();
        if !same_site(&target, &site) || target == *url || title.is_empty() || !seen.insert(target.to_string()) { continue; }
        chapters.push(ChapterLink { title, url: target.to_string() });
    }
    if chapters.is_empty() { return Err("未找到章节，请填写目录网址或检查目录规则".into()); }
    Ok(chapters)
}
fn parse_page(
    html: &str,
    url: &Url,
    rule: &ArticleRule,
    mode: &str,
) -> Result<ArticlePage, String> {
    check_page(html)?;
    let doc = Html::parse_document(html);
    let title_selector = selector(if mode == "catalog" {
        &rule.catalog_title_selector
    } else {
        &rule.chapter_title_selector
    })?;
    let title = doc
        .select(&title_selector)
        .next()
        .map(|el| el.text().collect::<String>())
        .unwrap_or_default()
        .trim()
        .trim_end_matches("章节列表")
        .trim()
        .to_string();
    if title.is_empty() {
        return Err("未找到标题，请检查采集规则".into());
    }
    let mut result = ArticlePage {
        title,
        url: url.to_string(),
        text: String::new(),
        chapters: vec![],
    };
    if mode == "catalog" {
        result.chapters = chapter_links(&doc, url, rule, &rule.chapter_link_selector)?;
    } else {
        let content_selector = selector(&rule.content_selector)?;
        let content = doc
            .select(&content_selector)
            .next()
            .ok_or("未找到正文，请检查正文规则")?;
        let exclusions = format!(
            "script, style, noscript, iframe, nav, footer{}{}",
            if rule.exclude_selector.trim().is_empty() {
                ""
            } else {
                ", "
            },
            rule.exclude_selector
        );
        text_content(content, &selector(&exclusions)?, &mut result.text);
        result.text = result
            .text
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .collect::<Vec<_>>()
            .join("\n\n");
        if result.text.is_empty() {
            return Err("正文为空，请检查采集规则".into());
        }
        if result.text.chars().count() > 200_000 {
            return Err("单章正文超过 20 万字符".into());
        }
    }
    Ok(result)
}
enum PageFetchError {
    Network(reqwest::Error),
    Page(String),
}
impl From<String> for PageFetchError {
    fn from(message: String) -> Self { Self::Page(message) }
}
impl From<&str> for PageFetchError {
    fn from(message: &str) -> Self { Self::Page(message.into()) }
}
fn network_causes(error: &reqwest::Error) -> String {
    let mut causes = Vec::new();
    let mut source = error.source();
    while let Some(cause) = source {
        causes.push(cause.to_string());
        source = cause.source();
    }
    causes.join(": ")
}
impl PageFetchError {
    fn retryable(&self) -> bool {
        match self {
            Self::Network(error) => !error.is_builder() && !error.is_redirect()
                && !network_causes(error).to_ascii_lowercase().contains("certificate")
                && (error.is_timeout() || error.is_connect() || error.is_request() || error.is_body() || error.is_decode()),
            Self::Page(_) => false,
        }
    }
    fn message(self) -> String {
        match self {
            Self::Page(message) => message,
            Self::Network(error) => {
                // reqwest's Display omits the DNS/TLS/socket cause; keep it in desktop diagnostics.
                let causes = network_causes(&error);
                eprintln!("Article request failed: {error}: {causes}");
                let lower = causes.to_ascii_lowercase();
                let reason = if error.is_timeout() { "请求超时，请稍后重试" }
                    else if error.is_redirect() { "网站重定向异常" }
                    else if lower.contains("certificate") { "网站安全证书验证失败" }
                    else if lower.contains("dns") || lower.contains("resolve") || lower.contains("lookup address") { "无法解析网站域名，请检查网络连接" }
                    else if error.is_connect() { "无法连接网站，请检查网络连接或稍后重试" }
                    else { "网站连接中断，请稍后重试" };
                format!("采集失败：{reason}")
            }
        }
    }
}
async fn fetch_html(rule: &ArticleRule, url: Url, body: Option<String>, search: bool) -> Result<(String, Url), String> {
    let site = site_url(&rule.site_url)?;
    let client = crate::proxy::client_builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 {
                attempt.error("重定向次数过多")
            } else if same_site(attempt.url(), &site) {
                attempt.follow()
            } else {
                attempt.error("目标网址不属于当前采集网站")
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    fetch_html_with_client(&client, rule, url, body, search).await
}
async fn fetch_html_with_client(client: &Client, rule: &ArticleRule, url: Url, body: Option<String>, search: bool) -> Result<(String, Url), String> {
    // Space sequential chapter requests; cancellation also covers this wait.
    tokio::time::sleep(Duration::from_millis(600)).await;
    // These GETs and form POSTs only read public pages. Retry the whole response so
    // a dropped body cannot leave partial chapter text or duplicate paragraphs.
    for attempt in 0..3 {
        match fetch_html_once(client, rule, &url, body.as_deref(), search).await {
            Ok(page) => return Ok(page),
            Err(error) if attempt < 2 && error.retryable() => {
                tokio::time::sleep(Duration::from_secs(2 << attempt)).await;
            }
            Err(error) => return Err(error.message()),
        }
    }
    unreachable!()
}
async fn fetch_html_once(client: &Client, rule: &ArticleRule, url: &Url, body: Option<&str>, search: bool) -> Result<(String, Url), PageFetchError> {
    let request = if let Some(body) = body {
        client.post(url.clone()).header("Content-Type", "application/x-www-form-urlencoded").body(body.to_owned())
    } else { client.get(url.clone()) };
    let response = request
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(PageFetchError::Network)?;
    if response
        .headers()
        .get("cf-mitigated")
        .is_some_and(|h| h == "challenge")
    {
        return Err("网站要求验证，暂时无法采集".into());
    }
    let status = response.status();
    if !status.is_success() && !(search && status == reqwest::StatusCode::NOT_FOUND) {
        return Err(format!("采集失败：HTTP {}", status.as_u16()).into());
    }
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();
    let mut bytes = vec![];
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(PageFetchError::Network)?;
        if bytes.len() + chunk.len() > 5 * 1024 * 1024 {
            return Err("页面超过 5 MB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let html = decode(&bytes, &content_type, &rule.encoding)?;
    check_page(&html)?;
    // ixdzs returns 404 for an empty search; only accept a recognized empty result page.
    if !status.is_success() {
        match parse_search(&html, &final_url, rule) {
            Ok(result) if result.books.is_empty() && !result.has_more => {},
            _ => return Err(format!("采集失败：HTTP {}", status.as_u16()).into()),
        }
    }
    Ok((html, final_url))
}
async fn fetch_page(rule: &ArticleRule, url: Url, mode: &str) -> Result<ArticlePage, String> {
    let (mut html, mut url) = fetch_html(rule, url, None, false).await?;
    if mode == "catalog" && !rule.catalog_link_selector.is_empty() {
        // Search results may point to a detail page with a separate complete catalog.
        let target = {
            let doc = Html::parse_document(&html);
            doc.select(&selector(&rule.catalog_link_selector)?).next()
                .and_then(|el| el.value().attr("href")).and_then(|href| url.join(href).ok())
        };
        if let Some(target) = target.filter(|target| target != &url) {
            if !same_site(&target, &site_url(&rule.site_url)?) { return Err("目录网址不属于当前采集网站".into()); }
            (html, url) = fetch_html(rule, target, None, false).await?;
        }
    }
    let mut page = parse_page(&html, &url, rule, mode)?;
    if mode == "catalog" && let Some(body) = ixdzs_catalog_body(&url, &html)? {
        // The visible directory may contain only sampled chapters; use the site's full-directory action.
        let (complete, _) = fetch_html(rule, url.join("/novel/html").map_err(|_| "目录地址无效")?, Some(body), false).await?;
        check_page(&complete)?;
        let doc = Html::parse_document(&format!("<div id='a-list'><ul class='u-chapter'>{complete}</ul></div>"));
        page.chapters = chapter_links(&doc, &url, rule, &rule.chapter_link_selector)?;
    }
    Ok(page)
}

fn ixdzs_catalog_body(url: &Url, html: &str) -> Result<Option<String>, String> {
    if url.host_str().map(|h| h.trim_start_matches("www.")) != Some("ixdzs8.com") { return Ok(None); }
    let segments: Vec<_> = url.path().trim_matches('/').split('/').collect();
    if segments.len() != 2 || segments[0] != "read" || segments[1].is_empty() || !segments[1].bytes().all(|b| b.is_ascii_digit()) {
        return Err("作品目录地址无效".into());
    }
    let doc = Html::parse_document(html);
    let bid = doc.select(&selector("input#bid")?).next().and_then(|el| el.value().attr("value")).ok_or("未找到作品目录标识")?;
    if bid != segments[1] { return Err("目录与作品不一致".into()); }
    Ok(Some(format!("bid={bid}")))
}

fn search_request(rule: &ArticleRule, query: &str, page: u32) -> Result<(Url, Option<String>), String> {
    let search = rule.search.as_ref().ok_or("未配置书籍搜索")?;
    if !["GET", "POST"].contains(&search.method.as_str()) || !["utf-8", "gbk"].contains(&search.encoding.as_str()) {
        return Err("搜索请求配置无效".into());
    }
    if !(if search.method == "GET" { search.url.contains("{query}") } else { search.url.contains("{query}") || search.body.contains("{query}") }) {
        return Err("搜索地址或表单须包含 {query}".into());
    }
    if !search.next_selector.trim().is_empty() && !search.url.contains("{page}") && !(search.method == "POST" && search.body.contains("{page}")) {
        return Err("分页搜索地址或表单须包含 {page}".into());
    }
    let encoding = if search.encoding == "gbk" { GBK } else { UTF_8 };
    let (bytes, _, errors) = encoding.encode(query);
    if errors { return Err("书名包含此网站不支持的字符".into()); }
    let encoded: String = bytes.iter().map(|byte| format!("%{byte:02X}")).collect();
    let expand = |s: &str| s.replace("{query}", &encoded).replace("{page}", &page.to_string());
    let site = site_url(&rule.site_url)?;
    let url = site.join(&expand(&search.url)).map_err(|_| "搜索地址无效")?;
    if !same_site(&url, &site) { return Err("搜索地址不属于当前采集网站".into()); }
    Ok((url, (search.method == "POST").then(|| expand(&search.body))))
}
fn element_text(element: ElementRef<'_>, css: &str) -> Result<String, String> {
    if css.trim().is_empty() { return Ok(String::new()); }
    Ok(element.select(&selector(css)?).next().map(|el| el.text().collect::<String>().trim().to_string()).unwrap_or_default())
}
fn parse_search(html: &str, url: &Url, rule: &ArticleRule) -> Result<BookSearchPage, String> {
    check_page(html)?;
    let search = rule.search.as_ref().ok_or("未配置书籍搜索")?;
    let doc = Html::parse_document(html);
    let site = site_url(&rule.site_url)?;
    let mut seen = HashSet::new();
    let mut books = vec![];
    let mut rows = 0;
    for row in doc.select(&selector(&search.result_selector)?) {
        rows += 1;
        let title = element_text(row, &search.title_selector)?;
        let target = row.select(&selector(&search.link_selector)?).find_map(|link| {
            let mut target = url.join(link.value().attr("href")?).ok()?;
            target.set_fragment(None);
            (same_site(&target, &site) && target != *url).then_some(target)
        });
        if let Some(target) = target.filter(|_| !title.is_empty()) {
            if seen.insert(target.to_string()) {
                books.push(SearchBook { title, url: target.to_string(), author: element_text(row, &search.author_selector)?, intro: element_text(row, &search.intro_selector)? });
            }
        }
    }
    // Some sites redirect an exact match straight to the book detail page.
    if rows == 0 && books.is_empty() {
        let title = doc.select(&selector("meta[property='og:novel:book_name']")?).next().and_then(|el| el.value().attr("content")).unwrap_or("");
        if !title.trim().is_empty() {
            let author = doc.select(&selector("meta[property='og:novel:author']")?).next().and_then(|el| el.value().attr("content")).unwrap_or("");
            books.push(SearchBook { title: title.trim().into(), author: author.into(), intro: String::new(), url: url.to_string() });
        }
    }
    if books.is_empty() && (rows > 0 || search.empty_selector.is_empty() || doc.select(&selector(&search.empty_selector)?).next().is_none()) {
        return Err("未能读取搜索结果，请检查搜索规则".into());
    }
    let has_more = !search.next_selector.is_empty() && doc.select(&selector(&search.next_selector)?).any(|el| {
        el.value().attr("href").and_then(|href| url.join(href).ok()).is_some_and(|next| same_site(&next, &site) && next != *url)
    });
    Ok(BookSearchPage { books, has_more })
}
async fn search_books(rule: &ArticleRule, query: &str, page: u32) -> Result<BookSearchPage, String> {
    let (url, body) = search_request(rule, query, page)?;
    let (html, url) = fetch_html(rule, url, body, true).await?;
    parse_search(&html, &url, rule)
}
#[tauri::command]
pub async fn search_article_books(state: State<'_, Requests>, id: String, rule: ArticleRule, query: String, page: u32) -> Result<BookSearchPage, String> {
    validate_article_rule(rule.clone())?;
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 100 || !(1..=100).contains(&page) { return Err("请输入 1–100 字的书名或作者".into()); }
    let (sender, mut cancel) = watch::channel(false);
    state.0.lock().map_err(|_| "请求状态不可用")?.begin(&id, sender)?;
    let result = tokio::select! {
        result = search_books(&rule, query, page) => result,
        _ = cancel.changed() => Err("搜索已停止".into()),
    };
    state.0.lock().map_err(|_| "请求状态不可用")?.finish(&id);
    result
}
#[tauri::command]
pub async fn read_article_page(
    state: State<'_, Requests>,
    id: String,
    rule: ArticleRule,
    url: String,
    mode: String,
) -> Result<ArticlePage, String> {
    validate_article_rule(rule.clone())?;
    if !["catalog", "chapter"].contains(&mode.as_str()) {
        return Err("采集类型无效".into());
    }
    let url = site_url(&url)?;
    if !same_site(&url, &site_url(&rule.site_url)?) {
        return Err("网址不属于当前采集网站".into());
    }
    let (sender, mut cancel) = watch::channel(false);
    state
        .0
        .lock()
        .map_err(|_| "请求状态不可用")?
        .begin(&id, sender)?;
    let result = tokio::select! {
        result = fetch_page(&rule, url, &mode) => result,
        _ = cancel.changed() => Err("采集已停止".into()),
    };
    state.0.lock().map_err(|_| "请求状态不可用")?.finish(&id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    struct PageServer {
        url: Url,
        requests: Arc<Mutex<Vec<String>>>,
        task: tokio::task::JoinHandle<()>,
    }
    impl Drop for PageServer {
        fn drop(&mut self) { self.task.abort(); }
    }
    async fn page_server(responses: Vec<String>) -> PageServer {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = Url::parse(&format!("http://{}/chapter", listener.local_addr().unwrap())).unwrap();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let received = requests.clone();
        let task = tokio::spawn(async move {
            let mut responses = responses.into_iter();
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let size = socket.read(&mut buffer).await.unwrap();
                    if size == 0 { break; }
                    bytes.extend_from_slice(&buffer[..size]);
                    let request = String::from_utf8_lossy(&bytes);
                    if let Some((headers, body)) = request.split_once("\r\n\r\n") {
                        let length = headers.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length: ").and_then(|value| value.parse::<usize>().ok())).unwrap_or(0);
                        if body.len() >= length { break; }
                    }
                }
                received.lock().unwrap().push(String::from_utf8(bytes).unwrap());
                let response = responses.next().unwrap_or_else(|| response("500 Internal Server Error", ""));
                let _ = socket.write_all(response.as_bytes()).await;
                let _ = socket.shutdown().await;
            }
        });
        PageServer { url, requests, task }
    }
    fn response(status: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }
    fn test_client() -> Client { Client::builder().no_proxy().timeout(Duration::from_secs(2)).build().unwrap() }

    #[tokio::test]
    async fn retries_dropped_connections_and_returns_complete_chapter() {
        let html = "<div class='page-content'><h2>第一章</h2><section>完整正文</section></div>";
        let server = page_server(vec![String::new(), String::new(), response("200 OK", html)]).await;
        let (html, url) = fetch_html_with_client(&test_client(), &ixdzs_rule(), server.url.clone(), None, false).await.unwrap();
        let page = parse_page(&html, &url, &ixdzs_rule(), "chapter").unwrap();
        assert_eq!(page.text, "完整正文");
        assert_eq!(server.requests.lock().unwrap().len(), 3);
    }
    #[tokio::test]
    async fn retries_incomplete_body_without_keeping_partial_text_and_preserves_post() {
        let server = page_server(vec![
            "HTTP/1.1 200 OK\r\nContent-Length: 100\r\nConnection: close\r\n\r\npartial".into(),
            response("200 OK", "完整目录"),
        ]).await;
        let (html, _) = fetch_html_with_client(&test_client(), &ixdzs_rule(), server.url.clone(), Some("bid=123".into()), false).await.unwrap();
        assert_eq!(html, "完整目录");
        let requests = server.requests.lock().unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests.iter().all(|request| request.starts_with("POST /chapter ") && request.ends_with("bid=123")));
    }
    #[tokio::test]
    async fn permanent_page_failures_are_not_retried() {
        for (status, html, expected) in [
            ("404 Not Found", "", "HTTP 404"),
            ("429 Too Many Requests", "", "HTTP 429"),
            ("200 OK", "<form id='challenge-form'></form>", "网站要求验证"),
        ] {
            let server = page_server(vec![response(status, html)]).await;
            let error = fetch_html_with_client(&test_client(), &ixdzs_rule(), server.url.clone(), None, false).await.unwrap_err();
            assert!(error.contains(expected), "{error}");
            assert_eq!(server.requests.lock().unwrap().len(), 1);
        }
    }
    #[tokio::test]
    async fn network_retries_are_bounded_and_errors_are_readable() {
        let server = page_server(vec![String::new(), String::new(), String::new()]).await;
        let error = fetch_html_with_client(&test_client(), &ixdzs_rule(), server.url.clone(), None, false).await.unwrap_err();
        assert_eq!(error, "采集失败：网站连接中断，请稍后重试");
        assert_eq!(server.requests.lock().unwrap().len(), 3);
    }
    #[tokio::test]
    async fn cancellation_during_retry_wait_drops_the_collection() {
        let server = page_server(vec![String::new(), response("200 OK", "不应读取")]).await;
        let client = test_client();
        let rule = ixdzs_rule();
        let result = tokio::time::timeout(Duration::from_millis(900), fetch_html_with_client(&client, &rule, server.url.clone(), None, false)).await;
        assert!(result.is_err());
        assert_eq!(server.requests.lock().unwrap().len(), 1);
    }
    fn ixdzs_rule() -> ArticleRule {
        serde_json::from_value(serde_json::json!({
            "name": "爱下电子书", "siteUrl": "https://ixdzs8.com/", "encoding": "utf-8",
            "catalogTitleSelector": "h1", "chapterLinkSelector": "#a-list .u-chapter li a",
            "chapterTitleSelector": ".page-content h2", "contentSelector": ".page-content section",
            "excludeSelector": ".ad, [id^='page-id']",
            "search": {
                "url": "/bsearch?q={query}&page={page}", "method": "GET", "body": "", "encoding": "utf-8",
                "resultSelector": ".burl", "titleSelector": ".bname", "linkSelector": ".bname a",
                "authorSelector": ".bauthor", "introSelector": ".l-p2", "nextSelector": "a[title='下一页']", "emptySelector": ".u-list"
            }
        })).unwrap()
    }
    #[test]
    fn search_encodes_keywords_and_validates_requests() {
        let mut r = ixdzs_rule();
        let (url, body) = search_request(&r, "中文&?# +", 2).unwrap();
        assert_eq!(url.query_pairs().collect::<Vec<_>>(), vec![("q".into(), "中文&?# +".into()), ("page".into(), "2".into())]);
        assert!(body.is_none());
        r.search.as_mut().unwrap().method = "POST".into();
        r.search.as_mut().unwrap().encoding = "gbk".into();
        r.search.as_mut().unwrap().url = "/search".into();
        r.search.as_mut().unwrap().body = "searchkey={query}&page={page}".into();
        assert_eq!(search_request(&r, "中文&", 3).unwrap().1.unwrap(), "searchkey=%D6%D0%CE%C4%26&page=3");
        assert!(search_request(&r, "🪐", 1).is_err());
        r.search.as_mut().unwrap().url = "https://other.example/search".into();
        assert!(validate_article_rule(r.clone()).unwrap_err().contains("不属于"));
        r.search.as_mut().unwrap().url = "/search".into();
        r.search.as_mut().unwrap().body = "searchkey={query}".into();
        assert!(validate_article_rule(r.clone()).unwrap_err().contains("{page}"));
        r.search.as_mut().unwrap().body = "page={page}".into();
        assert!(validate_article_rule(r).unwrap_err().contains("{query}"));
    }
    #[test]
    fn search_results_preserve_sources_and_detect_empty_or_invalid_pages() {
        let r = ixdzs_rule();
        let url = Url::parse("https://ixdzs8.com/bsearch?q=test&page=1").unwrap();
        let html = r##"<ul class="u-list">
          <li class="burl"><h3 class="bname"><a href="/read/123/"> 样本 </a></h3><span class="bauthor">作者</span><p class="l-p2">简介</p></li>
          <li class="burl"><h3 class="bname"><a href="/read/123/#top">重复</a></h3></li>
          <li class="burl"><h3 class="bname"><a href="https://other.example/read/1/">外链</a></h3></li>
        </ul><a title="下一页" href="?q=test&page=2">下一页</a>"##;
        let result = parse_search(html, &url, &r).unwrap();
        assert_eq!(result.books.len(), 1);
        assert_eq!(result.books[0].title, "样本");
        assert_eq!(result.books[0].author, "作者");
        assert_eq!(result.books[0].intro, "简介");
        assert_eq!(result.books[0].url, "https://ixdzs8.com/read/123/");
        assert!(result.has_more);
        let empty = parse_search("<ul class='u-list'></ul>", &url, &r).unwrap();
        assert!(empty.books.is_empty() && !empty.has_more);
        assert!(parse_search("<h1>网站维护</h1>", &url, &r).is_err());
        assert!(parse_search("<ul class='u-list'><li class='burl'>结构已变</li></ul>", &url, &r).is_err());
        assert!(parse_search("<form id='challenge-form'></form>", &url, &r).unwrap_err().contains("验证"));
        let redirect = parse_search("<meta property='og:novel:book_name' content='样本'><meta property='og:novel:author' content='作者'>", &Url::parse("https://ixdzs8.com/read/123/").unwrap(), &r).unwrap();
        assert_eq!(redirect.books[0].title, "样本");
        assert_eq!(redirect.books[0].url, "https://ixdzs8.com/read/123/");
    }
    #[test]
    fn ixdzs_catalog_ignores_latest_chapters_and_body_ignores_advertisements() {
        let r = ixdzs_rule();
        let url = Url::parse("https://ixdzs8.com/read/123/").unwrap();
        let catalog = parse_page("<h1>样本</h1><ul class='cfirst'><li><a href='p2.html'>第二章</a></li></ul><div id='a-list'><ul class='u-chapter'><li><a href='p1.html'>第一章</a></li><li><a href='p2.html'>第二章</a></li></ul></div>", &url, &r, "catalog").unwrap();
        assert_eq!(catalog.chapters.len(), 2);
        assert_eq!(catalog.chapters[0].title, "第一章");
        let chapter = parse_page("<h1>书名</h1><div class='page-content'><h2>第一章</h2><section><p>第一<span>段。</span></p><div class='ad'>广告</div><p>第二段。</p><script>广告脚本</script></section><aside>推荐阅读</aside></div>", &url.join("p1.html").unwrap(), &r, "chapter").unwrap();
        assert_eq!(chapter.title, "第一章");
        assert_eq!(chapter.text, "第一段。\n\n第二段。");
        assert_eq!(ixdzs_catalog_body(&url, "<input id='bid' value='123'>").unwrap(), Some("bid=123".into()));
        assert!(ixdzs_catalog_body(&url, "<input id='bid' value='456'>").is_err());
        assert!(ixdzs_catalog_body(&url, "<h1>目录缺失</h1>").is_err());
        assert!(ixdzs_catalog_body(&Url::parse("https://other.example/read/123/").unwrap(), "").unwrap().is_none());
    }
    #[tokio::test]
    #[ignore = "requires access to the public collection website"]
    async fn live_ixdzs_reported_chapter() {
        let url = Url::parse("https://ixdzs8.com/read/557700/p460.html").unwrap();
        let page = fetch_page(&ixdzs_rule(), url.clone(), "chapter").await.unwrap();
        assert_eq!(page.url, url.as_str());
        assert!(page.title.contains("460"), "unexpected title: {}", page.title);
        assert!(page.text.chars().count() > 500);
        println!("{}：{} 字符", page.title, page.text.chars().count());
    }
    #[tokio::test]
    #[ignore = "requires access to the public collection website"]
    async fn live_ixdzs_search_and_chapters() {
        let r = ixdzs_rule();
        let first = search_books(&r, "斗破苍穹", 1).await.unwrap();
        assert!(!first.books.is_empty() && first.has_more);
        let second = search_books(&r, "斗破苍穹", 2).await.unwrap();
        assert!(!second.books.is_empty());
        assert_ne!(first.books[0].url, second.books[0].url);
        let catalog = fetch_page(&r, Url::parse(&first.books[0].url).unwrap(), "catalog").await.unwrap();
        assert!(catalog.chapters.len() > 100, "must retrieve the complete directory, not the sampled HTML list");
        let chapter = fetch_page(&r, Url::parse(&catalog.chapters[0].url).unwrap(), "chapter").await.unwrap();
        assert!(chapter.text.chars().count() > 500);
        assert!(search_books(&r, "zzxxyy9876543210", 1).await.unwrap().books.is_empty());
        println!("搜索与分页成功；{}：目录 {} 章，首章 {} 字符", catalog.title, catalog.chapters.len(), chapter.text.chars().count());
    }
    fn rule() -> ArticleRule {
        ArticleRule {
            name: "69书吧".into(),
            site_url: "https://www.69shuba.com/".into(),
            encoding: "auto".into(),
            catalog_title_selector: ".bread a:last-child".into(),
            chapter_link_selector: "#catalog li a".into(),
            chapter_title_selector: "h1".into(),
            content_selector: ".txtnav".into(),
            exclude_selector: "h1, .txtinfo, .contentadv, .bottom-ad, #txtright".into(),
            catalog_link_selector: String::new(),
            search: None,
        }
    }
    #[test]
    fn catalog_preserves_order_and_filters_duplicate_or_offsite_links() {
        let html = r##"<div class="bread"><a>首页</a><a>样本章节列表</a></div><ul id="catalog"><li><a href="1.htm">第一章</a></li><li><a href="1.htm#top">重复</a></li><li><a href="//evil.test/2">外链</a></li><li><a href="2.htm">第二章</a></li></ul>"##;
        let page = parse_page(
            html,
            &Url::parse("https://www.69shuba.com/book/123/").unwrap(),
            &rule(),
            "catalog",
        )
        .unwrap();
        assert_eq!(page.title, "样本");
        assert_eq!(page.chapters.len(), 2);
        assert_eq!(
            page.chapters[0].url,
            "https://www.69shuba.com/book/123/1.htm"
        );
        assert_eq!(page.chapters[1].title, "第二章");
    }
    #[test]
    fn chapter_keeps_paragraphs_and_inline_text_without_ads() {
        let html = "<div class='txtnav'><h1>第一章</h1><div class='txtinfo'>时间</div>第一<span>段</span>。<br>第二段。<div class='contentadv'>广告</div><p>第三段。</p><script>bad()</script></div>";
        let page = parse_page(
            html,
            &Url::parse("https://www.69shuba.com/book/123/1.htm").unwrap(),
            &rule(),
            "chapter",
        )
        .unwrap();
        assert_eq!(page.title, "第一章");
        assert_eq!(page.text, "第一段。\n\n第二段。\n\n第三段。");
    }
    #[test]
    fn decodes_gbk_and_utf8_and_reports_wrong_encoding() {
        let text = "<meta charset=gbk>章节正文";
        let (bytes, _, _) = GBK.encode(text);
        assert_eq!(decode(&bytes, "text/html", "auto").unwrap(), text);
        assert!(decode(&bytes, "text/html", "utf-8").is_err());
        assert_eq!(
            decode("章节正文".as_bytes(), "", "auto").unwrap(),
            "章节正文"
        );
    }
    #[test]
    fn rejects_invalid_rules_and_verification_pages() {
        let mut r = rule();
        r.content_selector = "[".into();
        assert!(validate_article_rule(r).is_err());
        let url = Url::parse("https://www.69shuba.com/").unwrap();
        assert!(
            parse_page(
                "<form id='challenge-form'>验证</form>",
                &url,
                &rule(),
                "chapter"
            )
            .unwrap_err()
            .contains("验证")
        );
        assert!(parse_page("<h1>书名</h1>", &url, &rule(), "chapter").is_err());
        assert!(!same_site(
            &Url::parse("https://www.69shuba.com.evil.test/").unwrap(),
            &url
        ));
        assert!(!same_site(
            &Url::parse("https://user@www.69shuba.com/").unwrap(),
            &url
        ));
    }
}
