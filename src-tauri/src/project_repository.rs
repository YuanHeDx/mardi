use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const STORE_VERSION: u32 = 1;
const STORE_FILE_NAME: &str = "project-roots-v1.json";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProjectRootPayload {
    pub(crate) root_path: String,
    pub(crate) name: String,
    pub(crate) last_opened_at: u64,
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
    Ok(read_store(app)?.roots)
}

pub(crate) fn contains(app: &AppHandle, root: &Path) -> Result<bool, String> {
    let root_path = root.to_string_lossy();
    Ok(read_store(app)?
        .roots
        .iter()
        .any(|item| item.root_path == root_path))
}

pub(crate) fn remember(app: &AppHandle, root: &Path) -> Result<ProjectRootPayload, String> {
    let root_path = root.to_string_lossy().into_owned();
    let project = ProjectRootPayload {
        name: root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Documents")
            .to_owned(),
        root_path: root_path.clone(),
        last_opened_at: timestamp_millis(),
    };

    let mut store = read_store(app)?;
    store.roots.retain(|item| item.root_path != root_path);
    store.roots.insert(0, project.clone());
    write_store(app, &store)?;
    Ok(project)
}

pub(crate) fn forget(app: &AppHandle, root_path: &str) -> Result<(), String> {
    let mut store = read_store(app)?;
    store.roots.retain(|item| item.root_path != root_path);
    write_store(app, &store)
}

#[cfg(test)]
mod tests {
    use super::ProjectRootPayload;

    #[test]
    fn project_root_serializes_with_frontend_field_names() {
        let root = ProjectRootPayload {
            root_path: "/notes".into(),
            name: "notes".into(),
            last_opened_at: 42,
        };
        let json = serde_json::to_value(root).unwrap();

        assert_eq!(json["rootPath"], "/notes");
        assert_eq!(json["lastOpenedAt"], 42);
    }
}
