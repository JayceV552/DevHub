use std::collections::HashSet;

use chrono::Utc;
use tauri::State;

use crate::error::{Error, Result};
use crate::models::{RepositoryIssueGroup, RepositoryIssuePage, TodoItem, TodoStep};
use crate::services::{Config, RepoRef};
use crate::state::AppState;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoBoard {
    pub repositories: Vec<String>,
    pub todos: Vec<TodoItem>,
    pub issue_groups: Vec<RepositoryIssueGroup>,
    pub issue_error: Option<String>,
}

#[tauri::command]
pub async fn todo_board(state: State<'_, AppState>) -> Result<TodoBoard> {
    let config = state.todo_board();
    let refs: Vec<RepoRef> = config
        .repositories
        .iter()
        .filter_map(|slug| RepoRef::parse(slug, None))
        .collect();

    let (issue_groups, issue_error) = if refs.is_empty() {
        (Vec::new(), None)
    } else {
        match super::github::current_token(&state).await {
            Ok(token) => match state.github.issue_groups(&token, &refs).await {
                Ok(groups) => (groups, None),
                Err(error) => (Vec::new(), Some(error.to_string())),
            },
            Err(error) => (Vec::new(), Some(error.to_string())),
        }
    };

    Ok(TodoBoard {
        repositories: config.repositories,
        todos: config.todos,
        issue_groups,
        issue_error,
    })
}

#[tauri::command]
pub async fn todo_repository_issues(
    state: State<'_, AppState>,
    repository: String,
    cursor: Option<String>,
) -> Result<RepositoryIssuePage> {
    let repo = RepoRef::parse(&repository, None)
        .ok_or_else(|| Error::Other("Repository must use owner/name format.".into()))?;
    let token = super::github::current_token(&state).await?;
    state
        .github
        .issue_page(&token, &repo, cursor.as_deref())
        .await
}

#[tauri::command]
pub fn set_todo_repositories(
    state: State<'_, AppState>,
    repositories: Vec<String>,
) -> Result<Vec<String>> {
    let mut seen = HashSet::new();
    let repositories: Vec<String> = repositories
        .into_iter()
        .filter_map(|slug| normalize_repository(&slug))
        .filter(|slug| seen.insert(slug.to_ascii_lowercase()))
        .take(12)
        .collect();

    state.update_config(|config| {
        config.todo_board.repositories = repositories.clone();
        Ok(repositories)
    })
}

/// A checklist row as it arrives from the UI: rows the user just typed have no
/// id yet, rows that already exist carry theirs so toggles survive an edit.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoStepInput {
    #[serde(default)]
    pub id: Option<String>,
    pub text: String,
    #[serde(default)]
    pub done: bool,
}

const MAX_STEPS: usize = 50;

fn normalize_steps(steps: Vec<TodoStepInput>) -> Vec<TodoStep> {
    steps
        .into_iter()
        .filter_map(|step| {
            let text = step.text.trim();
            if text.is_empty() {
                return None;
            }
            Some(TodoStep {
                id: step
                    .id
                    .filter(|id| !id.is_empty())
                    .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
                text: text.to_string(),
                done: step.done,
            })
        })
        .take(MAX_STEPS)
        .collect()
}

fn find_todo<'a>(config: &'a mut Config, id: &str) -> Result<&'a mut TodoItem> {
    config
        .todo_board
        .todos
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| Error::Other("Todo no longer exists.".into()))
}

#[tauri::command]
pub fn add_todo(
    state: State<'_, AppState>,
    title: String,
    steps: Option<Vec<TodoStepInput>>,
) -> Result<TodoItem> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Other("Todo title is required.".into()));
    }
    let mut item = TodoItem {
        id: uuid::Uuid::new_v4().to_string(),
        title: title.to_string(),
        steps: normalize_steps(steps.unwrap_or_default()),
        completed: false,
        created_at: Utc::now(),
    };
    item.sync_completion();
    state.update_config(|config| {
        config.todo_board.todos.insert(0, item.clone());
        Ok(item)
    })
}

