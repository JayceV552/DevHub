use std::borrow::Cow;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use arboard::{Clipboard, ImageData};
use base64::Engine;
use chrono::{DateTime, TimeDelta, Utc};
use image::{DynamicImage, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Runtime};
use uuid::Uuid;

use crate::error::{Error, Result};
use crate::models::{ClipboardEntry, ClipboardKind, ClipboardSnapshot};

pub const RETENTION_DAYS: u32 = 7;
const POLL_INTERVAL: Duration = Duration::from_millis(700);
const THUMBNAIL_WIDTH: u32 = 560;
const THUMBNAIL_HEIGHT: u32 = 360;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredClipboardEntry {
    id: String,
    kind: ClipboardKind,
    content: Option<String>,
    #[serde(default)]
    files: Option<Vec<String>>,
    image_file: Option<String>,
    preview_file: Option<String>,
    content_hash: String,
    byte_size: u64,
    created_at: DateTime<Utc>,
    copied_at: DateTime<Utc>,
    copy_count: u32,
    width: Option<u32>,
    height: Option<u32>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct ClipboardIndex {
    #[serde(default)]
    entries: Vec<StoredClipboardEntry>,
}

pub struct ClipboardStore<R: Runtime = tauri::Wry> {
    app: AppHandle<R>,
    dir: PathBuf,
    index_path: PathBuf,
    entries: Mutex<Vec<StoredClipboardEntry>>,
    cap_bytes: AtomicU64,
}

impl<R: Runtime> ClipboardStore<R> {
    pub fn load(app: AppHandle<R>, config_dir: &Path, cap_mb: u64) -> Result<Arc<Self>> {
        let dir = config_dir.join("clipboard");
        fs::create_dir_all(&dir)?;
        let index_path = dir.join("index.json");
        let mut entries = match fs::read_to_string(&index_path) {
            Ok(text) => {
                serde_json::from_str::<ClipboardIndex>(&text)
                    .unwrap_or_default()
                    .entries
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        let mut reclassified = false;
        for entry in &mut entries {
            if entry.kind == ClipboardKind::Image {
                if let (Some(image_file), Some(preview_file)) =
                    (&entry.image_file, &entry.preview_file)
                {
                    let image_path = dir.join(image_file);
                    let preview_path = dir.join(preview_file);
                    if image_path.exists() {
                        if let Ok(loaded) = image::open(&image_path) {
                            let thumb = loaded.thumbnail(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
                            let _ = thumb.save_with_format(&preview_path, ImageFormat::Png);
                        }
                    }
                }
                continue;
            }
            if entry.kind != ClipboardKind::Text {
                continue;
            }
            let Some(content) = entry.content.as_deref() else {
                continue;
            };
            let next_kind = classify_text(content);
            if next_kind != ClipboardKind::Text {
                entry.kind = next_kind;
                reclassified = true;
            }
        }

        let store = Arc::new(Self {
            app,
            dir,
            index_path,
            entries: Mutex::new(entries),
            cap_bytes: AtomicU64::new(mb_to_bytes(cap_mb)),
        });
        if reclassified {
            let entries = store.entries.lock().unwrap();
            store.persist(&entries)?;
        }
        store.prune()?;
        Ok(store)
    }

    pub fn start_monitor(self: &Arc<Self>) {
        let store = Arc::clone(self);
        let _ = std::thread::Builder::new()
            .name("devhub-clipboard".into())
            .spawn(move || {
                let Ok(mut clipboard) = Clipboard::new() else {
                    return;
                };
                let mut last_seen: Option<String> = None;
                let mut initialized = false;
                let mut last_prune = Instant::now();

                loop {
                    if last_prune.elapsed() >= Duration::from_secs(60) {
                        let _ = store.prune();
                        last_prune = Instant::now();
                    }

                    let captured = clipboard
                        .get()
                        .file_list()
                        .ok()
                        .filter(|files| !files.is_empty())
                        .map(Captured::Files)
                        .or_else(|| {
                            clipboard
                                .get_text()
                                .ok()
                                .filter(|text| !text.trim().is_empty())
                                .map(Captured::Text)
                        })
                        .or_else(|| {
                            clipboard.get_image().ok().map(|image| Captured::Image {
                                width: image.width as u32,
                                height: image.height as u32,
                                rgba: image.bytes.into_owned(),
                            })
                        });

                    if !initialized {
                        last_seen = captured.as_ref().map(Captured::hash);
                        initialized = true;
                    } else if let Some(captured) = captured {
                        let hash = captured.hash();
                        if last_seen.as_deref() != Some(&hash) {
                            let result = match captured {
                                Captured::Text(text) => store.record_text(text, hash.clone()),
                                Captured::Files(files) => store.record_files(files, hash.clone()),
                                Captured::Image {
                                    width,
                                    height,
                                    rgba,
                                } => store.record_image(width, height, rgba, hash.clone()),
                            };
                            if result.is_ok() {
                                last_seen = Some(hash);
                            }
                        }
                    }
                    std::thread::sleep(POLL_INTERVAL);
                }
            });
    }

    pub fn snapshot(&self) -> Result<ClipboardSnapshot> {
        self.prune()?;
        let entries = self.entries.lock().unwrap();
        let total_bytes = entries.iter().map(|entry| entry.byte_size).sum();
        let views = entries
            .iter()
            .map(|entry| self.to_view(entry))
            .collect::<Vec<_>>();
        Ok(ClipboardSnapshot {
            entries: views,
            total_bytes,
            cap_bytes: self.cap_bytes.load(Ordering::Relaxed),
            retention_days: RETENTION_DAYS,
        })
    }

    pub fn set_cap_mb(&self, cap_mb: u64) -> Result<()> {
        self.cap_bytes.store(mb_to_bytes(cap_mb), Ordering::Relaxed);
        self.prune()
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let mut entries = self.entries.lock().unwrap();
        if let Some(index) = entries.iter().position(|entry| entry.id == id) {
            let removed = entries.remove(index);
            self.delete_files(&removed);
            self.persist(&entries)?;
            self.notify();
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        let mut entries = self.entries.lock().unwrap();
        for entry in entries.drain(..) {
            self.delete_files(&entry);
        }
        self.persist(&entries)?;
        self.notify();
        Ok(())
    }

    pub fn copy_entry(&self, id: &str) -> Result<()> {
        let entry = self
            .entries
            .lock()
            .unwrap()
            .iter()
            .find(|entry| entry.id == id)
            .cloned()
            .ok_or_else(|| Error::Other("clipboard entry no longer exists".into()))?;
        let mut clipboard = Clipboard::new().map_err(|error| Error::Other(error.to_string()))?;
        if let Some(text) = entry.content {
            clipboard
                .set_text(text)
                .map_err(|error| Error::Other(error.to_string()))?;
        } else if let Some(files) = entry.files {
            let paths = files.into_iter().map(PathBuf::from).collect::<Vec<_>>();
            clipboard
                .set()
                .file_list(&paths)
                .map_err(|error| Error::Other(error.to_string()))?;
        } else if let Some(file) = entry.image_file {
            let image = image::open(self.dir.join(file))
                .map_err(|error| Error::Other(error.to_string()))?
                .to_rgba8();
            clipboard
                .set_image(ImageData {
                    width: image.width() as usize,
                    height: image.height() as usize,
                    bytes: Cow::Owned(image.into_raw()),
                })
                .map_err(|error| Error::Other(error.to_string()))?;
        }
        Ok(())
    }

    pub fn image_data_url(&self, id: &str) -> Result<Option<String>> {
        let image_file = self
            .entries
            .lock()
            .unwrap()
            .iter()
            .find(|entry| entry.id == id)
            .and_then(|entry| entry.image_file.clone());
        let Some(image_file) = image_file else {
            return Ok(None);
        };
        let bytes = fs::read(self.dir.join(image_file))?;
        Ok(Some(format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )))
    }

    fn record_text(&self, text: String, content_hash: String) -> Result<()> {
        let now = Utc::now();
        let mut entries = self.entries.lock().unwrap();
        if let Some(index) = entries
            .iter()
            .position(|entry| entry.content_hash == content_hash)
        {
            let mut entry = entries.remove(index);
            entry.kind = classify_text(&text);
            entry.copied_at = now;
            entry.copy_count = entry.copy_count.saturating_add(1);
            entries.insert(0, entry);
        } else {
            let byte_size = text.len() as u64;
            entries.insert(
                0,
                StoredClipboardEntry {
                    id: Uuid::new_v4().to_string(),
                    kind: classify_text(&text),
                    content: Some(text),
                    files: None,
                    image_file: None,
                    preview_file: None,
                    content_hash,
                    byte_size,
                    created_at: now,
                    copied_at: now,
                    copy_count: 1,
                    width: None,
                    height: None,
                },
            );
        }
        self.prune_locked(&mut entries);
        self.persist(&entries)?;
        self.notify();
        Ok(())
    }

    fn record_files(&self, files: Vec<PathBuf>, content_hash: String) -> Result<()> {
        let now = Utc::now();
        let mut entries = self.entries.lock().unwrap();
        if let Some(index) = entries
            .iter()
            .position(|entry| entry.content_hash == content_hash)
        {
            let mut entry = entries.remove(index);
            entry.copied_at = now;
            entry.copy_count = entry.copy_count.saturating_add(1);
            entries.insert(0, entry);
        } else {
            let byte_size = files
                .iter()
                .filter_map(|path| fs::metadata(path).ok())
                .map(|metadata| metadata.len())
                .sum();
            entries.insert(
                0,
                StoredClipboardEntry {
                    id: Uuid::new_v4().to_string(),
                    kind: ClipboardKind::File,
                    content: None,
                    files: Some(
                        files
                            .iter()
                            .map(|path| path.display().to_string())
                            .collect(),
                    ),
                    image_file: None,
                    preview_file: None,
                    content_hash,
                    byte_size,
                    created_at: now,
                    copied_at: now,
                    copy_count: 1,
                    width: None,
                    height: None,
                },
            );
        }
        self.prune_locked(&mut entries);
        self.persist(&entries)?;
        self.notify();
        Ok(())
    }

    fn record_image(
        &self,
        width: u32,
        height: u32,
        rgba: Vec<u8>,
        content_hash: String,
    ) -> Result<()> {
        let now = Utc::now();
        let mut entries = self.entries.lock().unwrap();
        if let Some(index) = entries
            .iter()
            .position(|entry| entry.content_hash == content_hash)
        {
            let mut entry = entries.remove(index);
            entry.copied_at = now;
            entry.copy_count = entry.copy_count.saturating_add(1);
            entries.insert(0, entry);
        } else {
            let id = Uuid::new_v4().to_string();
            let image_file = format!("{id}.png");
            let preview_file = format!("{id}.thumb.png");
            let Some(image) = RgbaImage::from_raw(width, height, rgba) else {
                return Err(Error::Other(
                    "clipboard image has invalid pixel data".into(),
                ));
            };
            let dynamic_image = DynamicImage::ImageRgba8(image);
            dynamic_image
                .save_with_format(self.dir.join(&image_file), ImageFormat::Png)
                .map_err(|error| Error::Other(error.to_string()))?;
            let thumbnail = dynamic_image.thumbnail(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT);
            thumbnail
                .save_with_format(self.dir.join(&preview_file), ImageFormat::Png)
                .map_err(|error| Error::Other(error.to_string()))?;
            let byte_size = fs::metadata(self.dir.join(&image_file))?.len()
                + fs::metadata(self.dir.join(&preview_file))?.len();
            entries.insert(
                0,
                StoredClipboardEntry {
                    id,
                    kind: ClipboardKind::Image,
                    content: None,
                    files: None,
                    image_file: Some(image_file),
                    preview_file: Some(preview_file),
                    content_hash,
                    byte_size,
                    created_at: now,
                    copied_at: now,
                    copy_count: 1,
                    width: Some(width),
                    height: Some(height),
                },
            );
        }
        self.prune_locked(&mut entries);
        self.persist(&entries)?;
        self.notify();
        Ok(())
    }

    fn prune(&self) -> Result<()> {
        let mut entries = self.entries.lock().unwrap();
        if self.prune_locked(&mut entries) {
            self.persist(&entries)?;
            self.notify();
        }
        Ok(())
    }

    fn prune_locked(&self, entries: &mut Vec<StoredClipboardEntry>) -> bool {
        let cutoff = Utc::now() - TimeDelta::days(i64::from(RETENTION_DAYS));
        let mut removed = Vec::new();
        entries.retain(|entry| {
            if entry.copied_at < cutoff {
                removed.push(entry.clone());
                false
            } else {
                true
            }
        });
        entries.sort_by(|left, right| right.copied_at.cmp(&left.copied_at));

        let cap = self.cap_bytes.load(Ordering::Relaxed);
        let mut total: u64 = entries.iter().map(|entry| entry.byte_size).sum();
        while total > cap {
            let Some(entry) = entries.pop() else { break };
            total = total.saturating_sub(entry.byte_size);
            removed.push(entry);
        }
        for entry in &removed {
            self.delete_files(entry);
        }
        !removed.is_empty()
    }

    fn to_view(&self, entry: &StoredClipboardEntry) -> ClipboardEntry {
        let preview_data_url = entry.preview_file.as_ref().and_then(|file| {
            fs::read(self.dir.join(file)).ok().map(|bytes| {
                format!(
                    "data:image/png;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(bytes)
                )
            })
        });
        ClipboardEntry {
            id: entry.id.clone(),
            kind: entry.kind,
            content: entry.content.clone(),
            files: entry.files.clone(),
            preview_data_url,
            byte_size: entry.byte_size,
            created_at: entry.created_at.to_rfc3339(),
            copied_at: entry.copied_at.to_rfc3339(),
            copy_count: entry.copy_count,
            width: entry.width,
            height: entry.height,
        }
    }

    fn persist(&self, entries: &[StoredClipboardEntry]) -> Result<()> {
        let json = serde_json::to_vec_pretty(&ClipboardIndex {
            entries: entries.to_vec(),
        })
        .map_err(|error| Error::Other(error.to_string()))?;
        let temp = self.index_path.with_extension("json.tmp");
        fs::write(&temp, json)?;
        fs::rename(temp, &self.index_path)?;
        Ok(())
    }

    fn delete_files(&self, entry: &StoredClipboardEntry) {
        for file in [&entry.image_file, &entry.preview_file]
            .into_iter()
            .flatten()
        {
            let _ = fs::remove_file(self.dir.join(file));
        }
    }

    fn notify(&self) {
        let _ = self.app.emit("devhub://clipboard", ());
    }
}

enum Captured {
    Text(String),
    Files(Vec<PathBuf>),
    Image {
        width: u32,
        height: u32,
        rgba: Vec<u8>,
    },
}

impl Captured {
    fn hash(&self) -> String {
        match self {
            Self::Text(text) => stable_hash(b"text", text.as_bytes()),
            Self::Files(files) => {
                let joined = files
                    .iter()
                    .map(|path| path.to_string_lossy())
                    .collect::<Vec<_>>()
                    .join("\0");
                stable_hash(b"files", joined.as_bytes())
            }
            Self::Image {
                width,
                height,
                rgba,
            } => {
                let mut dimensions = [0_u8; 8];
                dimensions[..4].copy_from_slice(&width.to_le_bytes());
                dimensions[4..].copy_from_slice(&height.to_le_bytes());
                stable_hash(&dimensions, rgba)
            }
        }
    }
}

fn stable_hash(prefix: &[u8], bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in prefix.iter().chain(bytes) {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn classify_text(text: &str) -> ClipboardKind {
    let trimmed = text.trim();
    if (trimmed.starts_with("http://") || trimmed.starts_with("https://"))
        && !trimmed.chars().any(char::is_whitespace)
    {
        ClipboardKind::Link
    } else if looks_like_code(trimmed) {
        ClipboardKind::Code
    } else {
        ClipboardKind::Text
    }
}

fn looks_like_code(text: &str) -> bool {
    if text.is_empty() {
        return false;
    }

    let lower = text.to_ascii_lowercase();
    let starts_with_syntax = [
        "const ",
        "let ",
        "var ",
        "function ",
        "class ",
        "import ",
        "export ",
        "interface ",
        "type ",
        "enum ",
        "async ",
        "await ",
        "return ",
        "fn ",
        "pub fn ",
        "def ",
        "from ",
        "package ",
        "use ",
        "select ",
        "insert ",
        "update ",
        "delete ",
        "create table ",
        "#!/",
        "<?",
        "```",
    ]
    .iter()
    .any(|marker| lower.starts_with(marker));

    let starts_with_command = [
        "$ ", "git ", "npm ", "pnpm ", "yarn ", "bun ", "cargo ", "docker ", "kubectl ", "curl ",
        "wget ", "lsof ", "grep ", "rg ", "cd ", "mkdir ", "chmod ", "export ",
    ]
    .iter()
    .any(|marker| lower.starts_with(marker));

    let wrapped_data = (text.starts_with('{') && text.ends_with('}'))
        || (text.starts_with('[') && text.ends_with(']') && text.contains(':'));
    let syntax_hits = [
        "=>",
        "::",
        "();",
        " = await ",
        "console.",
        "</",
        "&&",
        "||",
        "#!/",
    ]
    .iter()
    .filter(|marker| text.contains(**marker))
    .count();
    let paired_braces = text.contains('{') && text.contains('}');
    let assignment_statement =
        text.contains(" = ") && (text.contains(';') || text.contains('(') || text.contains('{'));
    let multiline_syntax = text.contains('\n')
        && (paired_braces
            || text
                .lines()
                .any(|line| line.starts_with("  ") || line.starts_with('\t'))
            || text.lines().any(|line| line.trim_end().ends_with(';')));

    starts_with_syntax
        || starts_with_command
        || wrapped_data
        || paired_braces
        || assignment_statement
        || syntax_hits >= 1
        || multiline_syntax
}

fn mb_to_bytes(cap_mb: u64) -> u64 {
    cap_mb.max(1).saturating_mul(1024 * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_classification_distinguishes_links_and_code() {
        assert_eq!(classify_text("https://example.com"), ClipboardKind::Link);
        assert_eq!(
            classify_text("const port = 3000;\nrun(port)"),
            ClipboardKind::Code
        );
        assert_eq!(classify_text("const port = 3000;"), ClipboardKind::Code);
        assert_eq!(classify_text("git status --short"), ClipboardKind::Code);
        assert_eq!(classify_text("{\"name\":\"devhub\"}"), ClipboardKind::Code);
        assert_eq!(
            classify_text("First line of a note\nSecond line of a note"),
            ClipboardKind::Text
        );
        assert_eq!(classify_text("hello"), ClipboardKind::Text);
    }

    #[test]
    fn stable_hash_changes_with_content() {
        assert_eq!(stable_hash(b"text", b"same"), stable_hash(b"text", b"same"));
        assert_ne!(
            stable_hash(b"text", b"same"),
            stable_hash(b"text", b"other")
        );
    }

    #[test]
    fn older_text_entries_are_reclassified_when_loaded() {
        let directory = tempfile::tempdir().expect("tempdir");
        let app = tauri::test::mock_app();
        let store = ClipboardStore::load(app.handle().clone(), directory.path(), 16)
            .expect("initial store");
        let content = "const port = 3000;";
        store
            .record_text(content.into(), stable_hash(b"text", content.as_bytes()))
            .expect("record code");
        {
            let mut entries = store.entries.lock().unwrap();
            entries[0].kind = ClipboardKind::Text;
            store.persist(&entries).expect("persist old classification");
        }
        drop(store);

        let reloaded = ClipboardStore::load(app.handle().clone(), directory.path(), 16)
            .expect("reloaded store");
        assert_eq!(
            reloaded.snapshot().expect("snapshot").entries[0].kind,
            ClipboardKind::Code
        );
    }

    #[test]
    fn repeated_content_is_one_entry_and_moves_forward() {
        let directory = tempfile::tempdir().expect("tempdir");
        let app = tauri::test::mock_app();
        let store =
            ClipboardStore::load(app.handle().clone(), directory.path(), 16).expect("store");
        let hash = stable_hash(b"text", b"same");
        store
            .record_text("same".into(), hash.clone())
            .expect("first copy");
        store.record_text("same".into(), hash).expect("second copy");

        let snapshot = store.snapshot().expect("snapshot");
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(snapshot.entries[0].copy_count, 2);
    }

    #[test]
    fn cap_removes_the_oldest_entry_first() {
        let directory = tempfile::tempdir().expect("tempdir");
        let app = tauri::test::mock_app();
        let store = ClipboardStore::load(app.handle().clone(), directory.path(), 1).expect("store");
        let first = "a".repeat(700_000);
        let second = "b".repeat(700_000);
        store
            .record_text(first.clone(), stable_hash(b"text", first.as_bytes()))
            .expect("first");
        store
            .record_text(second.clone(), stable_hash(b"text", second.as_bytes()))
            .expect("second");

        let snapshot = store.snapshot().expect("snapshot");
        assert_eq!(snapshot.entries.len(), 1);
        assert_eq!(
            snapshot.entries[0].content.as_deref(),
            Some(second.as_str())
        );
        assert!(snapshot.total_bytes <= snapshot.cap_bytes);
    }

    #[test]
    fn entries_older_than_seven_days_are_removed() {
        let directory = tempfile::tempdir().expect("tempdir");
        let app = tauri::test::mock_app();
        let store =
            ClipboardStore::load(app.handle().clone(), directory.path(), 16).expect("store");
        let hash = stable_hash(b"text", b"old");
        store.record_text("old".into(), hash).expect("copy");
        store.entries.lock().unwrap()[0].copied_at = Utc::now() - TimeDelta::days(8);

        assert!(store.snapshot().expect("snapshot").entries.is_empty());
    }
}
