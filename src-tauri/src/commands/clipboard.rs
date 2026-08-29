use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::State;

use crate::error::Result;
use crate::models::{AppMemory, ClipboardSnapshot};
use crate::state::AppState;

#[tauri::command]
pub fn clipboard_snapshot(state: State<'_, AppState>) -> Result<ClipboardSnapshot> {
    state.clipboard.snapshot()
}

#[tauri::command]
pub fn copy_clipboard_entry(state: State<'_, AppState>, id: String) -> Result<()> {
    state.clipboard.copy_entry(&id)
}

#[tauri::command]
pub fn clipboard_image_data(state: State<'_, AppState>, id: String) -> Result<Option<String>> {
    state.clipboard.image_data_url(&id)
}

#[tauri::command]
pub fn delete_clipboard_entry(state: State<'_, AppState>, id: String) -> Result<()> {
    state.clipboard.delete(&id)
}

#[tauri::command]
pub fn clear_clipboard_history(state: State<'_, AppState>) -> Result<()> {
    state.clipboard.clear()
}

#[tauri::command]
pub fn app_memory() -> AppMemory {
    let Ok(root) = sysinfo::get_current_pid() else {
        return AppMemory {
            resident_bytes: 0,
            process_count: 0,
        };
    };
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );

    let mut resident_bytes = 0;
    let mut process_count = 0;
    for (pid, process) in system.processes() {
        if *pid == root || is_descendant(*pid, root, &system) {
            resident_bytes += process.memory();
            process_count += 1;
        }
    }
    AppMemory {
        resident_bytes,
        process_count,
    }
}

fn is_descendant(mut pid: Pid, root: Pid, system: &System) -> bool {
    for _ in 0..32 {
        let Some(parent) = system.process(pid).and_then(|process| process.parent()) else {
            return false;
        };
        if parent == root {
            return true;
        }
        if parent.as_u32() <= 1 || parent == pid {
            return false;
        }
        pid = parent;
    }
    false
}
