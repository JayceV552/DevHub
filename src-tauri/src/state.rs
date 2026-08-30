use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::AppHandle;

use crate::error::Result;
use crate::models::Project;
use crate::services::{
    ActivityStore, ClientIdSource, ClipboardStore, Config, ConfigManager, DeviceFlow, GitHubClient,
    PortManager, ProcessManager, RunRegistry, TokenStore, TrackedRun,
};

pub struct AppState {
    config: Mutex<Config>,
    config_manager: ConfigManager,
    pub processes: Arc<ProcessManager>,
    pub ports: Mutex<PortManager>,
    pub registry: Arc<RunRegistry>,
    pub github: GitHubClient,
    pub device_flow: Arc<DeviceFlow>,
    pub activity: ActivityStore,
    pub clipboard: Arc<ClipboardStore>,
    orphans: Mutex<Vec<TrackedRun>>,
}

impl AppState {
    pub fn new(app: AppHandle, config_dir: &Path) -> Result<Self> {
        TokenStore::configure_development_directory(config_dir);
        let config_manager = ConfigManager::new(config_dir);
        let config = config_manager.load()?;

        let registry = Arc::new(RunRegistry::load(config_dir));
        let orphans = registry.survivors();

        let processes = Arc::new(ProcessManager::new(
            app.clone(),
            config.settings.output_buffer_lines,
            config.settings.stop_grace_seconds,
            tauri::async_runtime::handle().inner().clone(),
            Arc::clone(&registry),
        ));
        let clipboard = ClipboardStore::load(
            app.clone(),
            config_dir,
            config.settings.clipboard_storage_cap_mb,
        )?;
        clipboard.start_monitor();

        Ok(Self {
            config: Mutex::new(config),
            config_manager,
            processes,
            ports: Mutex::new(PortManager::new()),
            registry,
            github: GitHubClient::new(),
            device_flow: Arc::new(DeviceFlow::new(reqwest::Client::new())),
            activity: ActivityStore::load(config_dir),
            clipboard,
            orphans: Mutex::new(orphans),
        })
    }

    pub fn orphans(&self) -> Vec<TrackedRun> {
        self.orphans.lock().unwrap().clone()
    }

    pub fn release_orphan(&self, pid: u32) {
        self.orphans
            .lock()
            .unwrap()
            .retain(|entry| entry.pid != pid);
        self.registry.forget(pid);
    }

    pub fn github_client_id(&self) -> Option<(String, ClientIdSource)> {
        let configured = self
            .config
            .lock()
            .unwrap()
            .settings
            .github_client_id
            .clone();
        crate::services::resolve_client_id(configured.as_deref())
    }

    pub fn columns(&self) -> Vec<crate::models::ActivityColumn> {
        self.config.lock().unwrap().columns.clone()
    }

    pub fn projects(&self) -> Vec<Project> {
        self.config.lock().unwrap().projects.clone()
    }

    pub fn todo_board(&self) -> crate::models::TodoBoardConfig {
        self.config.lock().unwrap().todo_board.clone()
    }

    pub fn project(&self, id: &str) -> Option<Project> {
        self.config
            .lock()
            .unwrap()
            .projects
            .iter()
            .find(|p| p.id == id)
            .cloned()
    }

    pub fn settings(&self) -> crate::services::Settings {
        self.config.lock().unwrap().settings.clone()
    }

    pub fn config_path(&self) -> &Path {
        self.config_manager.path()
    }

    pub fn update_config<T>(&self, edit: impl FnOnce(&mut Config) -> Result<T>) -> Result<T> {
        let mut guard = self.config.lock().unwrap();
        let mut draft = guard.clone();
        let value = edit(&mut draft)?;
        self.config_manager.save(&draft)?;
        *guard = draft;
        Ok(value)
    }
}
