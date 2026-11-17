use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::Result;
use crate::models::{CalendarEventsResponse, MusicStatus, NotchInfo, StatusBarAppsResponse};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotchQuickStats {
    pub active_ports_count: usize,
    pub running_processes_count: usize,
    pub caffeinate_active: bool,
}

#[tauri::command]
pub async fn get_notch_info(app: AppHandle, state: State<'_, AppState>) -> Result<NotchInfo> {
    state.notch.get_notch_info(&app)
}

#[tauri::command]
pub async fn get_status_bar_apps(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<StatusBarAppsResponse> {
    state.notch.get_status_bar_apps(&app)
}

#[tauri::command]
pub async fn activate_app(app: AppHandle, state: State<'_, AppState>, pid: i32) -> Result<bool> {
    state.notch.activate_app(&app, pid)
}

#[tauri::command]
pub async fn quit_app(
    app: AppHandle,
    state: State<'_, AppState>,
    pid: i32,
    force: bool,
) -> Result<bool> {
    state.notch.quit_app(&app, pid, force)
}

#[tauri::command]
pub async fn get_music_status(app: AppHandle, state: State<'_, AppState>) -> Result<MusicStatus> {
    state.notch.get_music_status(&app)
}

#[tauri::command]
pub async fn get_calendar_events(
    app: AppHandle,
    state: State<'_, AppState>,
    start_ms: f64,
    days: u32,
) -> Result<CalendarEventsResponse> {
    state.notch.get_calendar_events(&app, start_ms, days)
}

#[tauri::command]
pub fn control_music(
    app: AppHandle,
    state: State<'_, AppState>,
    action: String,
) -> Result<bool> {
    state.notch.control_music(&app, &action)
}

#[tauri::command]
pub async fn open_airdrop(app: AppHandle, state: State<'_, AppState>) -> Result<bool> {
    state.notch.open_airdrop(&app)
}

#[tauri::command]
pub async fn share_airdrop(
    app: AppHandle,
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<bool> {
    state.notch.share_airdrop(&app, &paths)
}

#[tauri::command]
pub fn set_notch_window_state(
    app: AppHandle,
    state: State<'_, AppState>,
    expanded: bool,
) -> Result<()> {
    state.notch.set_notch_window_state(&app, expanded)
}

#[tauri::command]
pub fn set_notch_pinned(
    app: AppHandle,
    state: State<'_, AppState>,
    pinned: bool,
) -> Result<()> {
    state.notch.set_notch_pinned(&app, pinned)
}

#[tauri::command]
pub fn set_notch_live_wing(state: State<'_, AppState>, wing: f64) {
    state.notch.set_live_wing(wing);
}

#[tauri::command]
pub fn toggle_notch_window(
    app: AppHandle,
    state: State<'_, AppState>,
    enable: bool,
) -> Result<()> {
    state.notch.toggle_notch_window(&app, enable)
}

#[tauri::command]
pub fn show_devhub_main_window(app: AppHandle) -> Result<()> {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.unminimize();
        let _ = main_window.show();
        let _ = main_window.set_focus();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_notch_quick_stats(
    _app: AppHandle,
    state: State<'_, AppState>,
) -> Result<NotchQuickStats> {
    let running_pids = state.processes.running_pids();
    let hide_system = state.settings().hide_system_ports;
    let ports = state.ports.lock().unwrap().list(&running_pids, hide_system).unwrap_or_default();
    let runs = state.processes.list_runs();
    let running_count = runs.iter().filter(|r| r.status == crate::models::RunStatus::Running).count();
    let caffeinate_active = state.caffeinate.is_active();

    Ok(NotchQuickStats {
        active_ports_count: ports.len(),
        running_processes_count: running_count,
        caffeinate_active,
    })
}
