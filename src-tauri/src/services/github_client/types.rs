use std::collections::HashMap;
use chrono::{DateTime, Utc};
use serde::Deserialize;

#[derive(Deserialize)]
pub(crate) struct RestUser {
    pub(crate) login: String,
}

#[derive(Deserialize)]
pub(crate) struct RepositorySearch {
    pub(crate) items: Vec<RestRepository>,
}

#[derive(Deserialize)]
pub(crate) struct RestRepository {
    pub(crate) full_name: String,
}

#[derive(Deserialize)]
pub(crate) struct RestEvent {
    pub(crate) id: String,
    #[serde(rename = "type")]
    pub(crate) kind: String,
    pub(crate) actor: RestActor,
    pub(crate) repo: RestEventRepository,
    #[serde(default)]
    pub(crate) payload: serde_json::Value,
    pub(crate) created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub(crate) struct RestActor {
    pub(crate) login: String,
    pub(crate) avatar_url: String,
}

#[derive(Deserialize)]
pub(crate) struct RestEventRepository {
    pub(crate) name: String,
}

#[derive(Deserialize)]
pub(crate) struct GraphQlResponse {
    pub(crate) data: Option<HashMap<String, Option<Repository>>>,
    pub(crate) errors: Option<Vec<GraphQlError>>,
}

#[derive(Deserialize)]
pub(crate) struct IssueGraphQlResponse {
    pub(crate) data: Option<HashMap<String, Option<IssueRepository>>>,
    pub(crate) errors: Option<Vec<GraphQlError>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IssueRepository {
    pub(crate) name_with_owner: String,
    pub(crate) issues: IssueConnection,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IssueConnection {
    #[serde(default)]
    pub(crate) nodes: Vec<Issue>,
    pub(crate) total_count: i64,
    pub(crate) page_info: PageInfo,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageInfo {
    pub(crate) end_cursor: Option<String>,
    pub(crate) has_next_page: bool,
}

#[derive(Deserialize)]
pub(crate) struct GraphQlError {
    pub(crate) message: String,
}

#[derive(Deserialize)]
pub(crate) struct ViewerResponse {
    pub(crate) data: Option<ViewerData>,
    pub(crate) errors: Option<Vec<GraphQlError>>,
}

#[derive(Deserialize)]
pub(crate) struct ViewerData {
    pub(crate) viewer: Viewer,
}

#[derive(Deserialize)]
pub(crate) struct Viewer {
    pub(crate) repositories: Nodes<ViewerRepository>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewerRepository {
    pub(crate) name_with_owner: String,
    pub(crate) is_archived: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Repository {
    pub(crate) name_with_owner: String,
    pub(crate) default_branch_ref: Option<BranchRef>,
    pub(crate) pull_requests: Nodes<PullRequest>,
    pub(crate) open_issues: Nodes<Issue>,
    pub(crate) closed_issues: Nodes<Issue>,
    pub(crate) discussions: Nodes<Discussion>,
    pub(crate) releases: Nodes<Release>,
}

#[derive(Deserialize)]
pub(crate) struct BranchRef {
    pub(crate) target: CommitHistory,
}

#[derive(Deserialize)]
pub(crate) struct CommitHistory {
    pub(crate) history: Nodes<Commit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Commit {
    pub(crate) oid: String,
    pub(crate) message_headline: String,
    pub(crate) message_body: Option<String>,
    pub(crate) url: String,
    pub(crate) committed_date: DateTime<Utc>,
    pub(crate) author: Option<CommitAuthor>,
}

#[derive(Deserialize)]
pub(crate) struct CommitAuthor {
    pub(crate) user: Option<Author>,
}

#[derive(Deserialize)]
pub(crate) struct Nodes<T> {
    #[serde(default = "Vec::new")]
    pub(crate) nodes: Vec<T>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Author {
    pub(crate) login: String,
    pub(crate) avatar_url: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CommentCount {
    pub(crate) total_count: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PullRequest {
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) body_text: Option<String>,
    pub(crate) url: String,
    pub(crate) state: String,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) merged_at: Option<DateTime<Utc>>,
    pub(crate) comments: Option<CommentCount>,
    pub(crate) author: Option<Author>,
    pub(crate) labels: Option<Nodes<GraphQlLabel>>,
    pub(crate) additions: Option<i64>,
    pub(crate) deletions: Option<i64>,
    pub(crate) changed_files: Option<i64>,
    pub(crate) review_decision: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Issue {
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) body_text: Option<String>,
    pub(crate) url: String,
    pub(crate) state: String,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) comments: Option<CommentCount>,
    pub(crate) author: Option<Author>,
    pub(crate) labels: Option<Nodes<GraphQlLabel>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Discussion {
    pub(crate) number: i64,
    pub(crate) title: String,
    pub(crate) body_text: Option<String>,
    pub(crate) url: String,
    pub(crate) updated_at: DateTime<Utc>,
    pub(crate) comments: Option<CommentCount>,
    pub(crate) author: Option<Author>,
    pub(crate) category: Option<DiscussionCategory>,
}

#[derive(Deserialize)]
pub(crate) struct DiscussionCategory {
    pub(crate) name: String,
}

#[derive(Deserialize)]
pub(crate) struct GraphQlLabel {
    pub(crate) name: String,
    pub(crate) color: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Release {
    pub(crate) name: Option<String>,
    pub(crate) tag_name: String,
    pub(crate) url: String,
    pub(crate) published_at: Option<DateTime<Utc>>,
    pub(crate) author: Option<Author>,
    pub(crate) description: Option<String>,
}
