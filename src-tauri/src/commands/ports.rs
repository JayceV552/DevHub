use tauri::State;

use crate::error::Result;
use crate::models::PortEntry;
use crate::state::AppState;

#[tauri::command]
pub fn list_ports(state: State<'_, AppState>) -> Result<Vec<PortEntry>> {
    let running = state.processes.running_pids();
    let hide_system = state.settings().hide_system_ports;
    state.ports.lock().unwrap().list(&running, hide_system)
}

#[tauri::command]
pub fn describe_process(state: State<'_, AppState>, pid: u32) -> Option<ProcessDescription> {
    state
        .ports
        .lock()
        .unwrap()
        .describe(pid)
        .map(|(name, command)| ProcessDescription { pid, name, command })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDescription {
    pub pid: u32,
    pub name: String,
    pub command: String,
}

#[tauri::command]
pub fn kill_port_process(
    state: State<'_, AppState>,
    pid: u32,
    run_id: Option<String>,
) -> Result<()> {
    match run_id {
        Some(run_id) => state.processes.stop(&run_id),
        None => state.ports.lock().unwrap().kill(pid),
    }
}
