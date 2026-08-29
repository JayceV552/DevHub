use tauri::State;

use crate::error::Result;
use crate::services::{PathResolver, Settings};
use crate::state::AppState;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
pub fn update_settings(state: State<'_, AppState>, settings: Settings) -> Result<Settings> {
    let cap = settings.clipboard_storage_cap_mb;
    let saved = state.update_config(|config| {
        config.settings = settings;
        Ok(config.settings.clone())
    })?;
    state.clipboard.set_cap_mb(cap)?;
    Ok(saved)
}

#[tauri::command]
pub fn get_config_path(state: State<'_, AppState>) -> String {
    state.config_path().display().to_string()
}

#[tauri::command]
pub fn get_resolved_path() -> Vec<String> {
    std::env::split_paths(PathResolver::search_path())
        .map(|dir| dir.display().to_string())
        .collect()
}
