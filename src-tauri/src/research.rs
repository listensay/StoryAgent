use crate::{
    network::Requests,
    rankings::{clear_text, field, script_json, valid_id},
};
use futures_util::StreamExt;
use reqwest::{Client, Url};
use scraper::{Html, Selector};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, time::Duration};
use tauri::State;
use tokio::sync::watch;

#[derive(Debug)]
struct Book {
    id: String,
    qidian: bool,
    url: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct Chapter {
    id: String,
    title: String,
    url: String,
    readable: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    book_url: String,
    title: String,
    chapters: Vec<Chapter>,
}
#[derive(Debug, Serialize)]
pub struct ChapterText {
    id: String,
    title: String,
    url: String,
    content: String,
}

fn book(value: &str) -> Result<Book, String> {
    let url = Url::parse(value).map_err(|_| "作品地址无效")?;
    let qidian = url.host_str() == Some("m.qidian.com");
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    if url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || (!qidian && url.host_str() != Some("fanqienovel.com"))
        || parts.len() != 2
        || parts[0] != if qidian { "book" } else { "page" }
        || !valid_id(parts[1])
    {
        return Err("暂不支持此作品来源".into());
    }
    Ok(Book {
        id: parts[1].into(),
        qidian,
        url: value.into(),
    })
}
fn chapter_url(book: &Book, id: &str) -> String {
    if book.qidian {
        format!("https://m.qidian.com/chapter/{}/{id}/", book.id)
    } else {
        format!("https://fanqienovel.com/reader/{id}")
    }
}
fn enabled(value: &Value) -> bool {
    value == true
        || value == "true"
        || value.as_i64().is_some_and(|n| n != 0)
        || value
            .as_str()
            .and_then(|s| s.parse::<i64>().ok())
            .is_some_and(|n| n != 0)
}
fn locked(value: &Value) -> bool {
    [
        "needPay",
        "isChapterLock",
        "isPaidPublication",
        "isPaidStory",
    ]
    .iter()
    .any(|key| enabled(&value[*key]))
}
fn data(html: &str, qidian: bool) -> Result<Value, String> {
    script_json(html, qidian).map_err(|_| "未能读取作品内容，网站暂时限制访问或页面已更新".into())
}
fn parse_catalog(html: &str, book: &Book) -> Result<Catalog, String> {
    let data = data(html, book.qidian)?;
    let page = if book.qidian {
        &data["pageContext"]["pageProps"]["pageData"]
    } else {
        &data["page"]
    };
    if field(page, &["bookId"]) != book.id {
        return Err("目录与所选作品不一致".into());
    }
    let title = field(page, &["bookName"]);
    let mut chapters = vec![];
    let mut seen = HashSet::new();
    if book.qidian {
        for volume in page["vs"].as_array().ok_or("未找到作品目录")? {
            for row in volume["cs"].as_array().ok_or("作品目录不完整")? {
                let id = field(row, &["id"]);
                let title = field(row, &["cN"]);
                if !valid_id(&id) || title.is_empty() {
                    return Err("作品目录不完整".into());
                }
                if seen.insert(id.clone()) {
                    chapters.push(Chapter {
                        url: chapter_url(book, &id),
                        id,
                        title,
                        readable: !enabled(&volume["vS"]) && !enabled(&row["vS"]),
                    });
                }
            }
        }
    } else {
        for volume in page["chapterListWithVolume"]
            .as_array()
            .ok_or("未找到作品目录")?
        {
            for row in volume.as_array().ok_or("作品目录不完整")? {
                let id = field(row, &["itemId"]);
                let title = field(row, &["title"]);
                if !valid_id(&id) || title.is_empty() {
                    return Err("作品目录不完整".into());
                }
                if seen.insert(id.clone()) {
                    chapters.push(Chapter {
                        url: chapter_url(book, &id),
                        id,
                        title,
                        readable: !locked(row),
                    });
                }
            }
        }
    }
    if chapters.is_empty() || title.is_empty() {
        return Err("未找到作品目录".into());
    }
    if !clear_text(&title) || chapters.iter().any(|c| !clear_text(&c.title)) {
        return Err("作品目录暂时无法识别".into());
    }
    let expected = field(
        page,
        if book.qidian {
            &["chapterTotalCnt"]
        } else {
            &["chapterTotal"]
        },
    )
    .parse::<usize>()
    .unwrap_or(0);
    if expected > chapters.len() {
        return Err("网站返回的目录不完整，请重试".into());
    }
    Ok(Catalog {
        book_url: book.url.clone(),
        title,
        chapters,
    })
}
fn parse_chapter(html: &str, book: &Book, id: &str) -> Result<ChapterText, String> {
    let data = data(html, book.qidian)?;
    let page = &data["pageContext"]["pageProps"]["pageData"];
    let chapter = if book.qidian {
        &page["chapterInfo"]
    } else {
        &data["reader"]["chapterData"]
    };
    let book_id = if book.qidian {
        field(&page["bookInfo"], &["bookId"])
    } else {
        field(chapter, &["bookId"])
    };
    let chapter_id = field(
        chapter,
        if book.qidian {
            &["chapterId", "id"]
        } else {
            &["itemId"]
        },
    );
    if book_id != book.id || chapter_id != id {
        return Err("章节与所选作品不一致".into());
    }
    if (book.qidian && enabled(&chapter["vipStatus"])) || locked(chapter) {
        return Err("该章节暂不可获取".into());
    }
    if book.qidian && (enabled(&page["riskInfo"]["captchaType"]) || enabled(&page["riskbe"]["be"]))
    {
        return Err("网站要求验证，暂时无法获取正文".into());
    }
    let title = field(chapter, &["chapterName", "title"]);
    let raw = field(chapter, &["content"]);
    let fragment = Html::parse_fragment(&raw);
    let excluded = Selector::parse("script, style, noscript, iframe, button, nav, .ad").unwrap();
    let mut text = String::new();
    crate::articles::text_content(fragment.root_element(), &excluded, &mut text);
    let content = text
        .lines()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if title.is_empty() || content.is_empty() {
        return Err("网站未提供章节正文".into());
    }
    if !clear_text(&content) || !clear_text(&title) {
        return Err("网站正文暂时无法识别，请选择其他作品".into());
    }
    if content.chars().count() > 200_000 {
        return Err("章节正文过大".into());
    }
    Ok(ChapterText {
        id: id.into(),
        title,
        url: chapter_url(book, id),
        content,
    })
}
async fn fetch(url: &str) -> Result<String, String> {
    let url = Url::parse(url).map_err(|_| "作品地址无效")?;
    let host = url.host_str().unwrap_or_default().to_owned();
    let agent = if host == "m.qidian.com" {
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"
    } else {
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    };
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 3
                || attempt.url().host_str() != Some(host.as_str())
                || attempt.url().scheme() != "https"
            {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(350)).await;
    let response = client
        .get(url)
        .header("User-Agent", agent)
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|_| "正文网站连接失败，请重试")?;
    if !response.status().is_success() {
        return Err(format!(
            "正文获取失败（HTTP {}）",
            response.status().as_u16()
        ));
    }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "正文读取失败，请重试")?;
        if bytes.len() + chunk.len() > 5 * 1024 * 1024 {
            return Err("作品页面过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "作品页面编码无法识别".into())
}
async fn read(book: &Book, chapter: Option<&str>) -> Result<String, String> {
    let url = match chapter {
        Some(id) if valid_id(id) => chapter_url(book, id),
        Some(_) => return Err("章节标识无效".into()),
        None if book.qidian => format!("https://m.qidian.com/book/{}/catalog/", book.id),
        None => book.url.clone(),
    };
    fetch(&url).await
}
#[tauri::command]
pub async fn read_research_catalog(
    state: State<'_, Requests>,
    id: String,
    book_url: String,
) -> Result<Catalog, String> {
    let book = book(&book_url)?;
    let (sender, mut cancel) = watch::channel(false);
    state
        .0
        .lock()
        .map_err(|_| "请求状态不可用")?
        .begin(&id, sender)?;
    let result = tokio::select! {
        result = read(&book, None) => result.and_then(|html| parse_catalog(&html, &book)),
        _ = cancel.changed() => Err("采集已停止".into()),
    };
    state.0.lock().map_err(|_| "请求状态不可用")?.finish(&id);
    result
}
#[tauri::command]
pub async fn read_research_chapter(
    state: State<'_, Requests>,
    id: String,
    book_url: String,
    chapter_id: String,
) -> Result<ChapterText, String> {
    let book = book(&book_url)?;
    let (sender, mut cancel) = watch::channel(false);
    state
        .0
        .lock()
        .map_err(|_| "请求状态不可用")?
        .begin(&id, sender)?;
    let result = tokio::select! {
        result = read(&book, Some(&chapter_id)) => result.and_then(|html| parse_chapter(&html, &book, &chapter_id)),
        _ = cancel.changed() => Err("采集已停止".into()),
    };
    state.0.lock().map_err(|_| "请求状态不可用")?.finish(&id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn qidian(data: Value) -> String {
        let json = json!({"pageContext":{"pageProps":{"pageData":data}}})
            .to_string()
            .replace('<', "\\u003c");
        format!(r#"<script id="vite-plugin-ssr_pageContext">{json}</script>"#)
    }
    fn fanqie(data: Value) -> String {
        format!("<script>window.__INITIAL_STATE__={data};</script>")
    }
    fn sample() -> Value {
        json!({"bookInfo":{"bookId":123},"chapterInfo":{"chapterId":1,"chapterName":"第一章", "vipStatus":0, "content":"<p>第一段<b>动作</b></p><p>第二段</p><script>广告()</script>"}})
    }
    #[test]
    fn only_official_book_addresses_are_accepted() {
        for url in [
            "https://m.qidian.com/book/123/",
            "https://fanqienovel.com/page/7654593151348247614",
        ] {
            assert!(book(url).is_ok());
        }
        for url in [
            "http://m.qidian.com/book/123/",
            "https://m.qidian.com.evil.test/book/123/",
            "https://m.qidian.com/book/a/",
            "https://u:p@m.qidian.com/book/123/",
            "https://m.qidian.com/book/123/?url=other",
            "https://localhost/book/123/",
        ] {
            assert!(book(url).is_err());
        }
    }
    #[test]
    fn catalog_preserves_order_and_marks_paid_chapters() {
        let source = book("https://m.qidian.com/book/123/").unwrap();
        let data = json!({"bookId":123,"bookName":"样本","chapterTotalCnt":2,"vs":[{"vS":0,"cs":[{"id":1,"cN":"第一章"},{"id":1,"cN":"重复"}]},{"vS":1,"cs":[{"id":2,"cN":"第二章"}]}]});
        let catalog = parse_catalog(&qidian(data.clone()), &source).unwrap();
        assert_eq!(catalog.chapters.len(), 2);
        assert_eq!(catalog.chapters[0].id, "1");
        assert!(catalog.chapters[0].readable);
        assert!(!catalog.chapters[1].readable);
        let mut incomplete = data.clone();
        incomplete["chapterTotalCnt"] = json!(3);
        assert!(parse_catalog(&qidian(incomplete), &source).is_err());
        let mut wrong = data;
        wrong["bookId"] = json!(456);
        assert!(parse_catalog(&qidian(wrong), &source).is_err());
    }
    #[test]
    fn chapter_extracts_only_body_and_rejects_wrong_identity_or_payment() {
        let source = book("https://m.qidian.com/book/123/").unwrap();
        let data = sample();
        assert_eq!(
            parse_chapter(&qidian(data.clone()), &source, "1")
                .unwrap()
                .content,
            "第一段动作\n\n第二段"
        );
        assert!(parse_chapter(&qidian(data.clone()), &source, "2").is_err());
        let mut paid = data.clone();
        paid["chapterInfo"]["vipStatus"] = json!(1);
        assert!(parse_chapter(&qidian(paid), &source, "1").is_err());
        let mut other = data.clone();
        other["bookInfo"]["bookId"] = json!(456);
        assert!(parse_chapter(&qidian(other), &source, "1").is_err());
        let mut challenged = data;
        challenged["riskInfo"] = json!({"captchaType":2});
        assert!(parse_chapter(&qidian(challenged), &source, "1").is_err());
    }
    #[test]
    fn fanqie_large_ids_lock_flags_and_encoded_body_are_checked() {
        let source = book("https://fanqienovel.com/page/7654593151348247614").unwrap();
        let catalog = json!({"page":{"bookId":"7654593151348247614","bookName":"样本","chapterTotal":2,"chapterListWithVolume":[[{"itemId":"7654593184701366846","title":"第一章","needPay":0},{"itemId":"7654593184701366847","title":"第二章","isChapterLock":true}]]}});
        let parsed = parse_catalog(&fanqie(catalog), &source).unwrap();
        assert_eq!(parsed.chapters[0].id, "7654593184701366846");
        assert!(!parsed.chapters[1].readable);
        let data = json!({"reader":{"chapterData":{"bookId":source.id,"itemId":"7654593184701366846","title":"第一章","content":"<p>可读正文</p>"}}});
        assert!(parse_chapter(&fanqie(data.clone()), &source, "7654593184701366846").is_ok());
        let mut encoded = data;
        encoded["reader"]["chapterData"]["content"] = json!("<p>正文\u{e400}</p>");
        assert!(
            parse_chapter(&fanqie(encoded), &source, "7654593184701366846")
                .unwrap_err()
                .contains("无法识别")
        );
        assert!(parse_catalog("<html>验证页面</html>", &source).is_err());
    }
    #[tokio::test]
    #[ignore = "requires public website access"]
    async fn live_research() {
        let source = book("https://m.qidian.com/book/1050638853/").unwrap();
        let catalog = parse_catalog(&read(&source, None).await.unwrap(), &source).unwrap();
        assert!(catalog.chapters.len() >= 3);
        for chapter in catalog.chapters.iter().take(3) {
            let text = parse_chapter(
                &read(&source, Some(&chapter.id)).await.unwrap(),
                &source,
                &chapter.id,
            )
            .unwrap();
            assert!(!text.content.is_empty());
            println!("{}: {} chars", text.title, text.content.chars().count());
        }
        let source = book("https://fanqienovel.com/page/7654593151348247614").unwrap();
        let catalog = parse_catalog(&read(&source, None).await.unwrap(), &source).unwrap();
        let chapter = &catalog.chapters[0];
        let result = parse_chapter(
            &read(&source, Some(&chapter.id)).await.unwrap(),
            &source,
            &chapter.id,
        );
        match result {
            Ok(text) => println!("番茄：{} chars", text.content.chars().count()),
            Err(error) => {
                assert!(error.contains("无法识别"));
                println!("番茄：{error}");
            }
        }
    }
}
