use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::models::Run;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackedRun {
    pub pid: u32,
    pub start_time: u64,
    pub project_id: String,
    pub project_name: String,
    pub command_id: String,
    pub display_command: String,
    pub started_at: DateTime<Utc>,
}

pub struct RunRegistry {
    path: PathBuf,
    entries: Mutex<Vec<TrackedRun>>,
}

impl RunRegistry {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("running.json");
        let entries = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();

        Self {
            path,
            entries: Mutex::new(entries),
        }
    }

    pub fn track(&self, run: &Run) {
        let Some(pid) = run.pid else { return };
        let Some(start_time) = process_start_time(pid) else {
            return;
        };

        self.entries.lock().unwrap().push(TrackedRun {
            pid,
            start_time,
            project_id: run.project_id.clone(),
            project_name: run.project_name.clone(),
            command_id: run.command_id.clone(),
            display_command: run.display_command.clone(),
            started_at: run.started_at,
        });
        self.persist();
    }

    pub fn forget(&self, pid: u32) {
        self.entries
            .lock()
            .unwrap()
            .retain(|entry| entry.pid != pid);
        self.persist();
    }

    pub fn survivors(&self) -> Vec<TrackedRun> {
        let mut entries = self.entries.lock().unwrap();
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing(),
        );

        entries.retain(|entry| {
            system
                .process(Pid::from_u32(entry.pid))
                .is_some_and(|process| process.start_time() == entry.start_time)
        });

        let survivors = entries.clone();
        drop(entries);
        self.persist();
        survivors
    }

    pub fn verify(&self, pid: u32) -> bool {
        let Some(expected) = self
            .entries
            .lock()
            .unwrap()
            .iter()
            .find(|entry| entry.pid == pid)
            .map(|entry| entry.start_time)
        else {
            return false;
        };
        process_start_time(pid) == Some(expected)
    }

    fn persist(&self) {
        let entries = self.entries.lock().unwrap();
        let Ok(text) = serde_json::to_string_pretty(&*entries) else {
            return;
        };
        if let Some(parent) = self.path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let tmp = self.path.with_extension("json.tmp");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(&tmp, &self.path);
        }
    }
}

fn process_start_time(pid: u32) -> Option<u64> {
    let target = Pid::from_u32(pid);
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[target]),
        true,
        ProcessRefreshKind::nothing(),
    );
    system.process(target).map(|process| process.start_time())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registry() -> (tempfile::TempDir, RunRegistry) {
        let dir = tempfile::tempdir().expect("tempdir");
        let registry = RunRegistry::load(dir.path());
        (dir, registry)
    }

    fn run_with_pid(pid: u32) -> Run {
        Run {
            run_id: "r1".into(),
            project_id: "p".into(),
            project_name: "P".into(),
            command_id: "dev".into(),
            kind: crate::models::CommandKind::Service,
            display_command: "npm run dev".into(),
            pid: Some(pid),
            started_at: Utc::now(),
            finished_at: None,
            status: crate::models::RunStatus::Running,
            exit_code: None,
        }
    }

    #[test]
    fn a_live_process_survives_and_a_dead_one_is_pruned() {
        let (_dir, registry) = registry();

        // Our own process is unambiguously alive.
        registry.track(&run_with_pid(std::process::id()));
        assert_eq!(registry.survivors().len(), 1);

        // A pid that cannot exist: max_pid on macOS is 99999.
        registry.entries.lock().unwrap().push(TrackedRun {
            pid: 999_999,
            start_time: 0,
            project_id: "p".into(),
            project_name: "P".into(),
            command_id: "dev".into(),
            display_command: "x".into(),
            started_at: Utc::now(),
        });
        let survivors = registry.survivors();
        assert_eq!(survivors.len(), 1, "the dead pid should have been pruned");
        assert_eq!(survivors[0].pid, std::process::id());
    }

    /// The important safety property: a recycled pid must not be treated as
    /// ours, because acting on it would kill an unrelated process.
    #[test]
    fn a_recycled_pid_is_not_mistaken_for_ours() {
        let (_dir, registry) = registry();

        // Same pid as this very much alive process, but a start time that
        // cannot be right — exactly what pid reuse looks like.
        registry.entries.lock().unwrap().push(TrackedRun {
            pid: std::process::id(),
            start_time: 1,
            project_id: "p".into(),
            project_name: "P".into(),
            command_id: "dev".into(),
            display_command: "x".into(),
            started_at: Utc::now(),
        });

        assert!(
            registry.survivors().is_empty(),
            "start time mismatch must disqualify it"
        );
        assert!(!registry.verify(std::process::id()));
    }

    #[test]
    fn entries_survive_a_reload() {
        let dir = tempfile::tempdir().expect("tempdir");
        let pid = std::process::id();

        let first = RunRegistry::load(dir.path());
        first.track(&run_with_pid(pid));

        let second = RunRegistry::load(dir.path());
        let survivors = second.survivors();
        assert_eq!(survivors.len(), 1);
        assert_eq!(survivors[0].pid, pid);
        assert_eq!(survivors[0].display_command, "npm run dev");
    }

    #[test]
    fn forget_removes_an_entry() {
        let (_dir, registry) = registry();
        let pid = std::process::id();

        registry.track(&run_with_pid(pid));
        registry.forget(pid);
        assert!(registry.survivors().is_empty());
    }

    /// A corrupt file must not stop the app from starting.
    #[test]
    fn a_corrupt_registry_loads_as_empty() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("running.json"), "{{{not json").unwrap();

        let registry = RunRegistry::load(dir.path());
        assert!(registry.survivors().is_empty());
    }
}
