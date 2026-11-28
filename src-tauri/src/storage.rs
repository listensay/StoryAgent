use rusqlite::{Connection, params};
use std::{collections::HashMap, fs, path::PathBuf, sync::{Mutex, OnceLock}};
use tauri::{AppHandle, Manager};

fn connection(app: &AppHandle) -> Result<Connection, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let db = Connection::open(dir.join("storyagent.sqlite")).map_err(|e| e.to_string())?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);").map_err(|e| e.to_string())?;
    Ok(db)
}

#[tauri::command]
pub fn load_workspace(app: AppHandle) -> Result<Option<String>, String> {
    let db = connection(&app)?;
    let mut stmt = db
        .prepare("SELECT data FROM workspace WHERE id=1")
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    let data: Option<String> = rows.next()
        .map_err(|e| e.to_string())?
        .map(|row| row.get(0).map_err(|e| e.to_string()))
        .transpose()?;
    let value = match &data {
        Some(raw) => serde_json::from_str(raw).map_err(|_| "项目数据无效")?,
        None => serde_json::Value::Null,
    };
    crate::proxy::apply_settings(crate::proxy::ProxySettings::from_workspace(&value)?);
    Ok(data)
}

#[tauri::command]
pub async fn save_workspace(app: AppHandle, data: String, checkpoint: Option<bool>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || persist_workspace(app, data, checkpoint.unwrap_or(false))).await.map_err(|e| e.to_string())?
}

