mod network;
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
            network::fetch_page,
            rankings::ranking_categories,
            rankings::ranking_cover,
            rankings::collect_ranking
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
