mod project_repository;
mod recent_files_repository;
mod workspace_files;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use notify::{EventKind, RecursiveMode, Watcher, event::ModifyKind};
use serde::Serialize;
#[cfg(unix)]
use std::os::unix::fs::MetadataExt;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

use project_repository::{ProjectRootPayload, ProjectViewStatePayload};

const MAX_DOCUMENT_BYTES: u64 = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;
const MAX_WORKSPACE_DEPTH: usize = 16;
const MAX_WORKSPACE_ENTRIES: usize = 20_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentPayload {
    path: String,
    name: String,
    content: String,
    file_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentLocationPayload {
    path: String,
    name: String,
    file_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry {
    path: String,
    name: String,
    kind: FileKind,
    children: Vec<WorkspaceEntry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum FileKind {
    Directory,
    Markdown,
    Image,
    Video,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceSnapshot {
    root_path: String,
    root_name: String,
    entries: Vec<WorkspaceEntry>,
    is_truncated: bool,
}

#[derive(Default)]
struct WorkspaceWatcherState {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

#[derive(Default)]
struct PendingOpenFiles(Mutex<Vec<String>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum WorkspaceChangeKind {
    Content,
    Structure,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFilesChangedPayload {
    paths: Vec<String>,
    kind: WorkspaceChangeKind,
}

fn error_message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

#[cfg(unix)]
fn file_identity(metadata: &fs::Metadata) -> Option<String> {
    Some(format!("{}:{}", metadata.dev(), metadata.ino()))
}

#[cfg(not(unix))]
fn file_identity(_metadata: &fs::Metadata) -> Option<String> {
    None
}

fn is_markdown_file(path: &Path) -> bool {
    file_kind(path) == Some(FileKind::Markdown)
}

fn file_kind(path: &Path) -> Option<FileKind> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())?
        .to_ascii_lowercase()
        .as_str()
    {
        "md" | "markdown" => Some(FileKind::Markdown),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "avif" => Some(FileKind::Image),
        "mp4" | "mov" | "m4v" | "webm" => Some(FileKind::Video),
        _ => None,
    }
}

fn require_markdown_file(path: &Path) -> Result<(), String> {
    if !is_markdown_file(path) {
        return Err("mardi 只能打开 .md 或 .markdown 文件".into());
    }
    if !path.is_file() {
        return Err("Markdown 文件不存在或无法读取".into());
    }
    Ok(())
}

#[tauri::command]
fn take_pending_open_files(state: tauri::State<PendingOpenFiles>) -> Vec<String> {
    let Ok(mut paths) = state.0.lock() else {
        return Vec::new();
    };
    std::mem::take(&mut *paths)
}

#[tauri::command]
fn read_document(path: String) -> Result<DocumentPayload, String> {
    let file_path = PathBuf::from(path);
    require_markdown_file(&file_path)?;

    let metadata = fs::metadata(&file_path).map_err(error_message)?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err("Markdown 文件超过 8 MB，MVP 暂不支持打开".into());
    }

    let content = fs::read_to_string(&file_path)
        .map_err(|_| "文件不是有效的 UTF-8 文本，无法打开".to_string())?;
    let canonical_path = file_path.canonicalize().map_err(error_message)?;
    let name = canonical_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_owned();

    Ok(DocumentPayload {
        path: canonical_path.to_string_lossy().into_owned(),
        name,
        content,
        file_id: file_identity(&metadata),
    })
}

fn document_location_for_identity(
    path: &Path,
    expected_file_id: &str,
) -> Result<Option<DocumentLocationPayload>, String> {
    if !is_markdown_file(path) {
        return Ok(None);
    }
    let metadata = match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error_message(error)),
    };
    if file_identity(&metadata).as_deref() != Some(expected_file_id) {
        return Ok(None);
    }

    let path = path.canonicalize().map_err(error_message)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_owned();
    Ok(Some(DocumentLocationPayload {
        path: path.to_string_lossy().into_owned(),
        name,
        file_id: expected_file_id.to_owned(),
    }))
}

fn document_location_for_existing_path(
    path: &Path,
) -> Result<Option<DocumentLocationPayload>, String> {
    if !is_markdown_file(path) {
        return Ok(None);
    }
    let metadata = match fs::metadata(path) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error_message(error)),
    };
    let Some(file_id) = file_identity(&metadata) else {
        return Ok(None);
    };
    let path = path.canonicalize().map_err(error_message)?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Untitled.md")
        .to_owned();
    Ok(Some(DocumentLocationPayload {
        path: path.to_string_lossy().into_owned(),
        name,
        file_id,
    }))
}

