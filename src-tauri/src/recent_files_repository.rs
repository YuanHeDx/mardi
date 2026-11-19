use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const STORE_VERSION: u32 = 1;
const STORE_FILE_NAME: &str = "recent-files-v1.json";
const MAX_RECENT_FILES: usize = 100;
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RecentFileKind {
    Markdown,
    Image,
    Video,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RecentFilePayload {
    path: String,
    name: String,
    kind: RecentFileKind,
    last_opened_at: u64,
}

#[derive(Deserialize, Serialize)]
struct RecentFilesStore {
    version: u32,
    files: Vec<RecentFilePayload>,
}

impl Default for RecentFilesStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            files: Vec::new(),
        }
    }
}

fn error_message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(STORE_FILE_NAME))
        .map_err(error_message)
}

fn normalize_files(mut files: Vec<RecentFilePayload>) -> Vec<RecentFilePayload> {
    // Stable sorting preserves MRU order when multiple opens share a millisecond.
    files.sort_by_key(|item| std::cmp::Reverse(item.last_opened_at));
    let mut paths = HashSet::new();
    files.retain(|item| paths.insert(item.path.clone()));
    files.truncate(MAX_RECENT_FILES);
    files
}

fn read_store(path: &Path) -> Result<RecentFilesStore, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RecentFilesStore::default());
        }
        Err(error) => return Err(error_message(error)),
    };
    let mut store = match serde_json::from_slice::<RecentFilesStore>(&bytes) {
        Ok(store) if store.version == STORE_VERSION => store,
        _ => RecentFilesStore::default(),
    };
    store.files = normalize_files(store.files);
    Ok(store)
}

fn write_store(path: &Path, store: &RecentFilesStore) -> Result<(), String> {
    let directory = path
        .parent()
        .ok_or_else(|| "无法确定 mardi 配置目录".to_string())?;
    fs::create_dir_all(directory).map_err(error_message)?;
    let temporary_path = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(store).map_err(error_message)?;
    let result = (|| {
        let mut file = File::create(&temporary_path).map_err(error_message)?;
        file.write_all(&bytes).map_err(error_message)?;
        file.sync_all().map_err(error_message)?;
        fs::rename(&temporary_path, path).map_err(error_message)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

// Old paths may have disappeared after trash/rename. Never canonicalize them.
fn absolute_lexical_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("最近文件路径必须是绝对路径".into());
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err("最近文件路径不能越过根目录".into());
                }
            }
            Component::CurDir => {}
            _ => normalized.push(component.as_os_str()),
        }
    }
    Ok(normalized)
}

fn recent_kind(path: &Path) -> Result<RecentFileKind, String> {
    match crate::file_kind(path) {
        Some(crate::FileKind::Markdown) => Ok(RecentFileKind::Markdown),
        Some(crate::FileKind::Image) => Ok(RecentFileKind::Image),
        Some(crate::FileKind::Video) => Ok(RecentFileKind::Video),
        _ => Err("mardi 不支持这个文件类型".into()),
    }
}

fn require_regular_file(path: &Path) -> Result<(), String> {
    if !fs::metadata(path).map_err(error_message)?.is_file() {
        return Err("最近文件必须是可读取的文件".into());
    }
    Ok(())
}

fn remember_at(
    store_path: &Path,
    path: &Path,
    timestamp: u64,
) -> Result<Vec<RecentFilePayload>, String> {
    if !path.is_absolute() {
        return Err("最近文件路径必须是绝对路径".into());
    }
    let path = path.canonicalize().map_err(error_message)?;
    let kind = recent_kind(&path)?;
    // Reject FIFOs and devices before opening: an ordinary read-only open can
    // block on a named pipe while holding the repository mutex.
    require_regular_file(&path)?;
    // Opening the handle checks readability without loading document/media content
    // or granting any asset-protocol access.
    let file = File::open(&path).map_err(error_message)?;
    if !file.metadata().map_err(error_message)?.is_file() {
        return Err("最近文件必须是可读取的文件".into());
    }
    let mut store = read_store(store_path)?;
    let path_string = path.to_string_lossy().into_owned();
    let timestamp = timestamp.max(store.files.first().map_or(0, |file| file.last_opened_at));
    store.files.retain(|item| item.path != path_string);
    store.files.insert(
        0,
        RecentFilePayload {
            name: path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Untitled")
                .to_owned(),
            path: path_string,
            kind,
            last_opened_at: timestamp,
        },
    );
    store.files.truncate(MAX_RECENT_FILES);
    write_store(store_path, &store)?;
    Ok(store.files)
}

fn forget_at(store_path: &Path, path: &Path) -> Result<Vec<RecentFilePayload>, String> {
    let path = absolute_lexical_path(path)?;
    let mut store = read_store(store_path)?;
    store
        .files
        .retain(|item| !Path::new(&item.path).starts_with(&path));
    write_store(store_path, &store)?;
    Ok(store.files)
}

