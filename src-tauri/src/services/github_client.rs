use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::json;

use crate::error::{Error, Result};
use crate::models::{
    ActivityItem, ActivityLabel, ActivityState, ActivityType, RepositoryIssueGroup,
    RepositoryIssuePage,
};

const GRAPHQL_URL: &str = "https://api.github.com/graphql";
const REST_URL: &str = "https://api.github.com";
const USER_AGENT: &str = "DevHub";
const CACHE_TTL: Duration = Duration::from_secs(120);
const PER_KIND: usize = 10;
const TODO_ISSUES_PER_REPO: usize = 6;
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

fn graphql_errors(errors: Option<Vec<GraphQlError>>) -> Error {
    let message = errors
        .unwrap_or_default()
        .into_iter()
        .map(|error| error.message)
        .collect::<Vec<_>>()
        .join("; ");
    Error::GitHub(if message.is_empty() {
        "empty response".into()
    } else {
        message
    })
}

fn event_item(event: RestEvent) -> Option<ActivityItem> {
    let repository = event.repo.name;
    let repo_url = format!("https://github.com/{repository}");
    let actor = Some(event.actor.login);
    let actor_avatar = Some(event.actor.avatar_url);
    let payload = event.payload;
    let raw_action = payload
        .get("action")
        .and_then(serde_json::Value::as_str)
        .map(str::to_string);
    let repository_name = repository.rsplit('/').next().unwrap_or(&repository);
    let empty_labels = || Vec::<ActivityLabel>::new();

    let (activity_type, state, number, title, url, body, labels, action) = match event.kind.as_str()
    {
        "PushEvent" => {
            let commit = payload
                .get("commits")
                .and_then(serde_json::Value::as_array)
                .and_then(|items| items.last());
            let message = commit
                .and_then(|item| item.get("message"))
                .and_then(serde_json::Value::as_str);
            let count = payload
                .get("size")
                .and_then(serde_json::Value::as_i64)
                .unwrap_or(1);
            let branch = payload
                .get("ref")
                .and_then(serde_json::Value::as_str)
                .and_then(|value| value.rsplit('/').next())
                .unwrap_or("default branch");
            (
                ActivityType::Commit,
                ActivityState::Published,
                None,
                message.map(str::to_string).unwrap_or_else(|| {
                    format!(
                        "pushed {count} commit{} to {branch}",
                        if count == 1 { "" } else { "s" }
                    )
                }),
                format!("{repo_url}/commits/{branch}"),
                None,
                empty_labels(),
                Some("pushed a commit".into()),
            )
        }
        "WatchEvent" => (
            ActivityType::Star,
            ActivityState::Published,
            None,
            repository_name.to_string(),
            repo_url.clone(),
            None,
            empty_labels(),
            Some("starred this repository".into()),
        ),
        "PublicEvent" => (
            ActivityType::Publish,
            ActivityState::Published,
            None,
            repository_name.to_string(),
            repo_url.clone(),
            None,
            empty_labels(),
            Some("made this repository public".into()),
        ),
        "ForkEvent" => {
            let fork = payload.get("forkee");
            let name = fork
                .and_then(|value| value.get("full_name"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("a new fork");
            let url = fork
                .and_then(|value| value.get("html_url"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&repo_url)
                .to_string();
            (
                ActivityType::Fork,
                ActivityState::Published,
                None,
                format!("forked to {name}"),
                url,
                None,
                empty_labels(),
                Some("forked this repository".into()),
            )
        }
        "PullRequestEvent" | "PullRequestReviewEvent" | "PullRequestReviewCommentEvent" => {
            let pr = payload.get("pull_request")?;
            let merged = pr
                .get("merged")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            let closed = pr.get("state").and_then(serde_json::Value::as_str) == Some("closed");
            (
                ActivityType::PullRequest,
                if merged {
                    ActivityState::Merged
                } else if closed {
                    ActivityState::Closed
                } else {
                    ActivityState::Open
                },
                pr.get("number").and_then(serde_json::Value::as_i64),
                pr.get("title")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Pull request activity")
                    .to_string(),
                pr.get("html_url")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&repo_url)
                    .to_string(),
                pr.get("body")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                json_labels(pr.get("labels")),
                Some(if merged {
                    "merged a pull request".into()
                } else {
                    match raw_action.as_deref() {
                        Some("opened") => "opened a pull request".into(),
                        Some("closed") => "closed a pull request".into(),
                        _ => "updated a pull request".into(),
                    }
                }),
            )
        }
        "IssuesEvent" | "IssueCommentEvent" => {
            let issue = payload.get("issue")?;
            let comment = payload.get("comment");
            let is_pr = issue.get("pull_request").is_some();
            (
                if is_pr {
                    ActivityType::PullRequest
                } else {
                    ActivityType::Issue
                },
                if issue.get("state").and_then(serde_json::Value::as_str) == Some("closed") {
                    ActivityState::Closed
                } else {
                    ActivityState::Open
                },
                issue.get("number").and_then(serde_json::Value::as_i64),
                issue
                    .get("title")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Issue activity")
                    .to_string(),
                comment
                    .and_then(|value| value.get("html_url"))
                    .or_else(|| issue.get("html_url"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&repo_url)
                    .to_string(),
                comment
                    .and_then(|value| value.get("body"))
                    .or_else(|| issue.get("body"))
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                json_labels(issue.get("labels")),
                Some(if event.kind == "IssueCommentEvent" {
                    if is_pr {
                        "commented on a pull request".into()
                    } else {
                        "commented on an issue".into()
                    }
                } else {
                    match raw_action.as_deref() {
                        Some("opened") => "opened an issue".into(),
                        Some("closed") => "closed an issue".into(),
                        _ => "updated an issue".into(),
                    }
                }),
            )
        }
        "DiscussionEvent" | "DiscussionCommentEvent" => {
            let discussion = payload.get("discussion")?;
            (
                ActivityType::Discussion,
                ActivityState::Open,
                discussion.get("number").and_then(serde_json::Value::as_i64),
                discussion
                    .get("title")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Discussion activity")
                    .to_string(),
                discussion
                    .get("html_url")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&repo_url)
                    .to_string(),
                discussion
                    .get("body")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                empty_labels(),
                Some(if event.kind == "DiscussionCommentEvent" {
                    "commented on a discussion".into()
                } else {
                    "updated a discussion".into()
                }),
            )
        }
        "ReleaseEvent" => {
            let release = payload.get("release")?;
            (
                ActivityType::Release,
                ActivityState::Published,
                None,
                release
                    .get("name")
                    .or_else(|| release.get("tag_name"))
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("New release")
                    .to_string(),
                release
                    .get("html_url")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&repo_url)
                    .to_string(),
                release
                    .get("body")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
                empty_labels(),
                Some("published a release".into()),
            )
        }
        "CreateEvent" | "DeleteEvent" => {
            let reference = payload
                .get("ref")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("repository");
            let ref_type = payload
                .get("ref_type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("ref");
            (
                ActivityType::Commit,
                ActivityState::Published,
                None,
                format!(
                    "{} {ref_type} {reference}",
                    raw_action.as_deref().unwrap_or("updated")
                ),
                repo_url.clone(),
                None,
                empty_labels(),
                Some(format!(
                    "{} a {ref_type}",
                    raw_action.as_deref().unwrap_or("updated")
                )),
            )
        }
        _ => return None,
    };

    Some(ActivityItem {
        id: format!("dashboard#{}", event.id),
        repository,
        project_name: None,
        activity_type,
        state,
        number,
        title,
        url,
        actor,
        actor_avatar,
        timestamp: event.created_at,
        comment_count: payload
            .pointer("/pull_request/comments")
            .or_else(|| payload.pointer("/issue/comments"))
            .and_then(serde_json::Value::as_i64),
        body,
        labels,
        additions: None,
        deletions: None,
        changed_files: None,
        review_decision: None,
        action,
    })
}

fn json_labels(value: Option<&serde_json::Value>) -> Vec<ActivityLabel> {
    value
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|label| {
            Some(ActivityLabel {
                name: label.get("name")?.as_str()?.to_string(),
                color: label
                    .get("color")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("6e7681")
                    .to_string(),
            })
        })
        .collect()
}

fn build_query(repos: &[RepoRef]) -> String {
    let blocks: Vec<String> = repos
        .iter()
        .enumerate()
        .map(|(index, repo)| {
            format!(
                r#"  r{index}: repository(owner: {owner}, name: {name}) {{
    nameWithOwner
    pullRequests(first: {n}, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{
      nodes {{ number title bodyText url state updatedAt mergedAt additions deletions changedFiles reviewDecision labels(first: 10) {{ nodes {{ name color }} }} comments {{ totalCount }} author {{ login avatarUrl }} }}
    }}
    openIssues: issues(first: {n}, states: OPEN, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{
      nodes {{ number title bodyText url state updatedAt labels(first: 10) {{ nodes {{ name color }} }} comments {{ totalCount }} author {{ login avatarUrl }} }}
    }}
    closedIssues: issues(first: {n}, states: CLOSED, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{
      nodes {{ number title bodyText url state updatedAt labels(first: 10) {{ nodes {{ name color }} }} comments {{ totalCount }} author {{ login avatarUrl }} }}
    }}
    discussions(first: {n}, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{
      nodes {{ number title bodyText url updatedAt category {{ name }} comments {{ totalCount }} author {{ login avatarUrl }} }}
    }}
    defaultBranchRef {{
      target {{
        ... on Commit {{
          history(first: {n}) {{
            nodes {{ oid messageHeadline messageBody url committedDate author {{ user {{ login avatarUrl }} }} }}
          }}
        }}
      }}
    }}
    releases(first: 5, orderBy: {{field: CREATED_AT, direction: DESC}}) {{
      nodes {{ name tagName description url publishedAt author {{ login avatarUrl }} }}
    }}
  }}"#,
                index = index,
                owner = serde_json::Value::String(repo.owner.clone()),
                name = serde_json::Value::String(repo.name.clone()),
                n = PER_KIND,
            )
        })
        .collect();

    format!("query {{\n{}\n}}", blocks.join("\n"))
}