fn locate_document_in_directory(
    directory: &Path,
    expected_file_id: &str,
    depth: usize,
    entry_count: &mut usize,
) -> Result<Option<DocumentLocationPayload>, String> {
    if depth > MAX_WORKSPACE_DEPTH || *entry_count >= MAX_WORKSPACE_ENTRIES {
        return Ok(None);
    }

    let items = match fs::read_dir(directory) {
        Ok(items) => items,
        Err(_) => return Ok(None),
    };
    for item in items {
        if *entry_count >= MAX_WORKSPACE_ENTRIES {
            return Ok(None);
        }
        let Ok(item) = item else {
            continue;
        };
        let Ok(file_type) = item.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }

        *entry_count += 1;
        let path = item.path();
        if file_type.is_dir() {
            if let Some(location) =
                locate_document_in_directory(&path, expected_file_id, depth + 1, entry_count)?
            {
                return Ok(Some(location));
            }
        } else if file_type.is_file()
            && let Some(location) = document_location_for_identity(&path, expected_file_id)?
        {
            return Ok(Some(location));
        }
    }
    Ok(None)
}

#[tauri::command]
fn locate_document(
    app: tauri::AppHandle,
    current_path: String,
    file_id: String,
    root_paths: Vec<String>,
    candidate_paths: Vec<String>,
) -> Result<Option<DocumentLocationPayload>, String> {
    if let Some(location) = document_location_for_identity(Path::new(&current_path), &file_id)? {
        return Ok(Some(location));
    }

    let roots = root_paths
        .iter()
        .filter_map(|root_path| require_known_root(&app, root_path).ok())
        .collect::<Vec<_>>();
    let mut entry_count = 0;

    for candidate in candidate_paths {
        let path = PathBuf::from(candidate);
        if roots.iter().all(|root| !path.starts_with(root)) {
            continue;
        }
        if let Some(location) = document_location_for_identity(&path, &file_id)? {
            return Ok(Some(location));
        }
        if path.is_dir()
            && let Some(location) =
                locate_document_in_directory(&path, &file_id, 0, &mut entry_count)?
        {
            return Ok(Some(location));
        }
    }

    for root in roots {
        if let Some(location) = locate_document_in_directory(&root, &file_id, 0, &mut entry_count)?
        {
            return Ok(Some(location));
        }
    }
    document_location_for_existing_path(Path::new(&current_path))
}

#[tauri::command]
fn write_document(path: String, content: String) -> Result<(), String> {
    let file_path = PathBuf::from(path);
    require_markdown_file(&file_path)?;

    if content.len() as u64 > MAX_DOCUMENT_BYTES {
        return Err("Markdown 内容超过 8 MB，MVP 暂不支持保存".into());
    }

    fs::write(file_path, content).map_err(error_message)
}

#[tauri::command]
#[cfg(target_os = "macos")]
fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;

    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    let plain_text_type = unsafe { NSPasteboardTypeString };
    if pasteboard.setString_forType(&NSString::from_str(&text), plain_text_type) {
        Ok(())
    } else {
        Err("无法写入系统剪贴板".into())
    }
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
fn copy_text_to_clipboard(_text: String) -> Result<(), String> {
    Err("当前系统暂不支持写入剪贴板".into())
}