fn relocate_at(
    store_path: &Path,
    previous_path: &Path,
    next_path: &Path,
) -> Result<Vec<RecentFilePayload>, String> {
    let previous_path = absolute_lexical_path(previous_path)?;
    let next_path = absolute_lexical_path(next_path)?
        .canonicalize()
        .map_err(error_message)?;
    if !next_path.is_file() && !next_path.is_dir() {
        return Err("新路径必须是现存的文件或文件夹".into());
    }
    let mut store = read_store(store_path)?;
    for item in &mut store.files {
        if let Ok(suffix) = Path::new(&item.path).strip_prefix(&previous_path) {
            let path = if suffix.as_os_str().is_empty() {
                next_path.clone()
            } else {
                next_path.join(suffix)
            };
            item.name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Untitled")
                .to_owned();
            item.path = path.to_string_lossy().into_owned();
        }
    }
    store.files = normalize_files(store.files);
    write_store(store_path, &store)?;
    Ok(store.files)
}

#[tauri::command]
pub(crate) fn list_recent_files(app: AppHandle) -> Result<Vec<RecentFilePayload>, String> {
    let _guard = STORE_LOCK.lock().map_err(error_message)?;
    Ok(read_store(&store_path(&app)?)?.files)
}

#[tauri::command]
pub(crate) fn remember_recent_file(
    app: AppHandle,
    path: String,
) -> Result<Vec<RecentFilePayload>, String> {
    let _guard = STORE_LOCK.lock().map_err(error_message)?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    remember_at(&store_path(&app)?, Path::new(&path), timestamp)
}

#[tauri::command]
pub(crate) fn forget_recent_file(
    app: AppHandle,
    path: String,
) -> Result<Vec<RecentFilePayload>, String> {
    let _guard = STORE_LOCK.lock().map_err(error_message)?;
    forget_at(&store_path(&app)?, Path::new(&path))
}