fn build_issue_query(repos: &[RepoRef]) -> String {
    let blocks: Vec<String> = repos
        .iter()
        .enumerate()
        .map(|(index, repo)| {
            format!(
                r#"  r{index}: repository(owner: {owner}, name: {name}) {{
    nameWithOwner
    issues(first: {count}, states: OPEN, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{
      totalCount
      pageInfo {{ endCursor hasNextPage }}
      nodes {{ number title bodyText url state updatedAt labels(first: 6) {{ nodes {{ name color }} }} comments {{ totalCount }} author {{ login avatarUrl }} }}
    }}
  }}"#,
                owner = serde_json::Value::String(repo.owner.clone()),
                name = serde_json::Value::String(repo.name.clone()),
                count = TODO_ISSUES_PER_REPO,
            )
        })
        .collect();
    format!("query {{\n{}\n}}", blocks.join("\n"))
}

fn build_issue_page_query(repo: &RepoRef, cursor: Option<&str>) -> String {
    let after = cursor
        .map(|value| format!(", after: {}", serde_json::Value::String(value.to_string())))
        .unwrap_or_default();
    format!(
        r#"query {{
  r0: repository(owner: {owner}, name: {name}) {{
    nameWithOwner
    issues(first: 30{after}, states: OPEN, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{
      totalCount
      pageInfo {{ endCursor hasNextPage }}
      nodes {{ number title bodyText url state updatedAt labels(first: 6) {{ nodes {{ name color }} }} comments {{ totalCount }} author {{ login avatarUrl }} }}
    }}
  }}
}}"#,
        owner = serde_json::Value::String(repo.owner.clone()),
        name = serde_json::Value::String(repo.name.clone()),
    )
}

