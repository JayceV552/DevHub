use crate::models::{ActivityItem, ActivityLabel, ActivityState, ActivityType};
use super::types::RestEvent;

pub(crate) fn event_item(event: RestEvent) -> Option<ActivityItem> {
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

pub(crate) fn json_labels(value: Option<&serde_json::Value>) -> Vec<ActivityLabel> {
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
