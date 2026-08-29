use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::CommandKind;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RunStatus {
    Running,
    Succeeded,
    Failed,
    Stopped,
}

impl RunStatus {
    pub fn is_terminal(self) -> bool {
        !matches!(self, Self::Running)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub run_id: String,
    pub project_id: String,
    pub project_name: String,
    pub command_id: String,
    pub kind: CommandKind,
    pub display_command: String,
    pub pid: Option<u32>,
    pub started_at: DateTime<Utc>,
    pub finished_at: Option<DateTime<Utc>>,
    pub status: RunStatus,
    pub exit_code: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputStream {
    Stdout,
    Stderr,
    System,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputLine {
    pub run_id: String,
    pub seq: u64,
    pub stream: OutputStream,
    pub text: String,
}