fn collect_issue_groups(
    data: HashMap<String, Option<IssueRepository>>,
    repos: &[RepoRef],
) -> Vec<RepositoryIssueGroup> {
    let mut groups = Vec::new();
    for (index, repo_ref) in repos.iter().enumerate() {
        let Some(Some(repository)) = data.get(&format!("r{index}")) else {
            continue;
        };
        groups.push(RepositoryIssueGroup {
            repository: repository.name_with_owner.clone(),
            total_count: repository.issues.total_count,
            issues: repository
                .issues
                .nodes
                .iter()
                .map(|issue| issue_item(&repository.name_with_owner, repo_ref, issue))
                .collect(),
            end_cursor: repository.issues.page_info.end_cursor.clone(),
            has_next_page: repository.issues.page_info.has_next_page,
        });
    }
    groups
}

fn issue_item(repository: &str, repo_ref: &RepoRef, issue: &Issue) -> ActivityItem {
    ActivityItem {
        id: format!("{repository}#issue{}", issue.number),
        repository: repository.to_string(),
        project_name: repo_ref.project_name.clone(),
        activity_type: ActivityType::Issue,
        state: ActivityState::Open,
        number: Some(issue.number),
        title: issue.title.clone(),
        url: issue.url.clone(),
        actor: issue.author.as_ref().map(|author| author.login.clone()),
        actor_avatar: issue
            .author
            .as_ref()
            .and_then(|author| author.avatar_url.clone()),
        timestamp: issue.updated_at,
        comment_count: issue.comments.as_ref().map(|comments| comments.total_count),
        body: issue
            .body_text
            .clone()
            .filter(|body| !body.trim().is_empty()),
        labels: issue.labels.as_ref().map(label_nodes).unwrap_or_default(),
        additions: None,
        deletions: None,
        changed_files: None,
        review_decision: None,
        action: Some("updated an issue".into()),
    }
}

