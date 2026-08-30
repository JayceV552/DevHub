use std::collections::{BTreeMap, BTreeSet};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{Error, Result};
use crate::models::ActivityItem;
use crate::services::{
    ClientIdSource, Credential, DeviceLogin, LoginOutcome, RepoRef, TokenStore,
    has_bundled_client_id,
};
use crate::state::AppState;

pub const EVENT_AUTH: &str = "devhub://github-auth";

pub(crate) async fn current_token(state: &AppState) -> Result<String> {
    let store = TokenStore::github();
    let credential = store.get()?.ok_or(Error::NoGitHubToken)?;

    if !credential.is_expired() {
        match state.github.validate_token(credential.token()).await {
            Ok(()) => return Ok(credential.token().to_string()),
            Err(Error::GitHubUnauthorized) if credential.refresh_token().is_some() => {}
            Err(err) => return Err(err),
        }
    }

    let (Some(refresh_token), Some((client_id, _))) =
        (credential.refresh_token(), state.github_client_id())
    else {
        return Err(Error::GitHubUnauthorized);
    };

    let refreshed = state
        .device_flow
        .refresh(&client_id, refresh_token)
        .await
        .map_err(|_| Error::GitHubUnauthorized)?;
    store.set(&refreshed)?;
    state.github.invalidate();
    state
        .github
        .validate_token(refreshed.token())
        .await
        .map_err(|_| Error::GitHubUnauthorized)?;
    Ok(refreshed.token().to_string())
}

#[tauri::command]
pub async fn github_activity(state: State<'_, AppState>, force: bool) -> Result<Vec<ActivityItem>> {
    let token = current_token(&state).await?;
    let columns = state.columns();

    let mut repos = BTreeMap::<String, RepoRef>::new();
    for project in state.projects() {
        let Some(slug) = project.repository.as_deref() else {
            continue;
        };
        if let Some(repo) = RepoRef::parse(slug, Some(project.name)) {
            repos.insert(slug.to_string(), repo);
        }
    }
    for slug in columns
        .iter()
        .cloned()
        .into_iter()
        .flat_map(|column| column.filters.repositories)
    {
        if let Some(repo) = RepoRef::parse(&slug, None) {
            repos.entry(slug).or_insert(repo);
        }
    }
    let repos: Vec<RepoRef> = repos.into_values().collect();

    let users: Vec<String> = columns
        .into_iter()
        .flat_map(|column| column.filters.users)
        .filter(|user| !user.trim().is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    let mut items = if repos.is_empty() {
        Vec::new()
    } else {
        state.github.activity(&token, &repos, force).await?
    };
    if !users.is_empty() {
        items.extend(state.github.user_activity(&token, &users, force).await?);
    }
    items.sort_by_key(|item| std::cmp::Reverse(item.timestamp));
    items.dedup_by(|left, right| left.id == right.id);
    Ok(items)
}

#[tauri::command]
pub async fn github_dashboard(
    state: State<'_, AppState>,
    force: bool,
) -> Result<Vec<ActivityItem>> {
    let token = current_token(&state).await?;
    state.github.dashboard(&token, force).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubStatus {
    pub connected: bool,
    pub method: Option<&'static str>,
    pub has_client_id: bool,
    pub client_id_source: Option<ClientIdSource>,
    pub has_bundled_client_id: bool,
    pub login_pending: bool,
}

#[tauri::command]
pub fn github_status(state: State<'_, AppState>) -> Result<GitHubStatus> {
    let credential = TokenStore::github().get()?;
    let client_id = state.github_client_id();
    Ok(GitHubStatus {
        connected: credential.is_some(),
        method: credential.as_ref().map(|c| match c {
            Credential::Pat { .. } => "pat",
            Credential::OAuth { .. } => "oauth",
        }),
        has_client_id: client_id.is_some(),
        client_id_source: client_id.map(|(_, source)| source),
        has_bundled_client_id: has_bundled_client_id(),
        login_pending: state.device_flow.is_pending(),
    })
}

#[tauri::command]
pub async fn github_start_login(app: AppHandle, state: State<'_, AppState>) -> Result<DeviceLogin> {
    let (client_id, _) = state.github_client_id().ok_or_else(|| {
        Error::Other("no GitHub client ID configured — add one in Settings".into())
    })?;

    let login = state.device_flow.start(&client_id).await?;

    let device_flow = std::sync::Arc::clone(&state.device_flow);
    tauri::async_runtime::spawn(async move {
        let outcome = match device_flow.wait(&client_id).await {
            Ok(credential) => {
                let state = app.state::<AppState>();
                state.github.invalidate();
                match state.github.validate_token(credential.token()).await {
                    Ok(()) => match TokenStore::github().set(&credential) {
                        Ok(()) => LoginOutcome::Authorized,
                        Err(err) => LoginOutcome::Failed {
                            message: err.to_string(),
                        },
                    },
                    Err(err) => LoginOutcome::Failed {
                        message: err.to_string(),
                    },
                }
            }
            Err(Error::GitHub(message)) if message.contains("declined") => LoginOutcome::Denied,
            Err(Error::GitHub(message)) if message.contains("expired") => LoginOutcome::Expired,
            Err(Error::Other(message)) if message.contains("cancelled") => LoginOutcome::Cancelled,
            Err(err) => LoginOutcome::Failed {
                message: err.to_string(),
            },
        };
        let _ = app.emit(EVENT_AUTH, outcome);
    });

    Ok(login)
}

#[tauri::command]
pub fn github_cancel_login(state: State<'_, AppState>) {
    state.device_flow.cancel();
}

#[tauri::command]
pub async fn set_github_token(state: State<'_, AppState>, token: String) -> Result<()> {
    let token = token.trim();
    if token.is_empty() {
        return Err(Error::Other("token is empty".into()));
    }
    state.github.invalidate();
    state.github.validate_token(token).await?;
    TokenStore::github().set(&Credential::Pat {
        token: token.to_string(),
    })?;
    Ok(())
}

#[tauri::command]
pub fn clear_github_token(state: State<'_, AppState>) -> Result<()> {
    TokenStore::github().clear()?;
    state.device_flow.cancel();
    state.github.invalidate();
    Ok(())
}

/// Repositories visible to the signed-in user, used by the New column picker.
#[tauri::command]
pub async fn github_repositories(state: State<'_, AppState>) -> Result<Vec<String>> {
    let token = current_token(&state).await?;
    state.github.repositories(&token).await
}

#[tauri::command]
pub async fn github_search_repositories(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<String>> {
    let token = current_token(&state).await?;
    state.github.search_repositories(&token, &query).await
}
