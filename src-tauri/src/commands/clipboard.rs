use std::collections::HashMap;
use std::path::Path;

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::State;

use crate::error::Result;
use crate::models::{AppMemory, ClipboardSnapshot, MemoryConsumer, SystemMemorySnapshot};
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

#[tauri::command]
pub fn system_memory() -> SystemMemorySnapshot {
    let mut system = System::new();
    system.refresh_memory();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );

    let mut grouped = HashMap::<String, (u64, usize)>::new();
    for process in system.processes().values() {
        let memory = process.memory();
        if memory == 0 {
            continue;
        }
        let fallback = process.name().to_string_lossy();
        let name = application_name(process.exe(), &fallback);
        let entry = grouped.entry(name).or_default();
        entry.0 += memory;
        entry.1 += 1;
    }

    let mut consumers: Vec<MemoryConsumer> = grouped
        .into_iter()
        .map(|(name, (resident_bytes, process_count))| MemoryConsumer {
            name,
            resident_bytes,
            process_count,
        })
        .collect();
    consumers.sort_by_key(|consumer| std::cmp::Reverse(consumer.resident_bytes));
    consumers.truncate(8);

    SystemMemorySnapshot {
        total_bytes: system.total_memory(),
        used_bytes: system.used_memory(),
        consumers,
    }
}

fn application_name(executable: Option<&Path>, fallback: &str) -> String {
    if let Some(executable) = executable {
        for component in executable.components() {
            let value = component.as_os_str().to_string_lossy();
            if let Some(name) = value.strip_suffix(".app") {
                return name.to_string();
            }
        }
    }
    fallback.to_string()
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

#[cfg(test)]
mod tests {
    use super::application_name;
    use std::path::Path;

    #[test]
    fn helpers_are_grouped_under_their_macos_application() {
        let path = Path::new(
            "/Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper.app/Contents/MacOS/Google Chrome Helper",
        );
        assert_eq!(
            application_name(Some(path), "Google Chrome Helper"),
            "Google Chrome"
        );
        assert_eq!(application_name(None, "language_server"), "language_server");
    }
}
