use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::ActivityItem;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TodoBoardConfig {
    pub repositories: Vec<String>,
    pub todos: Vec<TodoItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub steps: Vec<TodoStep>,
    #[serde(default)]
    pub completed: bool,
    pub created_at: DateTime<Utc>,
}

impl TodoItem {
    /// A todo that owns steps is complete exactly when every step is, so the
    /// card checkbox can never disagree with the checklist inside it. A todo
    /// without steps keeps whatever the checkbox last set.
    pub fn sync_completion(&mut self) {
        if !self.steps.is_empty() {
            self.completed = self.steps.iter().all(|step| step.done);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoStep {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub done: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryIssueGroup {
    pub repository: String,
    pub total_count: i64,
    pub issues: Vec<ActivityItem>,
    pub end_cursor: Option<String>,
    pub has_next_page: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryIssuePage {
    pub repository: String,
    pub total_count: i64,
    pub issues: Vec<ActivityItem>,
    pub end_cursor: Option<String>,
    pub has_next_page: bool,
}
