use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{Error, Result};
use crate::models::{
    ActionResponse, CalendarEventsResponse, MusicStatus, NotchInfo, StatusBarAppsResponse,
};
use crate::services::notch_music::MusicStream;

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn setup_notch_nswindow(nswindow_ptr: *mut std::ffi::c_void, width: f64, height: f64);
    fn resize_notch_nswindow(nswindow_ptr: *mut std::ffi::c_void, width: f64, height: f64);
    fn register_notch_expand_callback(callback: unsafe extern "C" fn(bool));
    fn set_notch_pinned_native(pinned: bool);
    fn set_notch_live_wing(wing: f64);
    fn control_music_native(action: *const std::os::raw::c_char);
}

#[cfg(target_os = "macos")]
static GLOBAL_APP_HANDLE: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

#[cfg(target_os = "macos")]
unsafe extern "C" fn on_notch_expand_c(expanded: bool) {
    if let Some(app) = GLOBAL_APP_HANDLE.get() {
        use tauri::Emitter;
        let _ = app.emit_to("notch", "devhub://notch-expand", expanded);
    }
}

pub struct NotchManager {
    helper_path: Mutex<Option<PathBuf>>,
    music: MusicStream,
}

impl Default for NotchManager {
    fn default() -> Self {
        Self::new()
    }
}

impl NotchManager {
    pub fn new() -> Self {
        Self {
            helper_path: Mutex::new(None),
            music: MusicStream::default(),
        }
    }

    pub fn ensure_helper_path(&self, app: &AppHandle) -> Result<PathBuf> {
        let mut guard = self.helper_path.lock().unwrap();
        if let Some(path) = guard.as_ref().filter(|p| p.exists()) {
            return Ok(path.clone());
        }

        const NAME: &str = "devhub-notch-helper";
        let mut candidates: Vec<PathBuf> = Vec::new();
        // Next to the executable, then the packaged .app resources.
        if let Some(dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
            candidates.push(dir.join(NAME));
        }
        if let Ok(resources) = app.path().resource_dir() {
            candidates.push(resources.join(NAME));
            candidates.push(resources.join("native").join(NAME));
        }
        // Dev checkouts, then the copy build.rs compiled into OUT_DIR.
        candidates.push(PathBuf::from("native").join(NAME));
        candidates.push(PathBuf::from("src-tauri/native").join(NAME));
        if let Some(env_path) = option_env!("DEVHUB_NOTCH_HELPER_PATH") {
            candidates.push(PathBuf::from(env_path));
        }
        if let Ok(cache) = app.path().app_cache_dir() {
            candidates.push(cache.join(NAME));
        }

        let found = candidates
            .into_iter()
            .find(|p| p.exists())
            .ok_or_else(|| Error::Other(format!("{NAME} binary not found")))?;
        *guard = Some(found.clone());
        Ok(found)
    }

    fn run_helper(&self, app: &AppHandle, args: &[&str]) -> Result<String> {
        let helper = self.ensure_helper_path(app)?;
        let output = Command::new(&helper)
            .args(args)
            .output()
            .map_err(|e| Error::Other(format!("Failed to execute notch helper: {e}")))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(Error::Other(format!("Notch helper error: {stderr}")));
        }

        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub fn get_notch_info(&self, app: &AppHandle) -> Result<NotchInfo> {
        let json_str = self.run_helper(app, &["notch-info"])?;
        serde_json::from_str(&json_str)
            .map_err(|e| Error::Other(format!("Failed to parse notch info: {e}")))
    }

    pub fn get_status_bar_apps(&self, app: &AppHandle) -> Result<StatusBarAppsResponse> {
        let json_str = self.run_helper(app, &["status-apps"])?;
        serde_json::from_str(&json_str)
            .map_err(|e| Error::Other(format!("Failed to parse status bar apps: {e}")))
    }

    pub fn activate_app(&self, app: &AppHandle, pid: i32) -> Result<bool> {
        let pid_str = pid.to_string();
        let json_str = self.run_helper(app, &["activate-app", &pid_str])?;
        let resp: ActionResponse = serde_json::from_str(&json_str)
            .map_err(|e| Error::Other(format!("Failed to parse action response: {e}")))?;
        Ok(resp.success)
    }

    pub fn quit_app(&self, app: &AppHandle, pid: i32, force: bool) -> Result<bool> {
        let pid_str = pid.to_string();
        let args = if force {
            vec!["quit-app", pid_str.as_str(), "force"]
        } else {
            vec!["quit-app", pid_str.as_str()]
        };
        let json_str = self.run_helper(app, &args)?;
        let resp: ActionResponse = serde_json::from_str(&json_str)
            .map_err(|e| Error::Other(format!("Failed to parse action response: {e}")))?;
        Ok(resp.success)
    }

    pub fn get_music_status(&self, app: &AppHandle) -> Result<MusicStatus> {
        if let Some(status) = self.music.latest() {
            return Ok(status);
        }
        let json_str = self.run_helper(app, &["music-status"])?;
        serde_json::from_str(&json_str)
            .map_err(|e| Error::Other(format!("Failed to parse music status: {e}")))
    }

