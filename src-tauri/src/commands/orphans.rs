use tauri::State;

use crate::error::{Error, Result};
use crate::services::TrackedRun;
use crate::state::AppState;

#[tauri::command]
pub fn list_orphans(state: State<'_, AppState>) -> Vec<TrackedRun> {
    state.orphans()
}

#[tauri::command]
pub fn stop_orphan(state: State<'_, AppState>, pid: u32) -> Result<()> {
    if !state.registry.verify(pid) {
        state.release_orphan(pid);
        return Err(Error::Other(format!(
            "process {pid} is no longer the one DevHub started — it has already exited"
        )));
    }

    crate::services::process_manager::terminate_group(pid);
    state.release_orphan(pid);
    Ok(())
}

#[tauri::command]
pub fn dismiss_orphan(state: State<'_, AppState>, pid: u32) {
    state.release_orphan(pid);
}

#[tauri::command]
pub fn stop_all_orphans(state: State<'_, AppState>) -> Result<()> {
    let failures: Vec<String> = state
        .orphans()
        .into_iter()
        .filter_map(|orphan| {
            stop_orphan(state.clone(), orphan.pid)
                .err()
                .map(|err| format!("{}: {err}", orphan.project_name))
        })
        .collect();

    if failures.is_empty() {
        Ok(())
    } else {
        Err(Error::Other(failures.join("; ")))
    }
}
