use tauri::State;

use crate::error::{Error, Result};
use crate::services::TrackedRun;
use crate::state::AppState;

#[tauri::command]
pub fn list_orphans(state: State<'_, AppState>) -> Vec<TrackedRun> {
    state.orphans()
}

#[tauri::command]
pub async fn stop_orphan(state: State<'_, AppState>, pid: u32) -> Result<()> {
    if !state.registry.verify(pid) {
        state.release_orphan(pid);
        return Err(Error::Other(format!(
            "process {pid} is no longer the one DevHub started — it has already exited"
        )));
    }

    state.processes.stop_tracked_group(pid).await?;
    state.release_orphan(pid);
    Ok(())
}

#[tauri::command]
pub fn dismiss_orphan(state: State<'_, AppState>, pid: u32) {
    state.release_orphan(pid);
}

#[tauri::command]
pub async fn stop_all_orphans(state: State<'_, AppState>) -> Result<()> {
    let mut failures = Vec::new();
    for orphan in state.orphans() {
        if let Err(err) = state.processes.stop_tracked_group(orphan.pid).await {
            failures.push(format!("{}: {err}", orphan.project_name));
        } else {
            state.release_orphan(orphan.pid);
        }
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(Error::Other(failures.join("; ")))
    }
}
