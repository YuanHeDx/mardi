use std::{
    fs::{self, OpenOptions},
    path::{Path, PathBuf},
};

fn error_message(error: impl std::fmt::Display) -> String {
    error.to_string()
}

fn validate_leaf_name(name: &str) -> Result<&str, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("文件名不能为空".into());
    }
    if trimmed != name {
        return Err("文件名首尾不能包含空格".into());
    }
    if trimmed.starts_with('.') {
        return Err("文件名不能以 . 开头".into());
    }
    if trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains('\0')
    {
        return Err("文件名不能包含路径分隔符".into());
    }
    Ok(trimmed)
}

fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    let root = root.canonicalize().map_err(error_message)?;
    if !root.is_dir() {
        return Err("项目根目录不存在或无法读取".into());
    }
    Ok(root)
}

fn require_within_root(path: &Path, root: &Path) -> Result<(), String> {
    if path == root || !path.starts_with(root) {
        return Err("只能操作项目根目录内的文件".into());
    }
    Ok(())
}

fn canonical_directory_within_root(directory: &Path, root: &Path) -> Result<PathBuf, String> {
    let directory = directory.canonicalize().map_err(error_message)?;
    require_within_root(&directory, root).or_else(|error| {
        if directory == root {
            Ok(())
        } else {
            Err(error)
        }
    })?;
    if !directory.is_dir() {
        return Err("目标位置不是可读取的文件夹".into());
    }
    Ok(directory)
}

fn is_supported_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some(
            "md" | "markdown"
                | "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "bmp"
                | "avif"
                | "mp4"
                | "mov"
                | "m4v"
                | "webm"
        )
    )
}

fn canonical_workspace_entry(path: &Path, root: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(path).map_err(error_message)?;
    if metadata.file_type().is_symlink() || (!metadata.is_file() && !metadata.is_dir()) {
        return Err("只能操作文件列表中的普通文件或文件夹".into());
    }

    let path = path.canonicalize().map_err(error_message)?;
    require_within_root(&path, root)?;
    if path == root {
        return Err("不能操作项目根目录".into());
    }
    if path.is_file() && !is_supported_file(&path) {
        return Err("该文件类型不受 mardi 支持".into());
    }
    Ok(path)
}

pub(crate) fn create_markdown_file(
    root: &Path,
    parent: &Path,
    requested_name: &str,
) -> Result<PathBuf, String> {
    let root = canonical_root(root)?;
    let parent = canonical_directory_within_root(parent, &root)?;
    let requested_name = validate_leaf_name(requested_name)?;
    let lower_name = requested_name.to_ascii_lowercase();
    let file_name = if lower_name.ends_with(".md") || lower_name.ends_with(".markdown") {
        requested_name.to_owned()
    } else {
        format!("{requested_name}.md")
    };
    validate_leaf_name(&file_name)?;

    let target = parent.join(file_name);
    require_within_root(&target, &root)?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&target)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "同名文件已经存在".to_string()
            } else {
                error_message(error)
            }
        })?;
    target.canonicalize().map_err(error_message)
}

pub(crate) fn create_directory(
    root: &Path,
    parent: &Path,
    requested_name: &str,
) -> Result<PathBuf, String> {
    let root = canonical_root(root)?;
    let parent = canonical_directory_within_root(parent, &root)?;
    let directory_name = validate_leaf_name(requested_name)?;
    let target = parent.join(directory_name);
    require_within_root(&target, &root)?;

    fs::create_dir(&target).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            "同名文件或文件夹已经存在".to_string()
        } else {
            error_message(error)
        }
    })?;
    target.canonicalize().map_err(error_message)
}

