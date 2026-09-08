mod project_repository;
mod workspace_files;

use base64::{Engine as _, engine::general_purpose::STANDARD};
use notify::{EventKind, RecursiveMode, Watcher, event::ModifyKind};
use serde::Serialize;
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
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceEntry {
    path: String,
    name: String,
    kind: FileKind,
    children: Vec<WorkspaceEntry>,
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
    })
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

        let item = item.map_err(error_message)?;
        let path = item.path();
        let name = item.file_name().to_string_lossy().into_owned();

        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }

        let file_type = item.file_type().map_err(error_message)?;
        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            let children = list_entries(&path, depth + 1, entry_count, is_truncated)?;
            if !children.is_empty() {
                *entry_count += 1;
                entries.push(WorkspaceEntry {
                    path: path.to_string_lossy().into_owned(),
                    name,
                    kind: FileKind::Directory,
                    children,
                });
            }
        } else if file_type.is_file()
            && let Some(kind) = file_kind(&path)
        {
            *entry_count += 1;
            entries.push(WorkspaceEntry {
                path: path.to_string_lossy().into_owned(),
                name,
                kind,
                children: Vec::new(),
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
        .map(|root_path| require_known_root(&app, root_path))
        .collect::<Result<Vec<_>, _>>()?;

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
    tauri::Builder::default()
        .manage(WorkspaceWatcherState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            copy_text_to_clipboard,
            list_project_roots,
            watch_workspace_roots,
            remember_project_root,
            forget_project_root,
            list_workspace,
            create_workspace_markdown,
            rename_workspace_entry,
            trash_workspace_entry,
            update_project_view_state,
            read_local_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running mardi");
}

#[cfg(test)]
mod tests {
    use super::{
        FileKind, WorkspaceChangeKind, file_kind, is_markdown_file, workspace_change_kind,
    };
    use notify::{
        EventKind,
        event::{AccessKind, CreateKind, DataChange, ModifyKind},
    };
    use std::path::Path;

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
}
