use tauri::State;

use crate::error::{Error, Result};
use crate::models::{OutputLine, Run};
use crate::state::AppState;

#[tauri::command]
pub fn start_command(
    state: State<'_, AppState>,
    project_id: String,
    command_id: String,
) -> Result<Run> {
    let project = state
        .project(&project_id)
        .ok_or_else(|| Error::ProjectNotFound(project_id.clone()))?;

    let spec = project
        .commands
        .get(&command_id)
        .ok_or_else(|| Error::CommandNotFound {
            project: project.name.clone(),
            command: command_id.clone(),
        })?;

    state
        .processes
        .spawn(&project.id, &project.name, &project.path, &command_id, spec)
}

#[tauri::command]
pub fn stop_run(state: State<'_, AppState>, run_id: String) -> Result<()> {
    state.processes.stop(&run_id)
}

#[tauri::command]
pub fn restart_run(state: State<'_, AppState>, run_id: String) -> Result<Run> {
    let run = state
        .processes
        .list_runs()
        .into_iter()
        .find(|r| r.run_id == run_id)
        .ok_or_else(|| Error::RunNotFound(run_id.clone()))?;

    if !run.status.is_terminal() {
        state.processes.stop(&run_id)?;
    }

    let project = state
        .project(&run.project_id)
        .ok_or_else(|| Error::ProjectNotFound(run.project_id.clone()))?;
    let spec = project
        .commands
        .get(&run.command_id)
        .ok_or_else(|| Error::CommandNotFound {
            project: project.name.clone(),
            command: run.command_id.clone(),
        })?;

    state.processes.spawn(
        &project.id,
        &project.name,
        &project.path,
        &run.command_id,
        spec,
    )
}

#[tauri::command]
pub fn list_runs(state: State<'_, AppState>) -> Vec<Run> {
    state.processes.list_runs()
}

#[tauri::command]
pub fn get_run_output(state: State<'_, AppState>, run_id: String) -> Result<Vec<OutputLine>> {
    state.processes.get_output(&run_id)
}

#[tauri::command]
pub fn clear_run(state: State<'_, AppState>, run_id: String) -> Result<()> {
    state.processes.clear_run(&run_id)
}

#[tauri::command]
pub fn start_group(state: State<'_, AppState>, group: String) -> Result<Vec<Run>> {
    let mut started = Vec::new();
    let mut failures = Vec::new();

    for project in state
        .projects()
        .into_iter()
        .filter(|p| p.group.as_deref() == Some(&group))
    {
        let Some((command_id, spec)) = project
            .commands
            .iter()
            .find(|(_, spec)| spec.kind == crate::models::CommandKind::Service)
        else {
            continue;
        };

        if state
            .processes
            .active_run_for(&project.id, command_id)
            .is_some()
        {
            continue;
        }

        match state
            .processes
            .spawn(&project.id, &project.name, &project.path, command_id, spec)
        {
            Ok(run) => started.push(run),
            Err(err) => failures.push(format!("{}: {err}", project.name)),
        }
    }

    if failures.is_empty() {
        Ok(started)
    } else {
        Err(Error::Other(failures.join("; ")))
    }
}

#[tauri::command]
pub fn stop_group(state: State<'_, AppState>, group: String) -> Result<()> {
    let in_group: Vec<String> = state
        .projects()
        .into_iter()
        .filter(|p| p.group.as_deref() == Some(&group))
        .map(|p| p.id)
        .collect();

    for run in state.processes.list_runs() {
        if in_group.contains(&run.project_id) && !run.status.is_terminal() {
            state.processes.stop(&run.run_id)?;
        }
    }
    Ok(())
}