#[tauri::command]
pub fn update_todo(
    state: State<'_, AppState>,
    id: String,
    title: String,
    steps: Option<Vec<TodoStepInput>>,
) -> Result<TodoItem> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Other("Todo title is required.".into()));
    }
    state.update_config(|config| {
        let item = find_todo(config, &id)?;
        item.title = title.to_string();
        if let Some(steps) = steps {
            item.steps = normalize_steps(steps);
        }
        item.sync_completion();
        Ok(item.clone())
    })
}

#[tauri::command]
pub fn set_todo_step(
    state: State<'_, AppState>,
    id: String,
    step_id: String,
    done: bool,
) -> Result<TodoItem> {
    state.update_config(|config| {
        let item = find_todo(config, &id)?;
        let step = item
            .steps
            .iter_mut()
            .find(|step| step.id == step_id)
            .ok_or_else(|| Error::Other("Checklist item no longer exists.".into()))?;
        step.done = done;
        item.sync_completion();
        Ok(item.clone())
    })
}

#[tauri::command]
pub fn set_todo_completed(
    state: State<'_, AppState>,
    id: String,
    completed: bool,
) -> Result<TodoItem> {
    state.update_config(|config| {
        let item = find_todo(config, &id)?;
        // Ticking the card ticks the whole checklist with it; clearing it only
        // reopens the todo, so a half-finished list is not silently wiped.
        if completed {
            for step in &mut item.steps {
                step.done = true;
            }
        }
        item.completed = completed;
        Ok(item.clone())
    })
}

#[tauri::command]
pub fn delete_todo(state: State<'_, AppState>, id: String) -> Result<()> {
    state.update_config(|config| {
        config.todo_board.todos.retain(|item| item.id != id);
        Ok(())
    })
}

fn normalize_repository(input: &str) -> Option<String> {
    let trimmed = input.trim().trim_end_matches('/').trim_end_matches(".git");
    let slug = trimmed
        .strip_prefix("https://github.com/")
        .or_else(|| trimmed.strip_prefix("http://github.com/"))
        .unwrap_or(trimmed);
    let mut parts = slug.split('/');
    let owner = parts.next()?.trim();
    let name = parts.next()?.trim();
    if owner.is_empty() || name.is_empty() || parts.next().is_some() {
        return None;
    }
    Some(format!("{owner}/{name}"))
}

#[cfg(test)]
mod tests {
    use super::{TodoStepInput, normalize_repository, normalize_steps};
    use crate::models::{TodoItem, TodoStep};
    use chrono::Utc;

    fn input(id: Option<&str>, text: &str, done: bool) -> TodoStepInput {
        TodoStepInput {
            id: id.map(str::to_string),
            text: text.into(),
            done,
        }
    }

    fn todo(steps: Vec<TodoStep>) -> TodoItem {
        TodoItem {
            id: "todo".into(),
            title: "Ship it".into(),
            steps,
            completed: false,
            created_at: Utc::now(),
        }
    }

    #[test]
    fn steps_keep_their_id_and_blank_rows_are_dropped() {
        let steps = normalize_steps(vec![
            input(Some("kept"), "  write the parser  ", true),
            input(None, "wire the command", false),
            input(Some("blank"), "   ", false),
        ]);

        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0].id, "kept");
        assert_eq!(steps[0].text, "write the parser");
        assert!(steps[0].done);
        assert!(!steps[1].id.is_empty());
        assert_ne!(steps[1].id, "kept");
    }

    #[test]
    fn completion_follows_the_checklist_when_one_exists() {
        let mut item = todo(normalize_steps(vec![
            input(None, "one", true),
            input(None, "two", false),
        ]));
        item.completed = true;
        item.sync_completion();
        assert!(!item.completed, "an open step reopens the todo");

        item.steps[1].done = true;
        item.sync_completion();
        assert!(item.completed, "every step done completes the todo");
    }

    #[test]
    fn completion_is_left_alone_without_a_checklist() {
        let mut item = todo(Vec::new());
        item.completed = true;
        item.sync_completion();
        assert!(item.completed);
    }

    #[test]
    fn repository_names_and_urls_are_normalized() {
        assert_eq!(
            normalize_repository("owner/repo"),
            Some("owner/repo".into())
        );
        assert_eq!(
            normalize_repository("https://github.com/owner/repo.git/"),
            Some("owner/repo".into())
        );
        assert_eq!(normalize_repository("owner"), None);
        assert_eq!(normalize_repository("owner/repo/extra"), None);
    }
}
