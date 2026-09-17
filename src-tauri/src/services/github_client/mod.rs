use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde_json::json;

use crate::error::{Error, Result};
use crate::models::{
    ActivityItem, ActivityState, ActivityType, RepositoryIssueGroup, RepositoryIssuePage,
};

pub mod events;
pub mod graphql;
pub mod types;

#[cfg(test)]
mod tests;

pub(crate) use events::event_item;

use self::graphql::{
    build_issue_page_query, build_issue_query, build_query, collect_issue_groups, collect_items,
    graphql_errors, issue_item,
};
use self::types::{
    GraphQlResponse, IssueGraphQlResponse, RepositorySearch, RestEvent, RestUser, ViewerResponse,
};

const GRAPHQL_URL: &str = "https://api.github.com/graphql";
const REST_URL: &str = "https://api.github.com";
const USER_AGENT: &str = "DevHub";
const CACHE_TTL: Duration = Duration::from_secs(120);
const REPOS_PER_QUERY: usize = 8;

pub struct GitHubClient {
    http: reqwest::Client,
    cache: Mutex<Option<CachedFeed>>,
    dashboard_cache: Mutex<Option<CachedDashboard>>,
    user_cache: Mutex<Option<CachedUserFeed>>,
    validated_token: Mutex<Option<ValidatedToken>>,
}

struct ValidatedToken {
    token: String,
    checked_at: Instant,
}

struct CachedDashboard {
    fetched_at: Instant,
    items: Vec<ActivityItem>,
}

struct CachedUserFeed {
    fetched_at: Instant,
    users: Vec<String>,
    items: Vec<ActivityItem>,
}

struct CachedFeed {
    fetched_at: Instant,
    repositories: Vec<String>,
    items: Vec<ActivityItem>,
}

pub struct RepoRef {
    pub owner: String,
    pub name: String,
    pub project_name: Option<String>,
}

impl RepoRef {
    pub fn parse(slug: &str, project_name: Option<String>) -> Option<Self> {
        let (owner, name) = slug.split_once('/')?;
        let (owner, name) = (owner.trim(), name.trim());
        if owner.is_empty() || name.is_empty() || name.contains('/') {
            return None;
        }
        Some(Self {
            owner: owner.to_string(),
            name: name.to_string(),
            project_name,
        })
    }
}

