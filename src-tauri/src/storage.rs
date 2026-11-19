use rusqlite::{Connection, params};
use std::{fs, path::PathBuf};
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
    rows.next()
        .map_err(|e| e.to_string())?
        .map(|row| row.get(0).map_err(|e| e.to_string()))
        .transpose()
}

#[tauri::command]
pub fn save_workspace(app: AppHandle, data: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&data).map_err(|_| "项目数据无效".to_string())?;
    connection(&app)?.execute("INSERT INTO workspace(id,data) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![data]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn credential(id: &str) -> Result<keyring::Entry, String> {
    if id.is_empty() || id.len() > 128 {
        return Err("服务标识无效".into());
    }
    keyring::Entry::new("com.od23.storyagent", id).map_err(|e| format!("凭据库不可用：{e}"))
}

#[tauri::command]
pub fn save_credential(id: String, secret: String) -> Result<(), String> {
    let entry = credential(&id)?;
    if secret.is_empty() {
        match entry.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    } else {
        entry.set_password(&secret).map_err(|e| e.to_string())
    }
}

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
