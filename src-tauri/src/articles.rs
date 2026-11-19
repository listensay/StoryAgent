use crate::network::Requests;
use encoding_rs::{Encoding, GBK, UTF_8};
use futures_util::StreamExt;
use reqwest::{Client, Url};
use scraper::{ElementRef, Html, Selector};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, time::Duration};
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
fn text_content(element: ElementRef<'_>, excluded: &Selector, output: &mut String) {
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
fn parse_page(
    html: &str,
    url: &Url,
    rule: &ArticleRule,
    mode: &str,
) -> Result<ArticlePage, String> {
    let doc = Html::parse_document(html);
    if doc
        .select(&selector(
            "#challenge-form, #cf-challenge-running, .g-recaptcha",
        )?)
        .next()
        .is_some()
        || html.contains("/cdn-cgi/challenge-platform/")
    {
        return Err("网站要求验证，暂时无法采集".into());
    }
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
        let mut seen = HashSet::new();
        for link in doc.select(&selector(&rule.chapter_link_selector)?) {
            let Some(href) = link.value().attr("href") else {
                continue;
            };
            if href.starts_with('#') {
                continue;
            }
            let Ok(mut target) = url.join(href) else {
                continue;
            };
            target.set_fragment(None);
            let title = link.text().collect::<String>().trim().to_string();
            if !same_site(&target, &site_url(&rule.site_url)?)
                || target == *url
                || title.is_empty()
                || !seen.insert(target.to_string())
            {
                continue;
            }
            result.chapters.push(ChapterLink {
                title,
                url: target.to_string(),
            });
        }
        if result.chapters.is_empty() {
            return Err("未找到章节，请填写目录网址或检查目录规则".into());
        }
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
async fn fetch_page(rule: &ArticleRule, url: Url, mode: &str) -> Result<ArticlePage, String> {
    let site = site_url(&rule.site_url)?;
    let client = Client::builder()
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
    // Space sequential chapter requests; cancellation also covers this wait.
    tokio::time::sleep(Duration::from_millis(600)).await;
    let response = client
        .get(url)
        .header("User-Agent", "StoryAgent/0.1")
        .send()
        .await
        .map_err(|e| format!("采集失败：{e}"))?;
    if response
        .headers()
        .get("cf-mitigated")
        .is_some_and(|h| h == "challenge")
    {
        return Err("网站要求验证，暂时无法采集".into());
    }
    if !response.status().is_success() {
        return Err(format!("采集失败：HTTP {}", response.status().as_u16()));
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
        let chunk = chunk.map_err(|e| format!("读取页面失败：{e}"))?;
        if bytes.len() + chunk.len() > 5 * 1024 * 1024 {
            return Err("页面超过 5 MB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_page(
        &decode(&bytes, &content_type, &rule.encoding)?,
        &final_url,
        rule,
        mode,
    )
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
