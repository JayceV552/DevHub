use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum CommandKind {
    Service,
    #[default]
    Task,
}

impl CommandKind {
    pub fn guess_from_name(name: &str) -> Self {
        const SERVICE_HINTS: [&str; 7] = [
            "dev",
            "start",
            "serve",
            "watch",
            "preview",
            "storybook",
            "server",
        ];
        let lower = name.to_ascii_lowercase();
        if SERVICE_HINTS.iter().any(|hint| lower.contains(hint)) {
            Self::Service
        } else {
            Self::Task
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandSpec {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub kind: CommandKind,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default)]
    pub commands: BTreeMap<String, CommandSpec>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    #[serde(flatten)]
    pub project: Project,
    pub branch: Option<String>,
    pub path_exists: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScan {
    pub name: String,
    pub path: PathBuf,
    pub repository: Option<String>,
    pub branch: Option<String>,
    pub detected_from: Vec<String>,
    pub commands: BTreeMap<String, CommandSpec>,
}
