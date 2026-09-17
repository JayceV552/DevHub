use std::collections::HashMap;

use crate::error::Error;
use crate::models::{
    ActivityItem, ActivityLabel, ActivityState, ActivityType, RepositoryIssueGroup,
};
use super::types::{
    GraphQlError, GraphQlLabel, Issue, IssueRepository, Nodes, Repository,
};
use super::RepoRef;

pub(crate) const PER_KIND: usize = 10;
pub(crate) const TODO_ISSUES_PER_REPO: usize = 6;

pub(crate) fn graphql_errors(errors: Option<Vec<GraphQlError>>) -> Error {
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

pub(crate) fn build_query(repos: &[RepoRef]) -> String {
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

pub(crate) fn build_issue_query(repos: &[RepoRef]) -> String {
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

pub(crate) fn build_issue_page_query(repo: &RepoRef, cursor: Option<&str>) -> String {
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

pub(crate) fn collect_issue_groups(
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

pub(crate) fn issue_item(repository: &str, repo_ref: &RepoRef, issue: &Issue) -> ActivityItem {
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

pub(crate) fn collect_items(
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

pub(crate) fn label_nodes(nodes: &Nodes<GraphQlLabel>) -> Vec<ActivityLabel> {
    nodes
        .nodes
        .iter()
        .map(|label| ActivityLabel {
            name: label.name.clone(),
            color: label.color.clone(),
        })
        .collect()
}
