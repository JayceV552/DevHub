use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardKind {
    Text,
    Code,
    Link,
    Image,
    File,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub id: String,
    pub kind: ClipboardKind,
    pub content: Option<String>,
    pub files: Option<Vec<String>>,
    pub preview_data_url: Option<String>,
    pub byte_size: u64,
    pub created_at: String,
    pub copied_at: String,
    pub copy_count: u32,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardSnapshot {
    pub entries: Vec<ClipboardEntry>,
    pub total_bytes: u64,
    pub cap_bytes: u64,
    pub retention_days: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppMemory {
    pub resident_bytes: u64,
    pub process_count: usize,
}
