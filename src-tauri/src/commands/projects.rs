use std::collections::BTreeMap;
use std::path::PathBuf;

use tauri::State;

use crate::error::{Error, Result};
use crate::models::{CommandSpec, Project, ProjectScan, ProjectView};
use crate::services::ProjectManager;
use crate::state::AppState;

#[tauri::command]
pub fn list_projects(state: State<'_, AppState>) -> Vec<ProjectView> {
    state
        .projects()
        .into_iter()
        .map(|project| ProjectView {
            branch: ProjectManager::read_branch(&project.path),
            path_exists: project.path.is_dir(),
            project,
        })
        .collect()
}

#[tauri::command]
pub fn scan_project(path: PathBuf) -> Result<ProjectScan> {
    ProjectManager::scan(&path)
}

#[tauri::command]
pub fn add_project(
    state: State<'_, AppState>,
    name: String,
    path: PathBuf,
    repository: Option<String>,
    group: Option<String>,
    commands: BTreeMap<String, CommandSpec>,
) -> Result<Project> {
    if !path.is_dir() {
        return Err(Error::NotADirectory(path.display().to_string()));
    }
    let path = dunce::canonicalize(&path)?;

    state.update_config(|config| {
        let project = Project {
            id: ProjectManager::make_id(&name, &config.projects),
            name,
            path,
            repository: repository.filter(|s| !s.trim().is_empty()),
            group: group.filter(|s| !s.trim().is_empty()),
            commands,
        };
        config.projects.push(project.clone());
        Ok(project)
    })
}

#[tauri::command]
pub fn update_project(
    state: State<'_, AppState>,
    id: String,
    name: String,
    repository: Option<String>,
    group: Option<String>,
    commands: BTreeMap<String, CommandSpec>,
) -> Result<Project> {
    state.update_config(|config| {
        let project = config
            .projects
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| Error::ProjectNotFound(id.clone()))?;
        project.name = name;
        project.repository = repository.filter(|s| !s.trim().is_empty());
        project.group = group.filter(|s| !s.trim().is_empty());
        project.commands = commands;
        Ok(project.clone())
    })
}

#[tauri::command]
pub fn remove_project(state: State<'_, AppState>, id: String) -> Result<()> {
    for run in state.processes.list_runs() {
        if run.project_id == id && !run.status.is_terminal() {
            state.processes.stop(&run.run_id)?;
        }
    }
    state.update_config(|config| {
        let before = config.projects.len();
        config.projects.retain(|p| p.id != id);
        if config.projects.len() == before {
            return Err(Error::ProjectNotFound(id.clone()));
        }
        Ok(())
    })
}

#[tauri::command]
pub fn detect_new_commands(
    state: State<'_, AppState>,
    id: String,
) -> Result<BTreeMap<String, CommandSpec>> {
    let project = state
        .project(&id)
        .ok_or_else(|| Error::ProjectNotFound(id.clone()))?;
    let scan = ProjectManager::scan(&project.path)?;
    Ok(scan
        .commands
        .into_iter()
        .filter(|(name, _)| !project.commands.contains_key(name))
        .collect())
}
