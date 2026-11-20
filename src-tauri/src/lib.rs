mod articles;
mod network;
mod research;
mod rankings;
mod storage;
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(network::Requests::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            storage::load_workspace,
            storage::save_workspace,
            storage::save_credential,
            storage::credential_exists,
            storage::pick_files,
            storage::export_file,
            network::http_request,
            network::cancel_http,
            articles::validate_article_rule,
            articles::read_article_page,
            articles::search_article_books,
            research::read_research_catalog,
            research::read_research_chapter,
            rankings::ranking_categories,
            rankings::ranking_cover,
            rankings::collect_ranking
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