fn list_entries(
    directory: &Path,
    depth: usize,
    entry_count: &mut usize,
    is_truncated: &mut bool,
) -> Result<Vec<WorkspaceEntry>, String> {
    if depth > MAX_WORKSPACE_DEPTH {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for item in fs::read_dir(directory).map_err(error_message)? {
        if *entry_count >= MAX_WORKSPACE_ENTRIES {
            *is_truncated = true;
            break;
        }

        let Ok(item) = item else {
            continue;
        };
        let path = item.path();
        let name = item.file_name().to_string_lossy().into_owned();

        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }

        let Ok(file_type) = item.file_type() else {
            continue;
        };
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            if depth >= MAX_WORKSPACE_DEPTH {
                continue;
            }
            *entry_count += 1;
            let children = list_entries(&path, depth + 1, entry_count, is_truncated);
            let (children, error) = match children {
                Ok(children) => (children, None),
                Err(error) => (Vec::new(), Some(error)),
            };
            entries.push(WorkspaceEntry {
                path: path.to_string_lossy().into_owned(),
                name,
                kind: FileKind::Directory,
                children,
                error,
            });
        } else if file_type.is_file()
            && let Some(kind) = file_kind(&path)
        {
            *entry_count += 1;
            entries.push(WorkspaceEntry {
                path: path.to_string_lossy().into_owned(),
                name,
                kind,
                children: Vec::new(),
                error: None,
            });
        }
    }

    entries.sort_by(|left, right| {
        (left.kind != FileKind::Directory)
            .cmp(&(right.kind != FileKind::Directory))
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
fn list_project_roots(app: tauri::AppHandle) -> Result<Vec<ProjectRootPayload>, String> {
    project_repository::list(&app)
}

#[tauri::command]
fn remember_project_root(
    app: tauri::AppHandle,
    root_path: String,
) -> Result<ProjectRootPayload, String> {
    let root = PathBuf::from(root_path)
        .canonicalize()
        .map_err(error_message)?;
    if !root.is_dir() {
        return Err("所选路径不是可读取的文件夹".into());
    }
    if !app.asset_protocol_scope().is_allowed(&root) {
        return Err("请通过“打开文件夹”选择要加入 mardi 的根目录".into());
    }

    project_repository::remember(&app, &root)
}

#[tauri::command]
fn forget_project_root(app: tauri::AppHandle, root_path: String) -> Result<(), String> {
    project_repository::forget(&app, &root_path)
}

#[tauri::command]
fn list_workspace(app: tauri::AppHandle, root_path: String) -> Result<WorkspaceSnapshot, String> {
    let root = PathBuf::from(root_path)
        .canonicalize()
        .map_err(error_message)?;
    if !root.is_dir() {
        return Err("所选路径不是可读取的文件夹".into());
    }
    if !project_repository::contains(&app, &root)? {
        return Err("这个根目录尚未加入 mardi".into());
    }

    app.asset_protocol_scope()
        .allow_directory(&root, true)
        .map_err(error_message)?;

    let root_name = root
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Documents")
        .to_owned();
    let mut entry_count = 0;
    let mut is_truncated = false;
    let entries = list_entries(&root, 0, &mut entry_count, &mut is_truncated)?;

    Ok(WorkspaceSnapshot {
        root_path: root.to_string_lossy().into_owned(),
        root_name,
        entries,
        is_truncated,
    })
}

fn require_known_root(app: &tauri::AppHandle, root_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(root_path)
        .canonicalize()
        .map_err(error_message)?;
    if !root.is_dir() {
        return Err("项目根目录不存在或无法读取".into());
    }
    if !project_repository::contains(app, &root)? {
        return Err("这个根目录尚未加入 mardi".into());
    }
    Ok(root)
}

fn workspace_change_kind(kind: &EventKind) -> Option<WorkspaceChangeKind> {
    match kind {
        EventKind::Access(_) => None,
        EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Metadata(_)) => {
            Some(WorkspaceChangeKind::Content)
        }
        _ => Some(WorkspaceChangeKind::Structure),
    }
}

#[tauri::command]
fn watch_workspace_roots(
    app: tauri::AppHandle,
    state: tauri::State<WorkspaceWatcherState>,
    root_paths: Vec<String>,
) -> Result<(), String> {
    let roots = root_paths
        .iter()
        .filter_map(|root_path| require_known_root(&app, root_path).ok())
        .collect::<Vec<_>>();

    let event_app = app.clone();
    let mut watcher =
        notify::recommended_watcher(move |result: Result<notify::Event, notify::Error>| {
            let Ok(event) = result else {
                return;
            };
            let Some(kind) = workspace_change_kind(&event.kind) else {
                return;
            };
            let paths = event
                .paths
                .into_iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>();
            if paths.is_empty() {
                return;
            }
            let _ = event_app.emit(
                "workspace-files-changed",
                WorkspaceFilesChangedPayload { paths, kind },
            );
        })
        .map_err(error_message)?;

    for root in roots {
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(error_message)?;
    }

    let mut current = state
        .watcher
        .lock()
        .map_err(|_| "文件监听状态不可用".to_string())?;
    *current = Some(watcher);
    Ok(())
}

fn workspace_entry_for_path(path: PathBuf) -> Result<WorkspaceEntry, String> {
    let kind = if path.is_dir() {
        FileKind::Directory
    } else {
        file_kind(&path).ok_or_else(|| "该文件类型不受 mardi 支持".to_string())?
    };
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "文件名不是有效的 UTF-8 文本".to_string())?
        .to_owned();
    Ok(WorkspaceEntry {
        path: path.to_string_lossy().into_owned(),
        name,
        kind,
        children: Vec::new(),
        error: None,
    })
}

