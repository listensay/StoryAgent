use futures_util::{StreamExt, stream};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, time::Duration};
use tauri::State;
use tokio::sync::watch;

const MOBILE_UA: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const QIDIAN_BOARDS: &[(&str, &str)] = &[
    ("hotsales", "畅销榜"),
    ("yuepiao", "月票榜"),
    ("newbook", "新书榜"),
    ("newauthor", "新人榜"),
    ("sign", "签约榜"),
    ("rec", "推荐榜"),
    ("readindex", "阅读指数榜"),
    ("newfans", "书友榜"),
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RankingRequest {
    id: String,
    platform: String,
    board: String,
    channel: String,
    category: String,
    limit: usize,
}
#[derive(Clone, Serialize)]
pub struct Category {
    id: String,
    name: String,
}
#[derive(Debug, Serialize)]
pub struct Metric {
    label: String,
    value: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedBook {
    id: String,
    rank: usize,
    title: String,
    author: String,
    genre: String,
    intro: String,
    words: String,
    status: String,
    url: String,
    #[serde(rename = "coverUrl")]
    cover_url: String,
    metrics: Vec<Metric>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankingResult {
    platform: String,
    board: String,
    channel: String,
    category: String,
    source_url: String,
    books: Vec<RankedBook>,
    skipped: usize,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .timeout(Duration::from_secs(25))
        .connect_timeout(Duration::from_secs(10))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| e.to_string())
}
async fn page(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header(
            "User-Agent",
            if url.starts_with("https://m.qidian.com/") {
                MOBILE_UA
            } else {
                "Mozilla/5.0"
            },
        )
        .header("Accept", "text/html,application/xhtml+xml,application/json")
        .header("Accept-Language", "zh-CN,zh;q=0.9")
        .header("Accept-Encoding", "identity")
        .send()
        .await
        .map_err(|_error| {
            #[cfg(test)]
            eprintln!("{_error:?}");
            "榜单网站连接失败，请重试".to_string()
        })?;
    if !response.status().is_success() {
        return Err(format!(
            "榜单网站返回 HTTP {}，请稍后重试",
            response.status().as_u16()
        ));
    }
    let mut chunks = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|_| "榜单页面读取失败")?;
        if bytes.len() + chunk.len() > 5 * 1024 * 1024 {
            return Err("榜单页面过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "榜单页面编码无法识别".into())
}
pub(crate) fn field(value: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| match &value[*key] {
            Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_owned()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .unwrap_or_default()
}
pub(crate) fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 24 && id.bytes().all(|c| c.is_ascii_digit())
}
pub(crate) fn clear_text(text: &str) -> bool {
    !text
        .chars()
        .any(|c| ('\u{e000}'..='\u{f8ff}').contains(&c) || c == '\u{fffd}')
}
pub(crate) fn script_json(html: &str, qidian: bool) -> Result<Value, String> {
    let doc = Html::parse_document(html);
    let selector = Selector::parse(if qidian {
        "script#vite-plugin-ssr_pageContext"
    } else {
        "script"
    })
    .unwrap();
    for script in doc.select(&selector) {
        let content = script.text().collect::<String>();
        let json = if qidian {
            content.as_str()
        } else {
            let Some((_, tail)) = content.split_once("window.__INITIAL_STATE__") else {
                continue;
            };
            let Some(tail) = tail.trim_start().strip_prefix('=') else {
                continue;
            };
            tail.trim_start()
        };
        // Deserialize one JSON value; never evaluate the surrounding site JavaScript.
        if let Some(Ok(value)) = serde_json::Deserializer::from_str(json)
            .into_iter::<Value>()
            .next()
        {
            return Ok(value);
        }
    }
    Err("未识别到榜单数据，网站可能暂时限制访问或已更新页面".into())
}
fn categories(html: &str, channel: &str, board: &str) -> Vec<Category> {
    let doc = Html::parse_document(html);
    let selector = Selector::parse("a[href]").unwrap();
    let prefix = format!("/rank/{channel}_{board}_");
    let mut seen = HashSet::new();
    doc.select(&selector)
        .filter_map(|link| {
            let href = link.value().attr("href")?;
            let path = href.strip_prefix("https://fanqienovel.com").unwrap_or(href);
            let id = path.strip_prefix(&prefix)?;
            let name = link.text().collect::<String>().trim().to_owned();
            if !valid_id(id) || name.is_empty() || !seen.insert(id.to_owned()) {
                return None;
            }
            Some(Category {
                id: id.to_owned(),
                name,
            })
        })
        .collect()
}
fn fanqie_options(channel: &str, board: &str) -> Result<(), String> {
    if !["0", "1"].contains(&channel) || !["1", "2"].contains(&board) {
        return Err("请选择有效的番茄榜单".into());
    }
    Ok(())
}

#[derive(Serialize)]
pub struct Cover {
    bytes: Vec<u8>,
    mime: String,
}

fn cover_address(value: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(value).map_err(|_| "封面地址无效")?;
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || !(host == "bookcover.yuewen.com"
            || host.ends_with(".byteimg.com")
            || host.ends_with(".fqnovelpic.com"))
    {
        return Err("封面地址无效".into());
    }
    Ok(url)
}

async fn cover_bytes(client: &reqwest::Client, url: &str) -> Result<Cover, String> {
    let response = client
        .get(cover_address(url)?)
        .send()
        .await
        .map_err(|_error| {
            #[cfg(test)]
            eprintln!("{_error:?}");
            "封面连接失败".to_string()
        })?;
    cover_address(response.url().as_str())?;
    if !response.status().is_success() {
        return Err(format!(
            "封面加载失败（HTTP {}）",
            response.status().as_u16()
        ));
    }
    let mime = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .split(';')
        .next()
        .unwrap_or("")
        .to_owned();
    if ![
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/avif",
        "image/gif",
    ]
    .contains(&mime.as_str())
    {
        return Err("封面格式无法识别".into());
    }
    let mut chunks = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|_| "封面加载失败")?;
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("封面超过 2 MB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Cover { bytes, mime })
}

#[tauri::command]
pub async fn ranking_cover(book_url: String, cover_url: Option<String>) -> Result<Cover, String> {
    let url = reqwest::Url::parse(&book_url).map_err(|_| "作品地址无效")?;
    let segments: Vec<_> = url.path().trim_matches('/').split('/').collect();
    let platform = match (url.scheme(), url.host_str(), segments.as_slice()) {
        ("https", Some("m.qidian.com"), ["book", id]) if valid_id(id) => "qidian",
        ("https", Some("fanqienovel.com"), ["page", id]) if valid_id(id) => "fanqie",
        _ => return Err("作品地址无效".into()),
    };
    let client = client()?;
    tokio::time::timeout(Duration::from_secs(45), async {
        if platform == "qidian" {
            return cover_bytes(
                &client,
                &format!(
                    "https://bookcover.yuewen.com/qdbimg/349573/{}/180",
                    segments[1]
                ),
            )
            .await;
        }
        if let Some(address) = cover_url {
            if let Ok(cover) = cover_bytes(&client, &address).await {
                return Ok(cover);
            }
        }
        // Signed image URLs expire; refresh the public detail page for saved snapshots.
        let detail = script_json(&page(&client, &book_url).await?, false)?;
        if field(&detail["page"], &["bookId"]) != segments[1] {
            return Err("作品页不匹配".into());
        }
        cover_bytes(&client, &field(&detail["page"], &["thumbUri", "thumb_uri"])).await
    })
    .await
    .unwrap_or_else(|_| Err("封面加载超时".into()))
}
#[tauri::command]
pub async fn ranking_categories(channel: String, board: String) -> Result<Vec<Category>, String> {
    fanqie_options(&channel, &board)?;
    let seed = if channel == "1" { "1141" } else { "1139" };
    let html = page(
        &client()?,
        &format!("https://fanqienovel.com/rank/{channel}_{board}_{seed}"),
    )
    .await?;
    let result = categories(&html, &channel, &board);
    if result.is_empty() {
        return Err("未获取到榜单分类，请重试".into());
    }
    Ok(result)
}
fn qidian_books(html: &str, limit: usize) -> Result<(Vec<RankedBook>, usize), String> {
    let data = script_json(html, true)?;
    let rows = data
        .pointer("/pageContext/pageProps/pageData/records")
        .and_then(Value::as_array)
        .ok_or("起点榜单格式已变化，请稍后重试")?;
    let mut seen = HashSet::new();
    let mut books = Vec::new();
    for (i, row) in rows.iter().take(limit).enumerate() {
        let id = field(row, &["bid", "bookId"]);
        let title = field(row, &["bName", "bookName"]);
        if !valid_id(&id) || title.is_empty() || !clear_text(&title) || !seen.insert(id.clone()) {
            continue;
        }
        let value = field(row, &["rankCnt", "rankValue"]);
        books.push(RankedBook {
            url: format!("https://m.qidian.com/book/{id}/"),
            cover_url: format!("https://bookcover.yuewen.com/qdbimg/349573/{id}/180"),
            id,
            rank: field(row, &["rankNum"])
                .parse()
                .ok()
                .filter(|n| *n > 0)
                .unwrap_or(i + 1),
            title,
            author: field(row, &["bAuth", "author"]),
            genre: [field(row, &["cat"]), field(row, &["subCat"])]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" · "),
            intro: field(row, &["desc"]),
            words: field(row, &["cnt", "wordCount"]),
            status: String::new(),
            metrics: if value.is_empty() {
                vec![]
            } else {
                vec![Metric {
                    label: "榜单值".into(),
                    value,
                }]
            },
        });
    }
    let skipped = rows.len().min(limit) - books.len();
    Ok((books, skipped))
}
fn fanqie_detail(html: &str, row: &Value, index: usize) -> Result<RankedBook, String> {
    let data = script_json(html, false)?;
    let detail = &data["page"];
    let id = field(row, &["bookId", "book_id"]);
    if field(detail, &["bookId", "book_id"]) != id {
        return Err("作品页与榜单不匹配".into());
    }
    let title = field(detail, &["bookName"]);
    let author = field(detail, &["author", "authorName"]);
    let intro = field(detail, &["abstract"]);
    if title.is_empty() || ![&title, &author, &intro].iter().all(|s| clear_text(s)) {
        return Err("作品信息无法识别".into());
    }
    let tags: Value = serde_json::from_str(&field(detail, &["categoryV2"])).unwrap_or(Value::Null);
    let genre = tags
        .as_array()
        .map(|list| {
            list.iter()
                .map(|v| field(v, &["Name"]))
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" · ")
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| field(detail, &["category", "categoryName"]));
    let read_count = field(row, &["read_count", "readCount"]);
    let cover_url = field(detail, &["thumbUri", "thumb_uri", "coverUrl", "cover_url"]);
    Ok(RankedBook {
        url: format!("https://fanqienovel.com/page/{id}"),
        cover_url,
        id,
        rank: field(row, &["currentPos", "rank"])
            .parse()
            .ok()
            .filter(|n| *n > 0)
            .unwrap_or(index + 1),
        title,
        author,
        genre,
        intro,
        words: field(detail, &["wordNumber", "word_number"]),
        status: match field(detail, &["creationStatus"]).as_str() {
            "1" => "连载中",
            "0" | "2" => "已完结",
            _ => "",
        }
        .into(),
        metrics: if read_count.is_empty() {
            vec![]
        } else {
            vec![Metric {
                label: "在读人数".into(),
                value: read_count,
            }]
        },
    })
}
fn fanqie_next_rows(json: &str, version: &str) -> Result<Vec<Value>, String> {
    let data: Value = serde_json::from_str(json).map_err(|_| "番茄榜单分页读取失败")?;
    if data["code"].as_i64() != Some(0) {
        return Err("番茄榜单分页暂时不可用".into());
    }
    let next_version = field(&data["data"], &["rankVersion"]);
    if !version.is_empty() && next_version != version {
        return Err("番茄榜单已更新，请重新扫榜".into());
    }
    data.pointer("/data/book_list")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| "番茄榜单分页格式已变化".into())
}
async fn collect(request: &RankingRequest) -> Result<RankingResult, String> {
    if ![10, 20].contains(&request.limit) {
        return Err("采集数量须为 10 或 20".into());
    }
    let client = client()?;
    let mut result = match request.platform.as_str() {
        "qidian" => {
            let label = QIDIAN_BOARDS
                .iter()
                .find(|(id, _)| *id == request.board)
                .map(|(_, name)| *name)
                .ok_or("请选择有效的起点榜单")?;
            let source_url = format!("https://m.qidian.com/rank/{}/", request.board);
            let html = page(&client, &source_url).await?;
            let (books, skipped) = qidian_books(&html, request.limit)?;
            RankingResult {
                platform: "起点中文网".into(),
                board: label.into(),
                channel: "男频".into(),
                category: "全部分类".into(),
                source_url,
                books,
                skipped,
            }
        }
        "fanqie" => {
            fanqie_options(&request.channel, &request.board)?;
            if !valid_id(&request.category) {
                return Err("请选择番茄榜单分类".into());
            }
            let source_url = format!(
                "https://fanqienovel.com/rank/{}_{}_{}",
                request.channel, request.board, request.category
            );
            let html = page(&client, &source_url).await?;
            let category = categories(&html, &request.channel, &request.board)
                .into_iter()
                .find(|c| c.id == request.category)
                .ok_or("该榜单分类已不可用，请重新选择")?;
            let data = script_json(&html, false)?;
            let mut rows = data
                .pointer("/rank/book_list")
                .and_then(Value::as_array)
                .cloned()
                .ok_or("番茄榜单格式已变化，请稍后重试")?;
            let expected = field(&data["rank"], &["total_num"])
                .parse::<usize>()
                .unwrap_or(request.limit)
                .min(request.limit);
            let version = field(&data["rank"], &["rankVersion"]);
            while !rows.is_empty() && rows.len() < expected {
                let mut url = reqwest::Url::parse("https://fanqienovel.com/api/rank/category/list")
                    .map_err(|e| e.to_string())?;
                url.query_pairs_mut().extend_pairs([
                    ("app_id", "2503"),
                    ("rank_list_type", "3"),
                    ("offset", &rows.len().to_string()),
                    ("limit", "10"),
                    ("category_id", &request.category),
                    ("rank_version", &version),
                    ("gender", &request.channel),
                    ("rankMold", &request.board),
                ]);
                let next = match page(&client, url.as_str()).await {
                    Ok(json) => fanqie_next_rows(&json, &version),
                    Err(error) => Err(error),
                };
                match next {
                    Ok(next) if !next.is_empty() => {
                        rows.extend(next.into_iter().take(expected - rows.len()));
                    }
                    _ => break,
                }
            }
            let mut seen = HashSet::new();
            let selected: Vec<_> = rows
                .iter()
                .take(request.limit)
                .cloned()
                .enumerate()
                .filter(|(_, row)| {
                    let id = field(row, &["bookId", "book_id"]);
                    valid_id(&id) && seen.insert(id)
                })
                .collect();
            let responses: Vec<_> = stream::iter(selected.into_iter().map(|(i, row)| {
                let client = client.clone();
                async move {
                    let id = field(&row, &["bookId", "book_id"]);
                    let html = page(&client, &format!("https://fanqienovel.com/page/{id}")).await?;
                    fanqie_detail(&html, &row, i)
                }
            }))
            .buffer_unordered(4)
            .collect()
            .await;
            let books: Vec<_> = responses.into_iter().filter_map(Result::ok).collect();
            let skipped = expected.max(rows.len().min(request.limit)) - books.len();
            RankingResult {
                platform: "番茄小说".into(),
                board: if request.board == "2" {
                    "阅读榜"
                } else {
                    "新书榜"
                }
                .into(),
                channel: if request.channel == "1" {
                    "男频"
                } else {
                    "女频"
                }
                .into(),
                category: category.name,
                source_url,
                books,
                skipped,
            }
        }
        _ => return Err("暂不支持该榜单平台".into()),
    };
    if result.books.is_empty() {
        return Err("未获取到有效作品，请稍后重新扫榜".into());
    }
    result.books.sort_by_key(|book| book.rank);
    Ok(result)
}
#[tauri::command]
pub async fn collect_ranking(
    state: State<'_, crate::network::Requests>,
    request: RankingRequest,
) -> Result<RankingResult, String> {
    let (sender, mut cancel) = watch::channel(false);
    state
        .0
        .lock()
        .map_err(|_| "请求状态不可用")?
        .begin(&request.id, sender)?;
    let result = tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(120), collect(&request)) => result.unwrap_or_else(|_| Err("扫榜超时，请重试".into())),
        _ = cancel.changed() => Err("扫榜已停止".into()),
    };
    state
        .0
        .lock()
        .map_err(|_| "请求状态不可用")?
        .finish(&request.id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cover_addresses_only_accept_image_hosts() {
        assert!(cover_address("https://bookcover.yuewen.com/qdbimg/349573/123/180").is_ok());
        assert!(
            cover_address("https://p6-novel-sign.byteimg.com/cover.image?signature=abc").is_ok()
        );
        assert!(cover_address("file:///tmp/cover.png").is_err());
        assert!(cover_address("https://byteimg.com.example.com/cover.png").is_err());
        assert!(cover_address("http://localhost:8080/cover.png").is_err());
    }
    #[test]
    fn site_json_preserves_signed_url_query() {
        let html = r#"<script>window.__INITIAL_STATE__={"page":{"thumbUri":"https://p6-novel-sign.byteimg.com/cover.image?expires=123&signature=abc%2Bdef"}};</script>"#;
        let data = script_json(html, false).unwrap();
        assert_eq!(
            field(&data["page"], &["thumbUri"]),
            "https://p6-novel-sign.byteimg.com/cover.image?expires=123&signature=abc%2Bdef"
        );
    }
    #[test]
    fn qidian_keeps_real_ranks_and_missing_metrics() {
        let html = r#"<script id="vite-plugin-ssr_pageContext">{"pageContext":{"pageProps":{"pageData":{"records":[{"bid":"123","bName":"测试小说","rankNum":3,"cnt":"12万字","desc":"简介"},{"bid":"123","bName":"重复"},{"bid":"../bad","bName":"无效"}]}}}}</script>"#;
        let (books, skipped) = qidian_books(html, 10).unwrap();
        assert_eq!(books.len(), 1);
        assert_eq!(skipped, 2);
        assert_eq!(books[0].rank, 3);
        assert!(books[0].metrics.is_empty());
        assert!(qidian_books("<html>验证页面</html>", 10).is_err());
    }
    #[test]
    fn categories_respect_board_channel_and_deduplicate() {
        let html = r#"<a href="/rank/1_2_1141">西方奇幻</a><a href="/rank/1_2_1141">重复</a><a href="/rank/0_2_1139">古风世情</a><a href="/rank/1_1_1141">新书</a><a href="/rank/1_2_../bad">无效</a>"#;
        let result = categories(html, "1", "2");
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "西方奇幻");
    }
    #[test]
    fn fanqie_uses_clear_detail_and_preserves_large_ids() {
        let row = serde_json::json!({"bookId": 7654593151348247614u64, "bookName":"\u{e000}", "currentPos":7, "read_count":"123", "readCount":"0"});
        let html = r#"<script>window.__INITIAL_STATE__={"page":{"bookId":"7654593151348247614","bookName":"真实书名","author":"作者","abstract":"简介","categoryV2":"[{\"Name\":\"玄幻\"}]","creationStatus":1}}; doNotExecute();</script>"#;
        let book = fanqie_detail(html, &row, 0).unwrap();
        assert_eq!(book.id, "7654593151348247614");
        assert_eq!(book.title, "真实书名");
        assert_eq!(book.rank, 7);
        assert_eq!(book.genre, "玄幻");
        assert_eq!(book.metrics[0].value, "123");
        assert!(fanqie_detail(&html.replace("真实书名", "\u{e001}"), &row, 0).is_err());
        assert!(
            fanqie_detail(
                &html.replace("7654593151348247614", "7654593151348247600"),
                &row,
                0
            )
            .is_err()
        );
    }
    #[test]
    fn fanqie_pagination_requires_same_snapshot_and_keeps_rank() {
        let json = r#"{"code":0,"data":{"rankVersion":"12345","book_list":[{"bookId":7654593151348247614,"currentPos":11}]}}"#;
        let rows = fanqie_next_rows(json, "12345").unwrap();
        assert_eq!(field(&rows[0], &["bookId"]), "7654593151348247614");
        assert_eq!(field(&rows[0], &["currentPos"]), "11");
        assert!(fanqie_next_rows(json, "older").is_err());
        assert!(fanqie_next_rows(r#"{"code":403}"#, "12345").is_err());
        assert!(fanqie_next_rows("<html>验证页面</html>", "12345").is_err());
    }
    #[tokio::test]
    #[ignore = "requires access to public ranking websites"]
    async fn live_rankings() {
        for (platform, board, category) in [("qidian", "hotsales", ""), ("fanqie", "2", "1141")] {
            let result = collect(&RankingRequest {
                id: "test".into(),
                platform: platform.into(),
                board: board.into(),
                channel: "1".into(),
                category: category.into(),
                limit: 20,
            })
            .await
            .unwrap();
            assert_eq!(result.books.len(), 20);
            assert_eq!(result.skipped, 0);
            assert_eq!(result.books.last().unwrap().rank, 20);
            for book in &result.books {
                assert!(!book.title.is_empty());
                assert!(!book.intro.is_empty());
                assert!(!book.cover_url.is_empty());
            }
            let cover = ranking_cover(
                result.books[0].url.clone(),
                Some(result.books[0].cover_url.clone()),
            )
            .await
            .unwrap();
            assert!(!cover.bytes.is_empty());
            println!(
                "{} {}: {} books; first: {}",
                result.platform,
                result.board,
                result.books.len(),
                result.books[0].title
            );
        }
    }
}