pub(crate) fn rename_entry(root: &Path, source: &Path, new_name: &str) -> Result<PathBuf, String> {
    let root = canonical_root(root)?;
    let source = canonical_workspace_entry(source, &root)?;
    let requested_name = validate_leaf_name(new_name)?;
    let target_name = if source.is_dir() {
        requested_name.to_owned()
    } else {
        let extension = source
            .extension()
            .and_then(|extension| extension.to_str())
            .ok_or_else(|| "无法识别文件扩展名".to_string())?;
        format!("{requested_name}.{extension}")
    };
    validate_leaf_name(&target_name)?;
    let target = source
        .parent()
        .ok_or_else(|| "无法确定文件所在目录".to_string())?
        .join(target_name);
    require_within_root(&target, &root)?;

    if target == source {
        return Ok(source);
    }
    if target.exists() {
        let existing = target.canonicalize().map_err(error_message)?;
        if existing != source {
            return Err("同名文件已经存在".into());
        }
    }

    fs::rename(&source, &target).map_err(error_message)?;
    target.canonicalize().map_err(error_message)
}

pub(crate) fn move_entry_to_trash(root: &Path, source: &Path) -> Result<(), String> {
    let root = canonical_root(root)?;
    let source = canonical_workspace_entry(source, &root)?;
    trash::delete(&source).map_err(error_message)
}

#[cfg(test)]
mod tests {
    use super::{create_directory, create_markdown_file, move_entry_to_trash, rename_entry};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn creates_markdown_without_overwriting_existing_files() {
        let root = tempdir().unwrap();
        let path = create_markdown_file(root.path(), root.path(), "notes").unwrap();
        assert_eq!(path.file_name().unwrap(), "notes.md");
        assert!(path.is_file());
        assert!(create_markdown_file(root.path(), root.path(), "notes").is_err());
    }

    #[test]
    fn creates_files_only_below_the_project_root() {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        assert!(create_markdown_file(root.path(), outside.path(), "notes").is_err());
        assert!(create_markdown_file(root.path(), root.path(), "../notes").is_err());
    }

    #[test]
    fn creates_empty_directories_without_overwriting_existing_entries() {
        let root = tempdir().unwrap();
        let path = create_directory(root.path(), root.path(), "drafts").unwrap();
        assert_eq!(path.file_name().unwrap(), "drafts");
        assert!(path.is_dir());
        assert!(create_directory(root.path(), root.path(), "drafts").is_err());
    }

    #[test]
    fn creates_directories_only_below_the_project_root() {
        let root = tempdir().unwrap();
        let outside = tempdir().unwrap();
        assert!(create_directory(root.path(), outside.path(), "drafts").is_err());
        assert!(create_directory(root.path(), root.path(), "../drafts").is_err());
    }

    #[test]
    fn renames_supported_files_without_changing_the_extension() {
        let root = tempdir().unwrap();
        let original = root.path().join("old.markdown");
        fs::write(&original, "hello").unwrap();

        let renamed = rename_entry(root.path(), &original, "new.name").unwrap();
        assert_eq!(renamed.file_name().unwrap(), "new.name.markdown");
        assert_eq!(fs::read_to_string(renamed).unwrap(), "hello");
    }

    #[test]
    fn rejects_hidden_and_unsupported_files() {
        let root = tempdir().unwrap();
        let unsupported = root.path().join("notes.txt");
        fs::write(&unsupported, "hello").unwrap();
        assert!(rename_entry(root.path(), &unsupported, "renamed").is_err());
        assert!(create_markdown_file(root.path(), root.path(), ".hidden").is_err());
    }

    #[test]
    fn renames_directories_and_keeps_their_contents() {
        let root = tempdir().unwrap();
        let original = root.path().join("drafts");
        fs::create_dir(&original).unwrap();
        fs::write(original.join("note.md"), "hello").unwrap();

        let renamed = rename_entry(root.path(), &original, "archive").unwrap();
        assert_eq!(renamed.file_name().unwrap(), "archive");
        assert_eq!(
            fs::read_to_string(renamed.join("note.md")).unwrap(),
            "hello"
        );
    }

    #[test]
    fn refuses_to_rename_the_project_root() {
        let root = tempdir().unwrap();
        assert!(rename_entry(root.path(), root.path(), "other").is_err());
    }

    #[test]
    fn refuses_to_trash_the_project_root() {
        let root = tempdir().unwrap();
        assert!(move_entry_to_trash(root.path(), root.path()).is_err());
        assert!(root.path().exists());
    }
}