#[tauri::command]
fn create_workspace_markdown(
    app: tauri::AppHandle,
    root_path: String,
    parent_path: String,
    name: String,
) -> Result<WorkspaceEntry, String> {
    let root = require_known_root(&app, &root_path)?;
    workspace_files::create_markdown_file(&root, Path::new(&parent_path), &name)
        .and_then(workspace_entry_for_path)
}

#[tauri::command]
fn create_workspace_directory(
    app: tauri::AppHandle,
    root_path: String,
    parent_path: String,
    name: String,
) -> Result<WorkspaceEntry, String> {
    let root = require_known_root(&app, &root_path)?;
    workspace_files::create_directory(&root, Path::new(&parent_path), &name)
        .and_then(workspace_entry_for_path)
}

#[tauri::command]
fn rename_workspace_entry(
    app: tauri::AppHandle,
    root_path: String,
    path: String,
    new_stem: String,
) -> Result<WorkspaceEntry, String> {
    let root = require_known_root(&app, &root_path)?;
    workspace_files::rename_entry(&root, Path::new(&path), &new_stem)
        .and_then(workspace_entry_for_path)
}

#[tauri::command]
fn trash_workspace_entry(
    app: tauri::AppHandle,
    root_path: String,
    path: String,
) -> Result<(), String> {
    let root = require_known_root(&app, &root_path)?;
    workspace_files::move_entry_to_trash(&root, Path::new(&path))
}

#[tauri::command]
fn update_project_view_state(
    app: tauri::AppHandle,
    root_path: String,
    is_expanded: bool,
    collapsed_paths: Vec<String>,
) -> Result<(), String> {
    let root = require_known_root(&app, &root_path)?;
    let mut collapsed_paths = collapsed_paths
        .into_iter()
        .filter_map(|path| PathBuf::from(path).canonicalize().ok())
        .filter(|path| path.is_dir() && path != &root && path.starts_with(&root))
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    collapsed_paths.sort();
    collapsed_paths.dedup();

    project_repository::update_view_state(
        &app,
        &root_path,
        ProjectViewStatePayload {
            is_expanded,
            collapsed_paths,
        },
    )
}