fn collect_items(
    data: HashMap<String, Option<Repository>>,
    repos: &[RepoRef],
) -> Vec<ActivityItem> {
    let mut items = Vec::new();

    for (index, repo_ref) in repos.iter().enumerate() {
        let Some(Some(repo)) = data.get(&format!("r{index}")) else {
            continue;
        };
        let slug = repo.name_with_owner.clone();
        let project = repo_ref.project_name.clone();

        if let Some(branch) = &repo.default_branch_ref {
            for commit in &branch.target.history.nodes {
                items.push(ActivityItem {
                    id: format!("{slug}#commit{}", commit.oid),
                    repository: slug.clone(),
                    project_name: project.clone(),
                    activity_type: ActivityType::Commit,
                    state: ActivityState::Published,
                    number: None,
                    title: commit.message_headline.clone(),
                    url: commit.url.clone(),
                    actor: commit
                        .author
                        .as_ref()
                        .and_then(|author| author.user.as_ref())
                        .map(|user| user.login.clone()),
                    actor_avatar: commit
                        .author
                        .as_ref()
                        .and_then(|author| author.user.as_ref())
                        .and_then(|user| user.avatar_url.clone()),
                    timestamp: commit.committed_date,
                    comment_count: None,
                    body: commit
                        .message_body
                        .clone()
                        .filter(|body| !body.trim().is_empty()),
                    labels: Vec::new(),
                    additions: None,
                    deletions: None,
                    changed_files: None,
                    review_decision: None,
                    action: Some("pushed a commit".into()),
                });
            }
        }

        for pr in &repo.pull_requests.nodes {
            let (state, timestamp) = match (pr.merged_at, pr.state.as_str()) {
                (Some(merged), _) => (ActivityState::Merged, merged),
                (None, "CLOSED") => (ActivityState::Closed, pr.updated_at),
                _ => (ActivityState::Open, pr.updated_at),
            };
            items.push(ActivityItem {
                id: format!("{slug}#pr{}", pr.number),
                repository: slug.clone(),
                project_name: project.clone(),
                activity_type: ActivityType::PullRequest,
                state,
                number: Some(pr.number),
                title: pr.title.clone(),
                url: pr.url.clone(),
                actor: pr.author.as_ref().map(|a| a.login.clone()),
                actor_avatar: pr.author.as_ref().and_then(|a| a.avatar_url.clone()),
                timestamp,
                comment_count: pr.comments.as_ref().map(|c| c.total_count),
                body: pr.body_text.clone().filter(|body| !body.trim().is_empty()),
                labels: pr.labels.as_ref().map(label_nodes).unwrap_or_default(),
                additions: pr.additions,
                deletions: pr.deletions,
                changed_files: pr.changed_files,
                review_decision: pr.review_decision.clone(),
                action: Some(
                    if state == ActivityState::Merged {
                        "merged a pull request"
                    } else {
                        "updated a pull request"
                    }
                    .into(),
                ),
            });
        }

        for issue in repo
            .open_issues
            .nodes
            .iter()
            .chain(&repo.closed_issues.nodes)
        {
            items.push(ActivityItem {
                id: format!("{slug}#issue{}", issue.number),
                repository: slug.clone(),
                project_name: project.clone(),
                activity_type: ActivityType::Issue,
                state: if issue.state == "CLOSED" {
                    ActivityState::Closed
                } else {
                    ActivityState::Open
                },
                number: Some(issue.number),
                title: issue.title.clone(),
                url: issue.url.clone(),
                actor: issue.author.as_ref().map(|a| a.login.clone()),
                actor_avatar: issue.author.as_ref().and_then(|a| a.avatar_url.clone()),
                timestamp: issue.updated_at,
                comment_count: issue.comments.as_ref().map(|c| c.total_count),
                body: issue
                    .body_text
                    .clone()
                    .filter(|body| !body.trim().is_empty()),
                labels: issue.labels.as_ref().map(label_nodes).unwrap_or_default(),
                additions: None,
                deletions: None,
                changed_files: None,
                review_decision: None,
                action: Some("updated an issue".into()),
            });
        }

        for discussion in &repo.discussions.nodes {
            items.push(ActivityItem {
                id: format!("{slug}#discussion{}", discussion.number),
                repository: slug.clone(),
                project_name: project.clone(),
                activity_type: ActivityType::Discussion,
                state: ActivityState::Open,
                number: Some(discussion.number),
                title: discussion.title.clone(),
                url: discussion.url.clone(),
                actor: discussion.author.as_ref().map(|a| a.login.clone()),
                actor_avatar: discussion
                    .author
                    .as_ref()
                    .and_then(|a| a.avatar_url.clone()),
                timestamp: discussion.updated_at,
                comment_count: discussion.comments.as_ref().map(|c| c.total_count),
                body: discussion
                    .body_text
                    .clone()
                    .filter(|body| !body.trim().is_empty()),
                labels: discussion
                    .category
                    .as_ref()
                    .map(|category| {
                        vec![ActivityLabel {
                            name: category.name.clone(),
                            color: "8250df".into(),
                        }]
                    })
                    .unwrap_or_default(),
                additions: None,
                deletions: None,
                changed_files: None,
                review_decision: None,
                action: Some("updated a discussion".into()),
            });
        }

        for release in &repo.releases.nodes {
            let Some(published_at) = release.published_at else {
                continue;
            };
            items.push(ActivityItem {
                id: format!("{slug}#release{}", release.tag_name),
                repository: slug.clone(),
                project_name: project.clone(),
                activity_type: ActivityType::Release,
                state: ActivityState::Published,
                number: None,
                title: release
                    .name
                    .clone()
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| release.tag_name.clone()),
                url: release.url.clone(),
                actor: release.author.as_ref().map(|a| a.login.clone()),
                actor_avatar: release.author.as_ref().and_then(|a| a.avatar_url.clone()),
                timestamp: published_at,
                comment_count: None,
                body: release
                    .description
                    .clone()
                    .filter(|body| !body.trim().is_empty()),
                labels: Vec::new(),
                additions: None,
                deletions: None,
                changed_files: None,
                review_decision: None,
                action: Some("published a release".into()),
            });
        }
    }

    items
}

