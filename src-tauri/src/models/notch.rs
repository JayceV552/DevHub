use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchInfo {
    pub has_physical_notch: bool,
    pub screen_width: f64,
    pub screen_height: f64,
    pub safe_area_top: f64,
    pub notch_x: f64,
    pub notch_width: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusBarApp {
    pub name: String,
    pub bundle_id: String,
    pub pid: i32,
    pub is_hidden: bool,
    pub is_onscreen: bool,
    pub is_system: bool,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub icon_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusBarAppsResponse {
    pub hidden_count: usize,
    pub total_count: usize,
    pub apps: Vec<StatusBarApp>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MusicStatus {
    pub is_running: bool,
    pub player: String,
    pub bundle_id: String,
    pub is_playing: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    /// Playback position in seconds at `sampled_at`.
    pub position: f64,
    /// Unix epoch milliseconds when `position` was sampled.
    pub sampled_at: f64,
    /// JPEG data URL of the album artwork, if the player publishes one.
    pub artwork: Option<String>,
    /// PNG data URL of the playing app's icon.
    pub app_icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionResponse {
    pub success: bool,
    pub message: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CalendarEvent {
    pub id: String,
    pub title: String,
    /// Unix epoch milliseconds.
    pub start: f64,
    pub end: f64,
    pub all_day: bool,
    /// "#rrggbb"
    pub color: String,
    pub calendar: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CalendarEventsResponse {
    /// "authorized", "denied", "restricted" or "notDetermined".
    pub access: String,
    pub events: Vec<CalendarEvent>,
}