fn persist_workspace(app: AppHandle, data: String, checkpoint: bool) -> Result<(), String> {
    let value = serde_json::from_str::<serde_json::Value>(&data).map_err(|_| "项目数据无效".to_string())?;
    let proxy = crate::proxy::ProxySettings::from_workspace(&value)?;
    connection(&app)?.execute("INSERT INTO workspace(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![data]).map_err(|e| e.to_string())?;
    crate::proxy::apply_settings(proxy);
    // Don't spend the first hourly snapshot on the pristine launch screen.
    let has_data = ["projects", "deletedProjects", "deletedChapters", "jobs", "providers", "imageProviders", "references"]
        .iter().any(|key| value.get(*key).and_then(|v| v.as_array()).is_some_and(|items| !items.is_empty()))
        || value.get("creationDraft").is_some_and(|v| !v.is_null())
        || value.get("skills").and_then(|v| v.as_array()).is_some_and(|skills| skills.iter().any(|s| s.get("builtin").and_then(|v| v.as_bool()) == Some(false)));
    if !has_data && !checkpoint { return Ok(()); }
    // Save the working copy even if the backup volume is full; report backup failures separately.
    crate::backups::snapshot(&app, &data, checkpoint).map_err(|e| format!("工作区已写入，备份失败：{e}"))
}

const CREDENTIAL_SERVICE: &str = "com.od23.storyagent";
static SESSION_KEYS: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();

fn session_keys() -> &'static Mutex<HashMap<String, Option<String>>> {
    SESSION_KEYS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub fn provider_key(id: &str) -> Result<Option<String>, String> {
    let entry = credential(id)?;
    // Serialize the first read so concurrent AI requests cannot open duplicate prompts.
    let mut keys = session_keys().lock().map_err(|_| "密钥状态不可用")?;
    if let Some(key) = keys.get(id) { return Ok(key.clone()); }
    let key = match entry.get_password() {
        Ok(key) => Some(key),
        Err(keyring::Error::NoEntry) => None,
        Err(error) => return Err(format!("读取密钥失败：{error}")),
    };
    keys.insert(id.to_string(), key.clone());
    Ok(key)
}

pub fn credential(id: &str) -> Result<keyring::Entry, String> {
    if id.is_empty() || id.len() > 128 {
        return Err("服务标识无效".into());
    }
    keyring::Entry::new(CREDENTIAL_SERVICE, id).map_err(|e| format!("凭据库不可用：{e}"))
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn save_credential(id: String, secret: String) -> Result<(), String> {
    credential(&id)?;
    let mut keys = session_keys().lock().map_err(|_| "密钥状态不可用")?;
    // SecItemAdd/Update updates an existing entry without first reading its secret.
    // The legacy keyring setter treats every read failure as a missing entry.
    let result = if secret.is_empty() {
        match security_framework::passwords::delete_generic_password(CREDENTIAL_SERVICE, &id) {
            Ok(()) => Ok(()),
            Err(e) if e.code() == -25300 => Ok(()),
            Err(e) => Err(format!("密钥保存失败：{e}")),
        }
    } else {
        security_framework::passwords::set_generic_password(CREDENTIAL_SERVICE, &id, secret.as_bytes())
            .map_err(|e| format!("密钥保存失败：{e}"))
    };
    if result.is_ok() { keys.insert(id, if secret.is_empty() { None } else { Some(secret) }); }
    result
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn save_credential(id: String, secret: String) -> Result<(), String> {
    let entry = credential(&id)?;
    let mut keys = session_keys().lock().map_err(|_| "密钥状态不可用")?;
    let result = if secret.is_empty() {
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        entry.set_password(&secret).map_err(|e| e.to_string())
    };
    if result.is_ok() { keys.insert(id, if secret.is_empty() { None } else { Some(secret) }); }
    result
}

#[cfg(all(test, target_os = "macos"))]
mod credential_tests {
    use super::*;

    #[test]
    fn updates_existing_keychain_credentials() {
        let id = format!("storyagent-credential-test-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let entry = credential(&id).unwrap();
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) { let _ = save_credential(self.0.clone(), String::new()); }
        }
        let _cleanup = Cleanup(id.clone());
        entry.set_password("legacy-test-secret").unwrap();
        assert!(credential_exists(id.clone()).unwrap());
        save_credential(id.clone(), "updated-test-secret".into()).unwrap();
        assert_eq!(entry.get_password().unwrap(), "updated-test-secret");
        assert_eq!(provider_key(&id).unwrap().as_deref(), Some("updated-test-secret"));
        save_credential(id.clone(), "updated-test-secret".into()).unwrap();
        save_credential(id.clone(), "replacement-test-secret".into()).unwrap();
        assert_eq!(entry.get_password().unwrap(), "replacement-test-secret");
        assert_eq!(provider_key(&id).unwrap().as_deref(), Some("replacement-test-secret"));
        save_credential(id.clone(), String::new()).unwrap();
        assert!(provider_key(&id).unwrap().is_none());
        assert!(!credential_exists(id.clone()).unwrap());
        save_credential(id, String::new()).unwrap();
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn credential_exists(id: String) -> Result<bool, String> {
    credential(&id)?;
    use security_framework::item::{ItemClass, ItemSearchOptions};
    // Query metadata only. Never fetch password bytes merely to render settings.
    match ItemSearchOptions::new().class(ItemClass::generic_password())
        .service(CREDENTIAL_SERVICE).account(&id).load_attributes(true).load_data(false).search() {
        Ok(items) => Ok(!items.is_empty()),
        Err(error) if error.code() == -25300 => Ok(false),
        Err(error) => Err(format!("凭据库不可用：{error}")),
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn credential_exists(id: String) -> Result<bool, String> {
    match credential(&id)?.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedFile {
    name: String,
    bytes: Vec<u8>,
}

const MAX_FILE: u64 = 20 * 1024 * 1024;

#[tauri::command]
pub async fn pick_cover() -> Result<Option<ImportedFile>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let Some(path) = rfd::FileDialog::new().set_title("上传封面").add_filter("图片", &["png", "jpg", "jpeg", "webp"]).pick_file() else { return Ok(None); };
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > 10 * 1024 * 1024 { return Err("封面图片须小于 10 MB".into()); }
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        read_file(path, name).map(Some)
    }).await.map_err(|e| e.to_string())?
}

fn read_file(path: PathBuf, name: String) -> Result<ImportedFile, String> {
    if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_FILE {
        return Err("文件超过 20 MB".into());
    }
    Ok(ImportedFile {
        name,
        bytes: fs::read(path).map_err(|e| e.to_string())?,
    })
}

#[tauri::command]
pub async fn pick_files(folder: bool, skills: bool) -> Result<Vec<ImportedFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if folder {
            let Some(path) = rfd::FileDialog::new()
                .set_title("选择 Skill 文件夹")
                .pick_folder()
            else {
                return Ok(vec![]);
            };
            let mut files = vec![];
            let mut total = 0;
            fn walk(
                root: &std::path::Path,
                dir: &std::path::Path,
                files: &mut Vec<ImportedFile>,
                total: &mut u64,
                depth: usize,
            ) -> Result<(), String> {
                if depth > 12 {
                    return Err("文件夹层级超过限制".into());
                }
                for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
                    let item = item.map_err(|e| e.to_string())?;
                    let ty = item.file_type().map_err(|e| e.to_string())?;
                    if ty.is_symlink() {
                        continue;
                    }
                    if ty.is_dir() {
                        if [".git", "node_modules", "target"]
                            .contains(&item.file_name().to_string_lossy().as_ref())
                        {
                            continue;
                        }
                        walk(root, &item.path(), files, total, depth + 1)?;
                    } else if ty.is_file() {
                        *total += item.metadata().map_err(|e| e.to_string())?.len();
                        if *total > MAX_FILE || files.len() >= 2000 {
                            return Err("文件夹超过导入限制".into());
                        }
                        files.push(read_file(
                            item.path(),
                            item.path()
                                .strip_prefix(root)
                                .map_err(|e| e.to_string())?
                                .to_string_lossy()
                                .replace('\\', "/"),
                        )?);
                    }
                }
                Ok(())
            }
            walk(&path, &path, &mut files, &mut total, 0)?;
            Ok(files)
        } else {
            let dialog = rfd::FileDialog::new().set_title("导入文件");
            let dialog = if skills {
                dialog.add_filter("Skill", &["md", "zip"])
            } else {
                dialog.add_filter("文本与数据", &["txt", "md", "json", "csv"])
            };
            let Some(paths) = dialog.pick_files() else {
                return Ok(vec![]);
            };
            paths
                .into_iter()
                .map(|path| {
                    let name = path
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string();
                    read_file(path, name)
                })
                .collect()
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn export_file(name: String, content: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .set_title("导出")
            .set_file_name(&name)
            .save_file()
        else {
            return Ok(false);
        };
        fs::write(path, content).map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
