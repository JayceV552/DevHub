use tauri::State;

use crate::error::{Error, Result};
use crate::models::{ActivityColumn, ActivityItem, ColumnFilters, SavedItem};
use crate::services::default_columns;
use crate::state::AppState;

#[tauri::command]
pub fn list_columns(state: State<'_, AppState>) -> Result<Vec<ActivityColumn>> {
    let existing = state.columns();
    if !existing.is_empty() {
        let repositories: Vec<String> = {
            let mut repos: Vec<String> = state
                .projects()
                .into_iter()
                .filter_map(|project| project.repository)
                .collect();
            repos.sort();
            repos.dedup();
            repos
        };
        let mut migrated = existing.clone();
        migrated.retain(|column| !matches!(column.id.as_str(), "all" | "pull-requests" | "issues"));
        if !migrated.iter().any(|column| column.id == "dashboard") {
            migrated.insert(
                0,
                ActivityColumn {
                    id: "dashboard".into(),
                    title: "Dashboard".into(),
                    filters: ColumnFilters::default(),
                    read_through: None,
                },
            );
        }
        for repository in repositories {
            if !migrated.iter().any(|column| {
                column.filters.repositories.len() == 1
                    && column.filters.repositories[0] == repository
            }) {
                migrated.push(crate::services::activity_store::repository_column(
                    &repository,
                ));
            }
        }
        if migrated
            .iter()
            .map(|column| &column.id)
            .eq(existing.iter().map(|column| &column.id))
        {
            return Ok(existing);
        }
        return state.update_config(|config| {
            config.columns = migrated.clone();
            Ok(migrated)
        });
    }

    let repositories: Vec<String> = {
        let mut repos: Vec<String> = state
            .projects()
            .into_iter()
            .filter_map(|project| project.repository)
            .collect();
        repos.sort();
        repos.dedup();
        repos
    };

    let seeded = default_columns(&repositories);
    state.update_config(|config| {
        config.columns = seeded.clone();
        Ok(())
    })?;
    Ok(seeded)
}

#[tauri::command]
pub fn add_column(
    state: State<'_, AppState>,
    title: String,
    filters: ColumnFilters,
) -> Result<ActivityColumn> {
    state.update_config(|config| {
        let column = ActivityColumn {
            id: uuid::Uuid::new_v4().to_string(),
            title: title.trim().to_string(),
            filters,
            read_through: None,
        };
        config.columns.push(column.clone());
        Ok(column)
    })
}

#[tauri::command]
pub fn update_column(
    state: State<'_, AppState>,
    id: String,
    title: String,
    filters: ColumnFilters,
) -> Result<ActivityColumn> {
    state.update_config(|config| {
        let column = config
            .columns
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| Error::Other(format!("no column with id `{id}`")))?;
        column.title = title.trim().to_string();
        column.filters = filters;
        Ok(column.clone())
    })
}

#[tauri::command]
pub fn remove_column(state: State<'_, AppState>, id: String) -> Result<()> {
    if id == "dashboard" {
        return Err(Error::Other(
            "the Dashboard column cannot be removed".into(),
        ));
    }
    state.update_config(|config| {
        config.columns.retain(|column| column.id != id);
        Ok(())
    })
}

#[tauri::command]
pub fn move_column(
    state: State<'_, AppState>,
    id: String,
    delta: i32,
) -> Result<Vec<ActivityColumn>> {
    state.update_config(|config| {
        let from = config
            .columns
            .iter()
            .position(|column| column.id == id)
            .ok_or_else(|| Error::Other(format!("no column with id `{id}`")))?;

        if id == "dashboard" {
            return Ok(config.columns.clone());
        }
        let to = (from as i32 + delta).clamp(1, config.columns.len() as i32 - 1) as usize;
        if from != to {
            let column = config.columns.remove(from);
            config.columns.insert(to, column);
        }
        Ok(config.columns.clone())
    })
}

#[tauri::command]
pub fn mark_column_read(state: State<'_, AppState>, id: String) -> Result<ActivityColumn> {
    state.update_config(|config| {
        let column = config
            .columns
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| Error::Other(format!("no column with id `{id}`")))?;
        column.read_through = Some(chrono::Utc::now());
        Ok(column.clone())
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoardColumn {
    #[serde(flatten)]
    pub column: ActivityColumn,
    pub items: Vec<ActivityItem>,
    pub unread: usize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub columns: Vec<BoardColumn>,
    pub saved: Vec<String>,
}

#[tauri::command]
pub async fn activity_board(state: State<'_, AppState>, force: bool) -> Result<Board> {
    let items = super::github::github_activity(state.clone(), force).await?;
    let columns = list_columns(state.clone())?;
    let dashboard = if columns.iter().any(|column| column.id == "dashboard") {
        super::github::github_dashboard(state.clone(), force)
            .await
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    Ok(Board {
        columns: columns
            .into_iter()
            .map(|column| {
                let source = if column.id == "dashboard" {
                    &dashboard
                } else {
                    &items
                };
                let matching: Vec<ActivityItem> = source
                    .iter()
                    .filter(|item| column.filters.matches(item))
                    .cloned()
                    .collect();

                let unread = match column.read_through {
                    Some(read_through) => matching
                        .iter()
                        .filter(|item| item.timestamp > read_through)
                        .count(),
                    None => matching.len(),
                };

                BoardColumn {
                    column,
                    items: matching,
                    unread,
                }
            })
            .collect(),
        saved: state
            .activity
            .list()
            .into_iter()
            .map(|s| s.item.id)
            .collect(),
    })
}

#[tauri::command]
pub fn list_saved(state: State<'_, AppState>) -> Vec<SavedItem> {
    state.activity.list()
}

#[tauri::command]
pub fn save_item(state: State<'_, AppState>, item: ActivityItem) -> Result<()> {
    state.activity.save(item)
}

#[tauri::command]
pub fn unsave_item(state: State<'_, AppState>, id: String) -> Result<()> {
    state.activity.unsave(&id)
}