// A typed absolute path is an explicit user-open action, just like the picker.
// Resolve and validate that one file before granting its exact asset URL.
fn canonical_media_file(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("媒体文件必须使用绝对路径".into());
    }
    let requested_kind = file_kind(path);
    if !matches!(requested_kind, Some(FileKind::Image | FileKind::Video)) {
        return Err("不支持该媒体格式".into());
    }
    let canonical = path.canonicalize().map_err(error_message)?;
    if file_kind(&canonical) != requested_kind || !canonical.is_file() {
        return Err("所选路径不是支持的媒体文件".into());
    }
    fs::File::open(&canonical).map_err(error_message)?;
    Ok(canonical)
}

#[tauri::command]
fn prepare_media_source(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let canonical = canonical_media_file(Path::new(&path))?;
    app.asset_protocol_scope()
        .allow_file(&canonical)
        .map_err(error_message)?;
    Ok(canonical.to_string_lossy().into_owned())
}

fn image_mime_type(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())?
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

#[tauri::command]
fn read_local_image(
    document_path: String,
    source: String,
    workspace_root: Option<String>,
) -> Result<String, String> {
    let document_path = PathBuf::from(document_path)
        .canonicalize()
        .map_err(error_message)?;
    let document_directory = document_path
        .parent()
        .ok_or_else(|| "无法确定 Markdown 文件所在目录".to_string())?;
    let source_path = Path::new(&source);

    if source_path.is_absolute() {
        return Err("MVP 仅加载相对路径图片".into());
    }

    let allowed_root = workspace_root
        .map(PathBuf::from)
        .unwrap_or_else(|| document_directory.to_path_buf())
        .canonicalize()
        .map_err(error_message)?;
    let image_path = document_directory
        .join(source_path)
        .canonicalize()
        .map_err(error_message)?;

    if !image_path.starts_with(&allowed_root) {
        return Err("图片路径超出了当前文档或工作区范围".into());
    }

    let mime_type =
        image_mime_type(&image_path).ok_or_else(|| "不支持该本地图片格式".to_string())?;
    let metadata = fs::metadata(&image_path).map_err(error_message)?;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("本地图片超过 16 MB，MVP 暂不加载".into());
    }

    let bytes = fs::read(image_path).map_err(error_message)?;
    Ok(format!(
        "data:{mime_type};base64,{}",
        STANDARD.encode(bytes)
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(WorkspaceWatcherState::default())
        .manage(PendingOpenFiles::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            recent_files_repository::list_recent_files,
            recent_files_repository::remember_recent_file,
            recent_files_repository::forget_recent_file,
            recent_files_repository::relocate_recent_files,
            read_document,
            locate_document,
            write_document,
            copy_text_to_clipboard,
            list_project_roots,
            watch_workspace_roots,
            remember_project_root,
            forget_project_root,
            list_workspace,
            create_workspace_markdown,
            create_workspace_directory,
            rename_workspace_entry,
            trash_workspace_entry,
            update_project_view_state,
            read_local_image,
            prepare_media_source,
            take_pending_open_files
        ])
        .build(tauri::generate_context!())
        .expect("error while building mardi");

    app.run(|app, event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = event {
            let paths = urls
                .iter()
                .filter_map(|url| url.to_file_path().ok())
                .filter(|path| is_markdown_file(path))
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>();

            if paths.is_empty() {
                return;
            }
            if let Ok(mut pending) = app.state::<PendingOpenFiles>().0.lock() {
                pending.extend(paths);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            let _ = app.emit("open-files-requested", ());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{
        FileKind, MAX_WORKSPACE_DEPTH, MAX_WORKSPACE_ENTRIES, WorkspaceChangeKind,
        canonical_media_file, document_location_for_existing_path, document_location_for_identity,
        file_identity, file_kind, is_markdown_file, list_entries, locate_document_in_directory,
        workspace_change_kind,
    };
    use notify::{
        EventKind,
        event::{AccessKind, CreateKind, DataChange, ModifyKind},
    };
    use std::{fs, path::Path};
    use tempfile::tempdir;

    #[test]
    fn prepares_only_one_canonical_supported_media_file() {
        let root = tempdir().unwrap();
        fs::create_dir(root.path().join("assets")).unwrap();
        let image = root.path().join("assets/sample.PNG");
        fs::write(&image, b"image bytes").unwrap();
        let canonical =
            canonical_media_file(&root.path().join("assets/../assets/sample.PNG")).unwrap();
        assert_eq!(canonical, image.canonicalize().unwrap());
        assert_ne!(canonical, root.path().canonicalize().unwrap());
        let video = root.path().join("sample.mov");
        fs::write(&video, b"video bytes").unwrap();
        assert_eq!(
            canonical_media_file(&video).unwrap(),
            video.canonicalize().unwrap()
        );
    }

    #[test]
    fn rejects_unsupported_missing_directory_and_relative_media_paths() {
        let root = tempdir().unwrap();
        for name in ["image.svg", "notes.md", "secret.txt"] {
            let path = root.path().join(name);
            fs::write(&path, b"data").unwrap();
            assert!(canonical_media_file(&path).is_err());
        }
        let directory = root.path().join("folder.png");
        fs::create_dir(&directory).unwrap();
        assert!(canonical_media_file(&directory).is_err());
        assert!(canonical_media_file(&root.path().join("missing.png")).is_err());
        assert!(canonical_media_file(Path::new("relative.png")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn validates_a_symlink_target_before_authorizing_media() {
        use std::os::unix::fs::symlink;
        let root = tempdir().unwrap();
        let image = root.path().join("real.png");
        fs::write(&image, b"image").unwrap();
        let alias = root.path().join("alias.png");
        symlink(&image, &alias).unwrap();
        assert_eq!(
            canonical_media_file(&alias).unwrap(),
            image.canonicalize().unwrap()
        );
        let unsupported = root.path().join("secret.txt");
        fs::write(&unsupported, b"private text").unwrap();
        let disguised = root.path().join("disguised.png");
        symlink(&unsupported, &disguised).unwrap();
        assert!(canonical_media_file(&disguised).is_err());
    }

    #[test]
    fn recognizes_markdown_extensions_case_insensitively() {
        assert!(is_markdown_file(Path::new("notes.md")));
        assert!(is_markdown_file(Path::new("README.MARKDOWN")));
        assert!(!is_markdown_file(Path::new("notes.txt")));
    }

    #[test]
    fn recognizes_supported_media_without_allowing_svg() {
        assert!(matches!(
            file_kind(Path::new("cover.AVIF")),
            Some(FileKind::Image)
        ));
        assert!(matches!(
            file_kind(Path::new("demo.mov")),
            Some(FileKind::Video)
        ));
        assert!(file_kind(Path::new("vector.svg")).is_none());
    }

    #[test]
    fn lists_empty_directories_and_directories_without_previewable_files() {
        let root = tempdir().unwrap();
        fs::create_dir(root.path().join("empty")).unwrap();
        fs::create_dir(root.path().join("unsupported-only")).unwrap();
        fs::write(root.path().join("unsupported-only/notes.txt"), "hello").unwrap();

        let mut entry_count = 0;
        let mut is_truncated = false;
        let entries = list_entries(root.path(), 0, &mut entry_count, &mut is_truncated).unwrap();

        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            vec!["empty", "unsupported-only"]
        );
        assert!(
            entries
                .iter()
                .all(|entry| { entry.kind == FileKind::Directory && entry.children.is_empty() })
        );
        assert_eq!(entry_count, 2);
        assert!(!is_truncated);
    }

    #[test]
    fn keeps_directory_results_within_entry_and_depth_limits() {
        let root = tempdir().unwrap();
        fs::create_dir(root.path().join("a")).unwrap();
        fs::create_dir(root.path().join("b")).unwrap();
        let mut entry_count = MAX_WORKSPACE_ENTRIES - 1;
        let mut is_truncated = false;

        let entries = list_entries(root.path(), 0, &mut entry_count, &mut is_truncated).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entry_count, MAX_WORKSPACE_ENTRIES);
        assert!(is_truncated);

        let depth_root = tempdir().unwrap();
        let mut current = depth_root.path().to_path_buf();
        for level in 1..=(MAX_WORKSPACE_DEPTH + 1) {
            current = current.join(format!("level-{level}"));
            fs::create_dir(&current).unwrap();
        }
        let mut entry_count = 0;
        let mut is_truncated = false;
        let entries =
            list_entries(depth_root.path(), 0, &mut entry_count, &mut is_truncated).unwrap();

        assert_eq!(entry_count, MAX_WORKSPACE_DEPTH);
        assert_eq!(entries.len(), 1);
        assert!(!is_truncated);
    }

    #[cfg(unix)]
    #[test]
    fn keeps_the_root_readable_when_one_nested_directory_is_unreadable() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempdir().unwrap();
        let readable = root.path().join("readable");
        let unreadable = root.path().join("unreadable");
        fs::create_dir(&readable).unwrap();
        fs::create_dir(&unreadable).unwrap();
        fs::write(readable.join("note.md"), "hello").unwrap();
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o000)).unwrap();

        let mut entry_count = 0;
        let mut is_truncated = false;
        let entries = list_entries(root.path(), 0, &mut entry_count, &mut is_truncated).unwrap();
        fs::set_permissions(&unreadable, fs::Permissions::from_mode(0o700)).unwrap();

        let readable_entry = entries
            .iter()
            .find(|entry| entry.name == "readable")
            .unwrap();
        let unreadable_entry = entries
            .iter()
            .find(|entry| entry.name == "unreadable")
            .unwrap();
        assert_eq!(readable_entry.children.len(), 1);
        assert!(unreadable_entry.children.is_empty());
        assert!(unreadable_entry.error.is_some());
    }

    #[test]
    fn classifies_file_watcher_events_without_reacting_to_reads() {
        assert_eq!(
            workspace_change_kind(&EventKind::Access(AccessKind::Any)),
            None
        );
        assert_eq!(
            workspace_change_kind(&EventKind::Modify(ModifyKind::Data(DataChange::Any))),
            Some(WorkspaceChangeKind::Content)
        );
        assert_eq!(
            workspace_change_kind(&EventKind::Create(CreateKind::File)),
            Some(WorkspaceChangeKind::Structure)
        );
    }

    #[cfg(unix)]
    #[test]
    fn relocates_an_open_document_by_stable_file_identity() {
        let root = tempdir().unwrap();
        let original = root.path().join("before.md");
        fs::write(&original, "hello").unwrap();
        let file_id = file_identity(&fs::metadata(&original).unwrap()).unwrap();
        let renamed = root.path().join("after.md");
        fs::rename(&original, &renamed).unwrap();

        assert!(
            document_location_for_identity(&original, &file_id)
                .unwrap()
                .is_none()
        );
        let mut entry_count = 0;
        let location = locate_document_in_directory(root.path(), &file_id, 0, &mut entry_count)
            .unwrap()
            .unwrap();
        assert_eq!(location.name, "after.md");
        assert_eq!(location.file_id, file_id);
        assert_eq!(Path::new(&location.path), renamed.canonicalize().unwrap());

        fs::remove_file(&renamed).unwrap();
        let mut entry_count = 0;
        assert!(
            locate_document_in_directory(root.path(), &file_id, 0, &mut entry_count)
                .unwrap()
                .is_none()
        );
    }

    #[cfg(unix)]
    #[test]
    fn accepts_an_atomic_external_replacement_at_the_same_path() {
        let root = tempdir().unwrap();
        let path = root.path().join("note.md");
        fs::write(&path, "before").unwrap();
        let previous_file_id = file_identity(&fs::metadata(&path).unwrap()).unwrap();
        fs::remove_file(&path).unwrap();
        fs::write(&path, "after").unwrap();

        let location = document_location_for_existing_path(&path).unwrap().unwrap();
        assert_eq!(
            location.path,
            path.canonicalize().unwrap().to_string_lossy()
        );
        assert_ne!(location.file_id, previous_file_id);
    }
}
