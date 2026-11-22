mod articles;
mod network;
mod proxy;
mod research;
mod rankings;
mod storage;
mod updates;
use tauri::Manager;
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(network::Requests::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            storage::load_workspace,
            storage::save_workspace,
            storage::save_credential,
            storage::credential_exists,
            storage::pick_files,
            storage::pick_cover,
            storage::export_file,
            network::http_request,
            network::cancel_http,
            network::has_active_requests,
            proxy::detect_proxy,
            proxy::validate_proxy_settings,
            updates::check_app_update,
            updates::diagnose_update_source,
            articles::validate_article_rule,
            articles::read_article_page,
            articles::search_article_books,
            research::read_research_catalog,
            research::read_research_chapter,
            rankings::ranking_categories,
            rankings::ranking_cover,
            rankings::collect_ranking
        ]);
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|app| {
        use tauri::menu::{Menu, MenuItem, MenuItemKind};
        let menu = Menu::default(app)?;
        if let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.first() {
            if let Some(MenuItemKind::Predefined(quit)) = app_menu.items()?.last() {
                // Native Quit terminates AppKit directly, bypassing ExitRequested.
                let quit_item = MenuItem::with_id(app, "save-and-quit", quit.text()?, true, Some("CmdOrCtrl+Q"))?;
                app_menu.remove(quit)?;
                app_menu.append(&quit_item)?;
            }
        }
        Ok(menu)
    }).on_menu_event(|app, event| {
        if event.id().as_ref() == "save-and-quit" { app.exit(0); }
    });
    builder.build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                let windows = app.webview_windows();
                if !windows.is_empty() && code != Some(tauri::RESTART_EXIT_CODE) {
                    // Let the existing close handler save pending workspace changes.
                    api.prevent_exit();
                    for window in windows.values() { let _ = window.close(); }
                }
            }
        });
}
