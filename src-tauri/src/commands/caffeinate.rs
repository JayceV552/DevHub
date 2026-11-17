use tauri::State;

use crate::error::Result;
use crate::state::AppState;

#[tauri::command]
pub fn get_caffeinate_status(state: State<'_, AppState>) -> bool {
    state.caffeinate.is_active()
}

#[tauri::command]
pub fn toggle_caffeinate(state: State<'_, AppState>) -> Result<bool> {
    state.caffeinate.toggle()
}

#[tauri::command]
pub fn set_caffeinate(state: State<'_, AppState>, active: bool) -> Result<bool> {
    if active {
        state.caffeinate.start()
    } else {
        state.caffeinate.stop()
    }
}
