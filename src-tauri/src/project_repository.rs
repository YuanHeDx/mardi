use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const STORE_VERSION: u32 = 1;
const STORE_FILE_NAME: &str = "project-roots-v1.json";
static STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectViewStatePayload {
    pub(crate) is_expanded: bool,
    pub(crate) collapsed_paths: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectRootPayload {
    pub(crate) root_path: String,
    pub(crate) name: String,
    pub(crate) last_opened_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) view_state: Option<ProjectViewStatePayload>,
}

#[derive(Default, Deserialize, Serialize)]
struct ProjectStore {
    version: u32,
    roots: Vec<ProjectRootPayload>,
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

fn read_store(app: &AppHandle) -> Result<ProjectStore, String> {
    let path = store_path(app)?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ProjectStore {
                version: STORE_VERSION,
                roots: Vec::new(),
            });
        }
        Err(error) => return Err(error_message(error)),
    };

    let store = match serde_json::from_slice::<ProjectStore>(&bytes) {
        Ok(store) if store.version == STORE_VERSION => store,
        _ => ProjectStore {
            version: STORE_VERSION,
            roots: Vec::new(),
        },
    };
    Ok(store)
}

fn write_store(app: &AppHandle, store: &ProjectStore) -> Result<(), String> {
    let path = store_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "无法确定 mardi 配置目录".to_string())?;
    fs::create_dir_all(directory).map_err(error_message)?;

    let temporary_path = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(store).map_err(error_message)?;
    fs::write(&temporary_path, bytes).map_err(error_message)?;
    fs::rename(temporary_path, path).map_err(error_message)
}

fn timestamp_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

pub(crate) fn list(app: &AppHandle) -> Result<Vec<ProjectRootPayload>, String> {
    let _guard = STORE_LOCK.lock().map_err(error_message)?;
    Ok(read_store(app)?.roots)
}

pub(crate) fn contains(app: &AppHandle, root: &Path) -> Result<bool, String> {
    let _guard = STORE_LOCK.lock().map_err(error_message)?;
    let root_path = root.to_string_lossy();
    Ok(read_store(app)?
        .roots
        .iter()
        .any(|item| item.root_path == root_path))
}

pub(crate) fn remember(app: &AppHandle, root: &Path) -> Result<ProjectRootPayload, String> {
    let _guard = STORE_LOCK.lock().map_err(error_message)?;
    let root_path = root.to_string_lossy().into_owned();
    let mut store = read_store(app)?;
    let previous_view_state = store
        .roots
        .iter()
        .find(|item| item.root_path == root_path)
        .and_then(|item| item.view_state.clone());
    let project = ProjectRootPayload {
        name: root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Documents")
            .to_owned(),
        root_path: root_path.clone(),
        last_opened_at: timestamp_millis(),
        view_state: Some(ProjectViewStatePayload {
            is_expanded: true,
            collapsed_paths: previous_view_state
                .map(|state| state.collapsed_paths)
                .unwrap_or_default(),
        }),
    };

    store.roots.retain(|item| item.root_path != root_path);
    store.roots.insert(0, project.clone());
    write_store(app, &store)?;
    Ok(project)
}

pub(crate) fn forget(app: &AppHandle, root_path: &str) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().map_err(error_message)?;
    let mut store = read_store(app)?;
    store.roots.retain(|item| item.root_path != root_path);
    write_store(app, &store)
}

pub(crate) fn update_view_state(
    app: &AppHandle,
    root_path: &str,
    view_state: ProjectViewStatePayload,
) -> Result<(), String> {
    let _guard = STORE_LOCK.lock().map_err(error_message)?;
    let mut store = read_store(app)?;
    let project = store
        .roots
        .iter_mut()
        .find(|item| item.root_path == root_path)
        .ok_or_else(|| "这个根目录尚未加入 mardi".to_string())?;
    project.view_state = Some(view_state);
    write_store(app, &store)
}

#[cfg(test)]
mod tests {
    use super::{ProjectRootPayload, ProjectViewStatePayload};

    #[test]
    fn project_root_serializes_with_frontend_field_names() {
        let root = ProjectRootPayload {
            root_path: "/notes".into(),
            name: "notes".into(),
            last_opened_at: 42,
            view_state: Some(ProjectViewStatePayload {
                is_expanded: true,
                collapsed_paths: vec!["/notes/archive".into()],
            }),
        };
        let json = serde_json::to_value(root).unwrap();

        assert_eq!(json["rootPath"], "/notes");
        assert_eq!(json["lastOpenedAt"], 42);
        assert_eq!(json["viewState"]["isExpanded"], true);
        assert_eq!(json["viewState"]["collapsedPaths"][0], "/notes/archive");
    }

    #[test]
    fn old_project_roots_without_view_state_remain_readable() {
        let json = r#"{"rootPath":"/notes","name":"notes","lastOpenedAt":42}"#;
        let root: ProjectRootPayload = serde_json::from_str(json).unwrap();
        assert_eq!(root.root_path, "/notes");
        assert_eq!(root.view_state, None);
    }
}
