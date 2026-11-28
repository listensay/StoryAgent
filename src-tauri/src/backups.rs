use std::{fs, io::Write, path::{Path, PathBuf}, sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{AppHandle, Manager};

// Separate files remain readable if SQLite cannot load the working copy.
const INTERVAL_MS: u64 = 60 * 60 * 1_000;
const KEEP: usize = 14;
static WRITER: Mutex<()> = Mutex::new(());

fn directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|p| p.join("workspace-backups")).map_err(|e| e.to_string())
}
fn ids(dir: &Path) -> Result<Vec<u64>, String> {
    let entries = match fs::read_dir(dir) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    let mut values = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_file() { continue; }
        let name = entry.file_name();
        if let Some(n) = name.to_str().and_then(|s| s.strip_suffix(".json")).and_then(|s| s.parse::<u64>().ok()) {
            if name.to_string_lossy() == format!("{n}.json") { values.push(n); }
        }
    }
    values.sort_unstable_by(|a, b| b.cmp(a));
    Ok(values)
}
pub fn snapshot(app: &AppHandle, data: &str, force: bool) -> Result<(), String> {
    let _guard = WRITER.lock().map_err(|_| "备份不可用")?;
    let dir = directory(app)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e| e.to_string())?.as_millis() as u64;
    snapshot_at(&dir, data, force, stamp)
}
fn snapshot_at(dir: &Path, data: &str, force: bool, stamp: u64) -> Result<(), String> {
    let existing = ids(dir)?;
    if !force && existing.iter().any(|last| *last <= stamp && stamp - *last < INTERVAL_MS) { return Ok(()); }
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut id = stamp;
    while dir.join(format!("{id}.json")).exists() { id += 1; }
    let path = dir.join(format!("{id}.json"));
    let temp = dir.join(format!("{id}-{}.tmp", std::process::id()));
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(&temp).map_err(|e| e.to_string())?;
    let result = file.write_all(data.as_bytes()).and_then(|_| file.sync_all());
    drop(file);
    if let Err(e) = result.and_then(|_| fs::rename(&temp, &path)) { let _ = fs::remove_file(&temp); return Err(e.to_string()); }
    for old in existing.iter().skip(KEEP - 1) { fs::remove_file(dir.join(format!("{old}.json"))).map_err(|e| e.to_string())?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("storyagent-backup-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos())))
        }
    }
    impl Drop for Directory { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    #[test]
    fn hourly_backups_and_forced_recovery_preserve_exact_data() {
        let dir = Directory::new();
        snapshot_at(&dir.0, "原始正文", false, INTERVAL_MS).unwrap();
        snapshot_at(&dir.0, "未到一小时", false, INTERVAL_MS + 1).unwrap();
        assert_eq!(ids(&dir.0).unwrap(), vec![INTERVAL_MS]);
        snapshot_at(&dir.0, "恢复前正文", true, INTERVAL_MS).unwrap();
        assert_eq!(ids(&dir.0).unwrap(), vec![INTERVAL_MS + 1, INTERVAL_MS]);
        assert_eq!(fs::read_to_string(dir.0.join(format!("{}.json", INTERVAL_MS + 1))).unwrap(), "恢复前正文");
        assert_eq!(fs::read_to_string(dir.0.join(format!("{INTERVAL_MS}.json"))).unwrap(), "原始正文");
        snapshot_at(&dir.0, "下一小时", false, INTERVAL_MS * 2 + 1).unwrap();
        assert_eq!(ids(&dir.0).unwrap().len(), 3);
    }

    #[test]
    fn keeps_fourteen_completed_backups_and_ignores_other_entries() {
        let dir = Directory::new();
        for stamp in 1..=18 { snapshot_at(&dir.0, &stamp.to_string(), true, stamp).unwrap(); }
        fs::write(dir.0.join("999.tmp"), "incomplete").unwrap();
        fs::write(dir.0.join("0001.json"), "noncanonical").unwrap();
        fs::create_dir(dir.0.join("1000.json")).unwrap();
        let list = ids(&dir.0).unwrap();
        assert_eq!(list, (5..=18).rev().collect::<Vec<_>>());
        for stamp in list { assert_eq!(fs::read_to_string(dir.0.join(format!("{stamp}.json"))).unwrap(), stamp.to_string()); }
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(fs::metadata(dir.0.join("18.json")).unwrap().permissions().mode() & 0o777, 0o600);
        }
    }
}
#[tauri::command]
pub fn list_workspace_backups(app: AppHandle) -> Result<Vec<u64>, String> { ids(&directory(&app)?) }

#[tauri::command]
pub async fn read_workspace_backup(app: AppHandle, id: u64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = directory(&app)?;
        if !ids(&dir)?.contains(&id) { return Err("备份已移除".into()); }
        fs::read_to_string(dir.join(format!("{id}.json"))).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