fn label_nodes(nodes: &Nodes<GraphQlLabel>) -> Vec<ActivityLabel> {
    nodes
        .nodes
        .iter()
        .map(|label| ActivityLabel {
            name: label.name.clone(),
            color: label.color.clone(),
        })
        .collect()
}

// ── Response shapes ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct RestUser {
    login: String,
}

#[derive(Deserialize)]
struct RepositorySearch {
    items: Vec<RestRepository>,
}

#[derive(Deserialize)]
struct RestRepository {
    full_name: String,
}

#[derive(Deserialize)]
struct RestEvent {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    actor: RestActor,
    repo: RestEventRepository,
    #[serde(default)]
    payload: serde_json::Value,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
struct RestActor {
    login: String,
    avatar_url: String,
}

#[derive(Deserialize)]
struct RestEventRepository {
    name: String,
}

#[derive(Deserialize)]
struct GraphQlResponse {
    data: Option<HashMap<String, Option<Repository>>>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Deserialize)]
struct IssueGraphQlResponse {
    data: Option<HashMap<String, Option<IssueRepository>>>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueRepository {
    name_with_owner: String,
    issues: IssueConnection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueConnection {
    #[serde(default)]
    nodes: Vec<Issue>,
    total_count: i64,
    page_info: PageInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    end_cursor: Option<String>,
    has_next_page: bool,
}

#[derive(Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Deserialize)]
struct ViewerResponse {
    data: Option<ViewerData>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Deserialize)]
struct ViewerData {
    viewer: Viewer,
}

#[derive(Deserialize)]
struct Viewer {
    repositories: Nodes<ViewerRepository>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerRepository {
    name_with_owner: String,
    is_archived: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Repository {
    name_with_owner: String,
    default_branch_ref: Option<BranchRef>,
    pull_requests: Nodes<PullRequest>,
    open_issues: Nodes<Issue>,
    closed_issues: Nodes<Issue>,
    discussions: Nodes<Discussion>,
    releases: Nodes<Release>,
}

#[derive(Deserialize)]
struct BranchRef {
    target: CommitHistory,
}

#[derive(Deserialize)]
struct CommitHistory {
    history: Nodes<Commit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Commit {
    oid: String,
    message_headline: String,
    message_body: Option<String>,
    url: String,
    committed_date: DateTime<Utc>,
    author: Option<CommitAuthor>,
}

#[derive(Deserialize)]
struct CommitAuthor {
    user: Option<Author>,
}

#[derive(Deserialize)]
struct Nodes<T> {
    #[serde(default = "Vec::new")]
    nodes: Vec<T>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Author {
    login: String,
    avatar_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentCount {
    total_count: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullRequest {
    number: i64,
    title: String,
    body_text: Option<String>,
    url: String,
    state: String,
    updated_at: DateTime<Utc>,
    merged_at: Option<DateTime<Utc>>,
    comments: Option<CommentCount>,
    author: Option<Author>,
    labels: Option<Nodes<GraphQlLabel>>,
    additions: Option<i64>,
    deletions: Option<i64>,
    changed_files: Option<i64>,
    review_decision: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Issue {
    number: i64,
    title: String,
    body_text: Option<String>,
    url: String,
    state: String,
    updated_at: DateTime<Utc>,
    comments: Option<CommentCount>,
    author: Option<Author>,
    labels: Option<Nodes<GraphQlLabel>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Discussion {
    number: i64,
    title: String,
    body_text: Option<String>,
    url: String,
    updated_at: DateTime<Utc>,
    comments: Option<CommentCount>,
    author: Option<Author>,
    category: Option<DiscussionCategory>,
}

#[derive(Deserialize)]
struct DiscussionCategory {
    name: String,
}

#[derive(Deserialize)]
struct GraphQlLabel {
    name: String,
    color: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Release {
    name: Option<String>,
    tag_name: String,
    url: String,
    published_at: Option<DateTime<Utc>>,
    author: Option<Author>,
    description: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn public_event(kind: &str, payload: serde_json::Value) -> RestEvent {
        serde_json::from_value(serde_json::json!({
            "id": format!("event-{kind}"),
            "type": kind,
            "actor": { "login": "JayceV552", "avatar_url": "https://avatars.example/jayce" },
            "repo": { "name": "JayceV552/DevHub" },
            "payload": payload,
            "created_at": "2026-08-30T10:00:00Z"
        }))
        .expect("valid public event")
    }

    fn repo(owner: &str, name: &str) -> RepoRef {
        RepoRef {
            owner: owner.into(),
            name: name.into(),
            project_name: Some("DayFlow".into()),
        }
    }

    #[test]
    fn parses_well_formed_slugs_and_rejects_the_rest() {
        let parsed = RepoRef::parse("dayflow-js/calendar", None).expect("valid slug");
        assert_eq!(parsed.owner, "dayflow-js");
        assert_eq!(parsed.name, "calendar");

        for bad in ["", "calendar", "/calendar", "dayflow-js/", "a/b/c"] {
            assert!(
                RepoRef::parse(bad, None).is_none(),
                "`{bad}` should not parse"
            );
        }
    }

    #[test]
    fn public_user_events_include_stars_and_repositories_becoming_public() {
        let star = event_item(public_event(
            "WatchEvent",
            serde_json::json!({ "action": "started" }),
        ))
        .expect("star event");
        assert_eq!(star.activity_type, ActivityType::Star);
        assert_eq!(star.title, "DevHub");
        assert_eq!(star.action.as_deref(), Some("starred this repository"));

        let published =
            event_item(public_event("PublicEvent", serde_json::json!({}))).expect("public event");
        assert_eq!(published.activity_type, ActivityType::Publish);
        assert_eq!(published.title, "DevHub");
        assert_eq!(
            published.action.as_deref(),
            Some("made this repository public")
        );
    }

    #[test]
    fn the_query_asks_for_every_kind_under_one_alias_per_repo() {
        let query = build_query(&[repo("dayflow-js", "calendar"), repo("dayflow-js", "pro")]);

        for alias in ["r0: repository", "r1: repository"] {
            assert!(query.contains(alias), "missing alias in:\n{query}");
        }
        for field in [
            "pullRequests(",
            "openIssues: issues(",
            "closedIssues: issues(",
            "discussions(",
            "history(",
            "releases(",
        ] {
            assert!(query.contains(field), "missing {field} in:\n{query}");
        }
        assert!(query.contains(r#"owner: "dayflow-js""#));
        assert!(query.contains(r#"name: "calendar""#));
    }

    #[test]
    fn the_todo_query_only_requests_latest_open_issues() {
        let query = build_issue_query(&[repo("dayflow-js", "calendar"), repo("dayflow-js", "pro")]);

        assert!(query.contains("r0: repository"));
        assert!(query.contains("r1: repository"));
        assert!(query.contains("states: OPEN"));
        assert!(query.contains("field: UPDATED_AT, direction: DESC"));
        assert!(!query.contains("pullRequests("));
        assert!(!query.contains("discussions("));
        assert!(!query.contains("releases("));
        assert!(query.contains("totalCount"));
        assert!(query.contains("pageInfo"));
    }

    #[test]
    fn issue_page_cursors_cannot_break_out_of_the_query() {
        let query = build_issue_page_query(
            &repo("shadcn-ui", "ui"),
            Some("cursor\", states: CLOSED) { id } #"),
        );
        assert!(query.contains("first: 30"));
        assert!(query.contains(r#"after: "cursor\""#));
        assert!(!query.contains(r#"after: "cursor", states: CLOSED"#));
    }

    #[test]
    fn issue_groups_keep_the_total_and_pagination_cursor() {
        let body: IssueGraphQlResponse = serde_json::from_value(serde_json::json!({
            "data": {
                "r0": {
                    "nameWithOwner": "shadcn-ui/ui",
                    "issues": {
                        "totalCount": 912,
                        "pageInfo": { "endCursor": "next-page", "hasNextPage": true },
                        "nodes": [{
                            "number": 123,
                            "title": "A popular issue",
                            "bodyText": null,
                            "url": "https://github.com/shadcn-ui/ui/issues/123",
                            "state": "OPEN",
                            "updatedAt": "2026-08-30T10:00:00Z",
                            "labels": { "nodes": [] },
                            "comments": { "totalCount": 2 },
                            "author": null
                        }]
                    }
                }
            }
        }))
        .expect("valid response");
        let groups = collect_issue_groups(body.data.unwrap(), &[repo("shadcn-ui", "ui")]);
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].total_count, 912);
        assert_eq!(groups[0].end_cursor.as_deref(), Some("next-page"));
        assert!(groups[0].has_next_page);
        assert_eq!(groups[0].issues[0].number, Some(123));
    }

    /// A repository name is user-supplied config. It must be encoded, not
    /// pasted, or a quote in it would break out of the GraphQL string.
    #[test]
    fn repository_names_cannot_break_out_of_the_query() {
        let query = build_query(&[repo("evil\", name: \"x\") { id } #", "y")]);
        assert!(
            !query.contains(r#"owner: "evil", name:"#),
            "injection succeeded:\n{query}"
        );
        assert!(
            query.contains(r#"\""#),
            "the quote should have been escaped"
        );
    }

    fn sample_response() -> HashMap<String, Option<Repository>> {
        let json = serde_json::json!({
            "r0": {
                "nameWithOwner": "dayflow-js/calendar",
                "defaultBranchRef": { "target": { "history": { "nodes": [
                    { "oid": "abc123", "messageHeadline": "Update calendar feed", "url": "https://github.com/x/commit/abc123",
                      "committedDate": "2026-08-28T12:00:00Z",
                      "author": { "user": { "login": "jayce", "avatarUrl": "https://avatars.githubusercontent.com/u/1" } } }
                ] } } },
                "pullRequests": { "nodes": [
                    { "number": 281, "title": "Improve event rendering", "url": "https://github.com/x/281",
                      "state": "MERGED", "createdAt": "2026-08-20T10:00:00Z", "updatedAt": "2026-08-25T10:00:00Z",
                      "mergedAt": "2026-08-25T09:00:00Z", "comments": {"totalCount": 4},
                      "author": {"login": "alice", "avatarUrl": "https://a"} },
                    { "number": 282, "title": "WIP", "url": "https://github.com/x/282",
                      "state": "OPEN", "createdAt": "2026-08-26T10:00:00Z", "updatedAt": "2026-08-26T10:00:00Z",
                      "mergedAt": null, "comments": {"totalCount": 0}, "author": null }
                ]},
                "openIssues": { "nodes": [
                    { "number": 279, "title": "Drag broken on Safari", "url": "https://github.com/x/279",
                      "state": "OPEN", "createdAt": "2026-08-27T10:00:00Z", "updatedAt": "2026-08-27T12:00:00Z",
                      "comments": {"totalCount": 2}, "author": {"login": "bob", "avatarUrl": null} }
                ]},
                "closedIssues": { "nodes": [
                    { "number": 278, "title": "Old rendering bug", "url": "https://github.com/x/278",
                      "state": "CLOSED", "createdAt": "2026-08-21T10:00:00Z", "updatedAt": "2026-08-22T12:00:00Z",
                      "comments": {"totalCount": 1}, "author": {"login": "dana", "avatarUrl": null} }
                ]},
                "discussions": { "nodes": [
                    { "number": 63, "title": "Custom recurring events?", "url": "https://github.com/x/63",
                      "createdAt": "2026-08-24T10:00:00Z", "updatedAt": "2026-08-28T10:00:00Z",
                      "comments": {"totalCount": 3}, "author": {"login": "carol", "avatarUrl": null} }
                ]},
                "releases": { "nodes": [
                    { "name": "v1.8.2", "tagName": "v1.8.2", "url": "https://github.com/x/r",
                      "publishedAt": "2026-08-23T10:00:00Z", "author": {"login": "alice", "avatarUrl": null} },
                    { "name": null, "tagName": "v1.9.0-draft", "url": "https://github.com/x/d",
                      "publishedAt": null, "author": null }
                ]}
            }
        });
        serde_json::from_value(json).expect("fixture should deserialize")
    }

    #[test]
    fn every_kind_becomes_an_activity_item() {
        let items = collect_items(sample_response(), &[repo("dayflow-js", "calendar")]);

        // 1 commit + 2 PRs + 2 issues + 1 discussion + 1 published release. The draft
        // release has no publish date and has not happened yet.
        assert_eq!(items.len(), 7, "got {items:#?}");

        let commit = items
            .iter()
            .find(|i| i.activity_type == ActivityType::Commit)
            .expect("commit");
        assert_eq!(commit.actor.as_deref(), Some("jayce"));
        assert!(
            commit
                .actor_avatar
                .as_deref()
                .is_some_and(|url| url.contains("avatars.githubusercontent.com"))
        );

        let merged = items
            .iter()
            .find(|i| i.number == Some(281))
            .expect("PR 281");
        assert_eq!(merged.activity_type, ActivityType::PullRequest);
        assert_eq!(merged.state, ActivityState::Merged);
        // A merged PR is timestamped by its merge, not its last edit.
        assert_eq!(merged.timestamp.to_rfc3339(), "2026-08-25T09:00:00+00:00");
        assert_eq!(merged.actor.as_deref(), Some("alice"));
        assert_eq!(merged.project_name.as_deref(), Some("DayFlow"));

        let open = items
            .iter()
            .find(|i| i.number == Some(282))
            .expect("PR 282");
        assert_eq!(open.state, ActivityState::Open);
        // A deleted account comes back as a null author; it must not be fatal.
        assert_eq!(open.actor, None);

        let closed_issue = items
            .iter()
            .find(|item| item.number == Some(278))
            .expect("closed issue 278");
        assert_eq!(closed_issue.activity_type, ActivityType::Issue);
        assert_eq!(closed_issue.state, ActivityState::Closed);

        let release = items
            .iter()
            .find(|i| i.activity_type == ActivityType::Release)
            .expect("release");
        assert_eq!(release.title, "v1.8.2");
        assert!(
            !items.iter().any(|i| i.title.contains("draft")),
            "a draft release should not be in the feed",
        );

        let discussion = items
            .iter()
            .find(|i| i.activity_type == ActivityType::Discussion)
            .expect("discussion");
        assert_eq!(discussion.comment_count, Some(3));
    }

    /// The feed's whole purpose is one timeline across kinds and repos.
    #[test]
    fn items_are_merged_into_one_timeline() {
        let mut items = collect_items(sample_response(), &[repo("dayflow-js", "calendar")]);
        items.sort_by_key(|item| std::cmp::Reverse(item.timestamp));

        let order: Vec<&str> = items
            .iter()
            .map(|i| match i.activity_type {
                ActivityType::Commit => "commit",
                ActivityType::PullRequest => "pr",
                ActivityType::Issue => "issue",
                ActivityType::Discussion => "discussion",
                ActivityType::Release => "release",
                ActivityType::Star => "star",
                ActivityType::Fork => "fork",
                ActivityType::Publish => "publish",
            })
            .collect();

        assert_eq!(
            order,
            [
                "commit",
                "discussion",
                "issue",
                "pr",
                "pr",
                "release",
                "issue"
            ]
        );
    }

    /// A repo the token cannot see comes back as `null` rather than an error.
    /// The rest of the feed still has to work.
    #[test]
    fn an_inaccessible_repository_is_skipped_not_fatal() {
        let mut data = sample_response();
        data.insert("r1".to_string(), None);

        let items = collect_items(
            data,
            &[repo("dayflow-js", "calendar"), repo("private", "repo")],
        );
        assert_eq!(items.len(), 7, "the visible repo's items should survive");
    }

    #[test]
    fn ids_are_stable_across_fetches() {
        let first = collect_items(sample_response(), &[repo("dayflow-js", "calendar")]);
        let second = collect_items(sample_response(), &[repo("dayflow-js", "calendar")]);

        let ids = |items: &[ActivityItem]| -> Vec<String> {
            items.iter().map(|i| i.id.clone()).collect()
        };
        assert_eq!(ids(&first), ids(&second));
        assert!(first.iter().any(|i| i.id == "dayflow-js/calendar#pr281"));
    }
}