    pub fn get_calendar_events(
        &self,
        app: &AppHandle,
        start_ms: f64,
        days: u32,
    ) -> Result<CalendarEventsResponse> {
        let start = format!("{start_ms:.0}");
        let days = days.clamp(1, 31).to_string();
        let json_str = self.run_helper(app, &["calendar-events", &start, &days])?;
        serde_json::from_str(&json_str)
            .map_err(|e| Error::Other(format!("Failed to parse calendar events: {e}")))
    }

    pub fn control_music(&self, app: &AppHandle, action: &str) -> Result<bool> {
        #[cfg(target_os = "macos")]
        {
            if let Ok(c_action) = std::ffi::CString::new(action) {
                unsafe {
                    control_music_native(c_action.as_ptr());
                }
                return Ok(true);
            }
        }

        let json_str = self.run_helper(app, &["music-control", action])?;
        let resp: ActionResponse = serde_json::from_str(&json_str)
            .map_err(|e| Error::Other(format!("Failed to parse action response: {e}")))?;
        Ok(resp.success)
    }

    pub fn open_airdrop(&self, app: &AppHandle) -> Result<bool> {
        let json_str = self.run_helper(app, &["open-airdrop"])?;
        let resp: ActionResponse = serde_json::from_str(&json_str)
            .map_err(|e| Error::Other(format!("Failed to parse action response: {e}")))?;
        Ok(resp.success)
    }

    pub fn share_airdrop(&self, app: &AppHandle, paths: &[String]) -> Result<bool> {
        let mut args = vec!["share-airdrop"];
        let str_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
        args.extend(str_refs);
        let json_str = self.run_helper(app, &args)?;
        let resp: ActionResponse = serde_json::from_str(&json_str)
            .map_err(|e| Error::Other(format!("Failed to parse action response: {e}")))?;
        Ok(resp.success)
    }

    pub fn set_notch_window_state(&self, app: &AppHandle, expanded: bool) -> Result<()> {
        let window = match app.get_webview_window("notch") {
            Some(w) => w,
            None => return Ok(()),
        };

        let (width, height) = if expanded {
            (580.0, 200.0)
        } else {
            (200.0, 32.0)
        };

        #[cfg(target_os = "macos")]
        {
            if let Ok(ptr) = window.ns_window() {
                unsafe {
                    resize_notch_nswindow(ptr, width, height);
                }
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let screen_width = if let Ok(Some(monitor)) = window.primary_monitor() {
                monitor.size().width as f64 / monitor.scale_factor()
            } else {
                1512.0
            };
            let x = (screen_width - width) / 2.0;
            let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y: 0.0 }));
        }

        Ok(())
    }

    pub fn setup_notch_window(&self, app: &AppHandle) -> Result<()> {
        let window = match app.get_webview_window("notch") {
            Some(w) => w,
            None => {
                let win_builder = WebviewWindowBuilder::new(
                    app,
                    "notch",
                    WebviewUrl::App("index.html?window=notch".into()),
                )
                .title("DevHub Notch")
                .inner_size(640.0, 240.0)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .shadow(false)
                .resizable(false);

                win_builder
                    .build()
                    .map_err(|e| Error::Other(format!("Failed to build notch window: {e}")))?
            }
        };

        #[cfg(target_os = "macos")]
        {
            let _ = GLOBAL_APP_HANDLE.set(app.clone());
            if let Ok(ptr) = window.ns_window() {
                unsafe {
                    register_notch_expand_callback(on_notch_expand_c);
                    setup_notch_nswindow(ptr, 640.0, 240.0);
                }
            }
        }

        #[cfg(not(target_os = "macos"))]
        {
            let screen_width = if let Ok(Some(monitor)) = window.primary_monitor() {
                monitor.size().width as f64 / monitor.scale_factor()
            } else {
                1512.0
            };
            let x = (screen_width - 200.0) / 2.0;
            let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition { x, y: 0.0 }));
        }

        if let Ok(helper) = self.ensure_helper_path(app) {
            self.music.start(app, helper);
        }

        let _ = window.show();

        Ok(())
    }

    /// Widens the native hover zone while the collapsed live activity
    /// (artwork + equalizer beside the notch) is visible.
    pub fn set_live_wing(&self, wing: f64) {
        #[cfg(target_os = "macos")]
        unsafe {
            set_notch_live_wing(wing);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = wing;
    }

    pub fn toggle_notch_window(&self, app: &AppHandle, enable: bool) -> Result<()> {
        if let Some(window) = app.get_webview_window("notch") {
            if enable {
                let _ = window.show();
            } else {
                let _ = window.hide();
            }
        } else if enable {
            self.setup_notch_window(app)?;
        }
        Ok(())
    }

    pub fn set_notch_pinned(&self, _app: &AppHandle, pinned: bool) -> Result<()> {
        #[cfg(target_os = "macos")]
        unsafe {
            set_notch_pinned_native(pinned);
        }
        Ok(())
    }
}
