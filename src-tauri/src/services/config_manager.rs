use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::models::{Project, TodoBoardConfig};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Config {
    #[serde(default)]
    pub settings: Settings,
    #[serde(default, rename = "projects")]
    pub projects: Vec<Project>,
    #[serde(default, rename = "columns")]
    pub columns: Vec<crate::models::ActivityColumn>,
    #[serde(default)]
    pub todo_board: TodoBoardConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub theme: Theme,
    pub output_buffer_lines: usize,
    pub stop_grace_seconds: u64,
    pub hide_system_ports: bool,
    pub clipboard_storage_cap_mb: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub github_client_id: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: Theme::default(),
            output_buffer_lines: 5_000,
            stop_grace_seconds: 5,
            hide_system_ports: true,
            clipboard_storage_cap_mb: 256,
            github_client_id: None,
        }
    }
}

pub struct ConfigManager {
    path: PathBuf,
}

impl ConfigManager {
    pub fn new(config_dir: &Path) -> Self {
        Self {
            path: config_dir.join("config.toml"),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<Config> {
        match std::fs::read_to_string(&self.path) {
            Ok(text) => Ok(toml::from_str(&text)?),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
            Err(err) => Err(err.into()),
        }
    }

    pub fn save(&self, config: &Config) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let text = toml::to_string_pretty(config)?;
        let tmp = self.path.with_extension("toml.tmp");
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}