#[tauri::command]
pub(crate) fn relocate_recent_files(
    app: AppHandle,
    previous_path: String,
    next_path: String,
) -> Result<Vec<RecentFilePayload>, String> {
    let _guard = STORE_LOCK.lock().map_err(error_message)?;
    relocate_at(
        &store_path(&app)?,
        Path::new(&previous_path),
        Path::new(&next_path),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn fixture() -> (TempDir, PathBuf) {
        let temporary = TempDir::new().unwrap();
        let store_path = temporary.path().join(STORE_FILE_NAME);
        (temporary, store_path)
    }

    fn file(directory: &Path, name: &str) -> PathBuf {
        let path = directory.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "test").unwrap();
        path.canonicalize().unwrap()
    }

    #[test]
    fn persists_canonical_mru_across_reads_and_keeps_ties_stable() {
        let (temporary, store_path) = fixture();
        let a = file(temporary.path(), "a.md");
        let b = file(temporary.path(), "b.png");
        remember_at(&store_path, &a, 20).unwrap();
        remember_at(&store_path, &b, 20).unwrap();
        let alias = a.parent().unwrap().join(".").join("a.md");
        let files = remember_at(&store_path, &alias, 10).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].path, a.to_string_lossy());
        assert_eq!(files[0].last_opened_at, 20);
        assert_eq!(read_store(&store_path).unwrap().files, files);
        let json = serde_json::to_value(&files[0]).unwrap();
        assert_eq!(json["lastOpenedAt"], 20);
        assert_eq!(json["kind"], "markdown");
    }

    #[test]
    fn caps_history_and_reopening_deduplicates() {
        let (temporary, store_path) = fixture();
        for index in 0..105 {
            remember_at(
                &store_path,
                &file(temporary.path(), &format!("{index}.md")),
                index,
            )
            .unwrap();
        }
        let files = remember_at(&store_path, &temporary.path().join("10.md"), 200).unwrap();
        assert_eq!(files.len(), MAX_RECENT_FILES);
        assert!(files[0].path.ends_with("/10.md"));
        assert_eq!(
            files
                .iter()
                .filter(|item| item.path.ends_with("/10.md"))
                .count(),
            1
        );
        assert!(!files.iter().any(|item| item.path.ends_with("/0.md")));
    }

    #[test]
    fn forgets_missing_directory_with_component_boundaries() {
        let (temporary, store_path) = fixture();
        let a = file(temporary.path(), "notes/a.md");
        let b = file(temporary.path(), "notes-other/b.md");
        remember_at(&store_path, &a, 1).unwrap();
        remember_at(&store_path, &b, 2).unwrap();
        let old_directory = a.parent().unwrap().to_path_buf();
        fs::remove_dir_all(&old_directory).unwrap();
        let files = forget_at(&store_path, &old_directory.join(".")).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, b.to_string_lossy());
        assert!(absolute_lexical_path(Path::new("/../notes")).is_err());
        assert!(forget_at(&store_path, Path::new("relative.md")).is_err());
    }

    #[test]
    fn relocates_renamed_directory_without_reordering_and_keeps_newer_collision() {
        let (temporary, store_path) = fixture();
        let a = file(temporary.path(), "notes/a.md");
        let sibling = file(temporary.path(), "notes-other/b.md");
        remember_at(&store_path, &a, 1).unwrap();
        remember_at(&store_path, &sibling, 2).unwrap();
        let previous = a.parent().unwrap();
        let next = temporary.path().join("renamed");
        fs::rename(previous, &next).unwrap();
        let files = relocate_at(&store_path, previous, &next).unwrap();
        assert_eq!(files[0].path, sibling.to_string_lossy());
        assert!(files[1].path.ends_with("/renamed/a.md"));
        assert_eq!(files[1].last_opened_at, 1);
        let renamed = next.join("a.md");
        remember_at(&store_path, &renamed, 3).unwrap();
        // A duplicate target already recorded more recently wins after relocation.
        let mut store = read_store(&store_path).unwrap();
        store.files.push(RecentFilePayload {
            path: a.to_string_lossy().into_owned(),
            name: "a.md".into(),
            kind: RecentFileKind::Markdown,
            last_opened_at: 1,
        });
        write_store(&store_path, &store).unwrap();
        let files = relocate_at(&store_path, previous, &next).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].last_opened_at, 3);
    }

    #[test]
    fn relocates_an_exact_file_to_a_canonical_path_and_updates_its_name() {
        let (temporary, store_path) = fixture();
        let previous = file(temporary.path(), "before.md");
        remember_at(&store_path, &previous, 1).unwrap();
        let next = temporary.path().join("after.md");
        fs::rename(&previous, &next).unwrap();
        let files = relocate_at(&store_path, &previous, &next).unwrap();
        assert_eq!(
            files[0].path,
            next.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(files[0].name, "after.md");
        assert_eq!(files[0].last_opened_at, 1);
    }

    #[test]
    fn an_atomic_write_failure_keeps_the_previous_store_and_roots_untouched() {
        let (temporary, store_path) = fixture();
        let a = file(temporary.path(), "a.md");
        remember_at(&store_path, &a, 1).unwrap();
        let roots = temporary.path().join("project-roots-v1.json");
        fs::write(&roots, b"existing roots and view state").unwrap();
        let original = fs::read(&store_path).unwrap();
        fs::create_dir(store_path.with_extension("json.tmp")).unwrap();
        assert!(remember_at(&store_path, &a, 2).is_err());
        assert_eq!(fs::read(&store_path).unwrap(), original);
        assert_eq!(fs::read(roots).unwrap(), b"existing roots and view state");
    }

    #[cfg(unix)]
    #[test]
    fn canonicalizes_symlinks_and_rejects_unreadable_files() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let (temporary, store_path) = fixture();
        let video = file(temporary.path(), "video.MP4");
        let alias = temporary.path().join("alias.MP4");
        symlink(&video, &alias).unwrap();
        remember_at(&store_path, &alias, 1).unwrap();
        let files = remember_at(&store_path, &video, 2).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].kind, RecentFileKind::Video);
        fs::set_permissions(&video, fs::Permissions::from_mode(0o000)).unwrap();
        assert!(remember_at(&store_path, &video, 3).is_err());
        fs::set_permissions(&video, fs::Permissions::from_mode(0o600)).unwrap();
        assert_eq!(read_store(&store_path).unwrap().files, files);
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_supported_extension_fifo_before_any_open() {
        let (temporary, _) = fixture();
        let fifo = temporary.path().join("pipe.png");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .unwrap();
        assert!(status.success());
        assert_eq!(recent_kind(&fifo).unwrap(), RecentFileKind::Image);
        // Exercise metadata validation alone so a regression cannot hang this
        // test runner by attempting a blocking read-open of the FIFO.
        assert_eq!(
            require_regular_file(&fifo).unwrap_err(),
            "最近文件必须是可读取的文件"
        );
    }

    #[test]
    fn rejects_unsupported_missing_and_unwritable_paths_without_losing_history() {
        let (temporary, store_path) = fixture();
        let a = file(temporary.path(), "a.md");
        let expected = remember_at(&store_path, &a, 1).unwrap();
        assert!(remember_at(&store_path, &file(temporary.path(), "bad.txt"), 2).is_err());
        assert!(remember_at(&store_path, &temporary.path().join("missing.md"), 2).is_err());
        assert_eq!(
            remember_at(&store_path, Path::new("relative.md"), 2).unwrap_err(),
            "最近文件路径必须是绝对路径"
        );
        assert_eq!(read_store(&store_path).unwrap().files, expected);
        let blocker = file(temporary.path(), "blocker");
        assert!(remember_at(&blocker.join("history.json"), &a, 2).is_err());
        assert!(read_store(temporary.path()).is_err());
        fs::write(&store_path, b"invalid json").unwrap();
        assert!(read_store(&store_path).unwrap().files.is_empty());
        remember_at(&store_path, &a, 3).unwrap();
        assert_eq!(read_store(&store_path).unwrap().files.len(), 1);
    }
}