impl GitHubClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .user_agent(USER_AGENT)
                .timeout(Duration::from_secs(20))
                .build()
                .unwrap_or_default(),
            cache: Mutex::new(None),
            dashboard_cache: Mutex::new(None),
            user_cache: Mutex::new(None),
            validated_token: Mutex::new(None),
        }
    }

    pub async fn validate_token(&self, token: &str) -> Result<()> {
        if self
            .validated_token
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|entry| entry.token == token && entry.checked_at.elapsed() < CACHE_TTL)
        {
            return Ok(());
        }

        let response = self
            .http
            .get(format!("{REST_URL}/user"))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|err| Error::GitHub(err.to_string()))?;
        ensure_success(response).await?;

        *self.validated_token.lock().unwrap() = Some(ValidatedToken {
            token: token.to_string(),
            checked_at: Instant::now(),
        });
        Ok(())
    }

    pub async fn activity(
        &self,
        token: &str,
        repos: &[RepoRef],
        force: bool,
    ) -> Result<Vec<ActivityItem>> {
        let repository_keys: Vec<String> = repos
            .iter()
            .map(|repo| format!("{}/{}", repo.owner, repo.name))
            .collect();
        if !force
            && let Some(cached) = self.cache.lock().unwrap().as_ref()
            && cached.fetched_at.elapsed() < CACHE_TTL
            && cached.repositories == repository_keys
        {
            return Ok(cached.items.clone());
        }

        let mut items = Vec::new();
        for chunk in repos.chunks(REPOS_PER_QUERY) {
            items.extend(self.fetch_chunk(token, chunk).await?);
        }

        items.sort_by_key(|item| std::cmp::Reverse(item.timestamp));

        *self.cache.lock().unwrap() = Some(CachedFeed {
            fetched_at: Instant::now(),
            repositories: repository_keys,
            items: items.clone(),
        });
        Ok(items)
    }

    pub async fn issue_groups(
        &self,
        token: &str,
        repos: &[RepoRef],
    ) -> Result<Vec<RepositoryIssueGroup>> {
        let mut groups = Vec::new();
        for chunk in repos.chunks(REPOS_PER_QUERY) {
            let response = self
                .http
                .post(GRAPHQL_URL)
                .bearer_auth(token)
                .json(&json!({ "query": build_issue_query(chunk) }))
                .send()
                .await
                .map_err(|error| Error::GitHub(error.to_string()))?;
            let response = ensure_success(response).await?;
            let body: IssueGraphQlResponse = response
                .json()
                .await
                .map_err(|error| Error::GitHub(format!("unexpected response: {error}")))?;
            let Some(data) = body.data else {
                let message = body
                    .errors
                    .unwrap_or_default()
                    .into_iter()
                    .map(|error| error.message)
                    .collect::<Vec<_>>()
                    .join("; ");
                return Err(Error::GitHub(if message.is_empty() {
                    "empty response".into()
                } else {
                    message
                }));
            };
            groups.extend(collect_issue_groups(data, chunk));
        }
        Ok(groups)
    }

    pub async fn issue_page(
        &self,
        token: &str,
        repo: &RepoRef,
        cursor: Option<&str>,
    ) -> Result<RepositoryIssuePage> {
        let response = self
            .http
            .post(GRAPHQL_URL)
            .bearer_auth(token)
            .json(&json!({ "query": build_issue_page_query(repo, cursor) }))
            .send()
            .await
            .map_err(|error| Error::GitHub(error.to_string()))?;
        let response = ensure_success(response).await?;
        let body: IssueGraphQlResponse = response
            .json()
            .await
            .map_err(|error| Error::GitHub(format!("unexpected response: {error}")))?;
        let Some(mut data) = body.data else {
            return Err(graphql_errors(body.errors));
        };
        let Some(repository) = data.remove("r0").flatten() else {
            return Err(Error::GitHub(format!(
                "repository {}/{} is unavailable",
                repo.owner, repo.name
            )));
        };
        let issues = repository
            .issues
            .nodes
            .iter()
            .map(|issue| issue_item(&repository.name_with_owner, repo, issue))
            .collect();
        Ok(RepositoryIssuePage {
            repository: repository.name_with_owner,
            total_count: repository.issues.total_count,
            issues,
            end_cursor: repository.issues.page_info.end_cursor,
            has_next_page: repository.issues.page_info.has_next_page,
        })
    }

    pub async fn repositories(&self, token: &str) -> Result<Vec<String>> {
        let query = r#"query {
  viewer {
    repositories(
      first: 100
      affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER]
      orderBy: {field: PUSHED_AT, direction: DESC}
    ) {
      nodes { nameWithOwner isArchived }
    }
  }
}"#;

        let response = self
            .http
            .post(GRAPHQL_URL)
            .bearer_auth(token)
            .json(&json!({ "query": query }))
            .send()
            .await
            .map_err(|err| Error::GitHub(err.to_string()))?;
        let response = ensure_success(response).await?;

        let body: ViewerResponse = response
            .json()
            .await
            .map_err(|err| Error::GitHub(format!("unexpected response: {err}")))?;
        let Some(data) = body.data else {
            let message = body
                .errors
                .unwrap_or_default()
                .into_iter()
                .map(|error| error.message)
                .collect::<Vec<_>>()
                .join("; ");
            return Err(Error::GitHub(if message.is_empty() {
                "empty response".into()
            } else {
                message
            }));
        };

        let mut repositories: Vec<String> = data
            .viewer
            .repositories
            .nodes
            .into_iter()
            .filter(|repo| !repo.is_archived)
            .map(|repo| repo.name_with_owner)
            .collect();
        repositories.sort_by_key(|name| name.to_lowercase());
        repositories.dedup();
        Ok(repositories)
    }

    pub async fn search_repositories(&self, token: &str, query: &str) -> Result<Vec<String>> {
        let query = query.trim();
        if query.is_empty() {
            return self.repositories(token).await;
        }
        let mut url = reqwest::Url::parse(&format!("{REST_URL}/search/repositories"))
            .map_err(|err| Error::GitHub(err.to_string()))?;
        url.query_pairs_mut()
            .append_pair("q", query)
            .append_pair("per_page", "30");
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|err| Error::GitHub(err.to_string()))?;
        let response = ensure_success(response).await?;
        let body: RepositorySearch = response
            .json()
            .await
            .map_err(|err| Error::GitHub(format!("unexpected response: {err}")))?;
        Ok(body.items.into_iter().map(|repo| repo.full_name).collect())
    }

    pub async fn dashboard(&self, token: &str, force: bool) -> Result<Vec<ActivityItem>> {
        if !force
            && let Some(cached) = self.dashboard_cache.lock().unwrap().as_ref()
            && cached.fetched_at.elapsed() < CACHE_TTL
        {
            return Ok(cached.items.clone());
        }

        let viewer_response = self
            .http
            .get(format!("{REST_URL}/user"))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|err| Error::GitHub(err.to_string()))?;
        let viewer_response = ensure_success(viewer_response).await?;
        let viewer: RestUser = viewer_response
            .json()
            .await
            .map_err(|err| Error::GitHub(format!("unexpected response: {err}")))?;

        let mut url = reqwest::Url::parse(&format!(
            "{REST_URL}/users/{}/received_events",
            viewer.login
        ))
        .map_err(|err| Error::GitHub(err.to_string()))?;
        url.query_pairs_mut().append_pair("per_page", "100");
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|err| Error::GitHub(err.to_string()))?;
        let response = ensure_success(response).await?;
        let events: Vec<RestEvent> = response
            .json()
            .await
            .map_err(|err| Error::GitHub(format!("unexpected response: {err}")))?;

        let mut items: Vec<ActivityItem> = events.into_iter().filter_map(event_item).collect();
        if let Ok(stars) = self.recent_repository_stars(token).await {
            for star in stars {
                if !items.iter().any(|item| {
                    item.activity_type == ActivityType::Star
                        && item.repository == star.repository
                        && item.actor == star.actor
                }) {
                    items.push(star);
                }
            }
        }
        items.sort_by_key(|item| std::cmp::Reverse(item.timestamp));
        *self.dashboard_cache.lock().unwrap() = Some(CachedDashboard {
            fetched_at: Instant::now(),
            items: items.clone(),
        });
        Ok(items)
    }

    /// Public activity performed by specific GitHub users. The Events API is
    /// the only GitHub API that exposes WatchEvent (star) and PublicEvent in a
    /// single chronological feed alongside pushes and issue/PR activity.
    pub async fn user_activity(
        &self,
        token: &str,
        users: &[String],
        force: bool,
    ) -> Result<Vec<ActivityItem>> {
        let mut cache_key: Vec<String> = users
            .iter()
            .map(|user| user.trim().to_ascii_lowercase())
            .filter(|user| !user.is_empty())
            .collect();
        cache_key.sort();
        cache_key.dedup();

        if !force
            && let Some(cached) = self.user_cache.lock().unwrap().as_ref()
            && cached.fetched_at.elapsed() < CACHE_TTL
            && cached.users == cache_key
        {
            return Ok(cached.items.clone());
        }

        let mut items = Vec::new();
        for user in &cache_key {
            let mut url =
                reqwest::Url::parse(REST_URL).map_err(|err| Error::GitHub(err.to_string()))?;
            url.path_segments_mut()
                .map_err(|_| Error::GitHub("invalid GitHub API URL".into()))?
                .extend(["users", user, "events", "public"]);
            url.query_pairs_mut().append_pair("per_page", "100");
            let response = self
                .http
                .get(url)
                .bearer_auth(token)
                .header("Accept", "application/vnd.github+json")
                .send()
                .await
                .map_err(|err| Error::GitHub(err.to_string()))?;
            let response = ensure_success(response).await?;
            let events: Vec<RestEvent> = response
                .json()
                .await
                .map_err(|err| Error::GitHub(format!("unexpected response: {err}")))?;
            items.extend(events.into_iter().filter_map(event_item));
        }

        items.sort_by_key(|item| std::cmp::Reverse(item.timestamp));
        items.dedup_by(|left, right| left.id == right.id);
        *self.user_cache.lock().unwrap() = Some(CachedUserFeed {
            fetched_at: Instant::now(),
            users: cache_key,
            items: items.clone(),
        });
        Ok(items)
    }

    async fn recent_repository_stars(&self, token: &str) -> Result<Vec<ActivityItem>> {
        let query = r#"query {
  viewer {
    repositories(first: 100, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: {field: PUSHED_AT, direction: DESC}) {
      nodes {
        nameWithOwner
        stargazers(first: 5, orderBy: {field: STARRED_AT, direction: DESC}) {
          edges { starredAt node { login avatarUrl } }
        }
      }
    }
  }
}"#;
        let response = self
            .http
            .post(GRAPHQL_URL)
            .bearer_auth(token)
            .json(&json!({ "query": query }))
            .send()
            .await
            .map_err(|err| Error::GitHub(err.to_string()))?;
        let response = ensure_success(response).await?;
        let value: serde_json::Value = response
            .json()
            .await
            .map_err(|err| Error::GitHub(format!("unexpected response: {err}")))?;
        let nodes = value
            .pointer("/data/viewer/repositories/nodes")
            .and_then(serde_json::Value::as_array)
            .ok_or_else(|| Error::GitHub("could not load recent repository stars".into()))?;
        let mut items = Vec::new();
        for repo in nodes {
            let Some(repository) = repo
                .get("nameWithOwner")
                .and_then(serde_json::Value::as_str)
            else {
                continue;
            };
            let Some(edges) = repo
                .pointer("/stargazers/edges")
                .and_then(serde_json::Value::as_array)
            else {
                continue;
            };
            for edge in edges {
                let (Some(timestamp), Some(login)) = (
                    edge.get("starredAt")
                        .and_then(serde_json::Value::as_str)
                        .and_then(|value| value.parse::<DateTime<Utc>>().ok()),
                    edge.pointer("/node/login")
                        .and_then(serde_json::Value::as_str),
                ) else {
                    continue;
                };
                items.push(ActivityItem {
                    id: format!("star#{repository}#{login}#{timestamp}"),
                    repository: repository.to_string(),
                    project_name: None,
                    activity_type: ActivityType::Star,
                    state: ActivityState::Published,
                    number: None,
                    title: "starred this repository".into(),
                    url: format!("https://github.com/{repository}/stargazers"),
                    actor: Some(login.to_string()),
                    actor_avatar: edge
                        .pointer("/node/avatarUrl")
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string),
                    timestamp,
                    comment_count: None,
                    body: None,
                    labels: Vec::new(),
                    additions: None,
                    deletions: None,
                    changed_files: None,
                    review_decision: None,
                    action: Some("starred your repository".into()),
                });
            }
        }
        Ok(items)
    }

    pub fn invalidate(&self) {
        *self.cache.lock().unwrap() = None;
        *self.dashboard_cache.lock().unwrap() = None;
        *self.user_cache.lock().unwrap() = None;
        *self.validated_token.lock().unwrap() = None;
    }

    async fn fetch_chunk(&self, token: &str, repos: &[RepoRef]) -> Result<Vec<ActivityItem>> {
        let query = build_query(repos);

        let response = self
            .http
            .post(GRAPHQL_URL)
            .bearer_auth(token)
            .json(&json!({ "query": query }))
            .send()
            .await
            .map_err(|err| Error::GitHub(err.to_string()))?;
        let response = ensure_success(response).await?;

        let body: GraphQlResponse = response
            .json()
            .await
            .map_err(|err| Error::GitHub(format!("unexpected response: {err}")))?;

        let Some(data) = body.data else {
            let message = body
                .errors
                .unwrap_or_default()
                .into_iter()
                .map(|e| e.message)
                .collect::<Vec<_>>()
                .join("; ");
            return Err(Error::GitHub(if message.is_empty() {
                "empty response".to_string()
            } else {
                message
            }));
        };

        Ok(collect_items(data, repos))
    }
}

impl Default for GitHubClient {
    fn default() -> Self {
        Self::new()
    }
}

async fn ensure_success(response: reqwest::Response) -> Result<reqwest::Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err(Error::GitHubUnauthorized);
    }

    let accepted_permissions = response
        .headers()
        .get("x-accepted-github-permissions")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.text().await.unwrap_or_default();
    let message = serde_json::from_str::<serde_json::Value>(&body)
        .ok()
        .and_then(|value| value.get("message")?.as_str().map(str::to_string))
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| format!("HTTP {status}"));

    if status == reqwest::StatusCode::FORBIDDEN {
        let permissions = accepted_permissions
            .filter(|value| !value.is_empty())
            .map(|value| format!(" Required GitHub App permissions: {value}."))
            .unwrap_or_default();
        return Err(Error::GitHub(format!(
            "GitHub denied access: {message}.{permissions} Check the app's permissions and repository installation."
        )));
    }
    Err(Error::GitHub(format!(
        "GitHub returned {status}: {message}"
    )))
}

