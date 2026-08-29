use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use devhub_lib::testing::{
    CommandKind, CommandSpec, PortManager, PortOwnership, ProcessManager, RunRegistry,
};
use tauri::test::MockRuntime;

const TEST_PORT: u16 = 47_311;

fn manager() -> Arc<ProcessManager<MockRuntime>> {
    let app = tauri::test::mock_app();
    Arc::new(ProcessManager::new(
        app.handle().clone(),
        1_000,
        1,
        tokio::runtime::Handle::current(),
        Arc::new(RunRegistry::load(std::env::temp_dir().as_path())),
    ))
}

struct Cleanup(Arc<ProcessManager<MockRuntime>>);

impl Drop for Cleanup {
    fn drop(&mut self) {
        self.0.stop_all();
    }
}

#[tokio::test]
async fn a_port_bound_by_a_grandchild_is_attributed_to_its_project() {
    let Some(python) = which_python() else {
        eprintln!("skipping: no python3 on PATH");
        return;
    };

    let processes = manager();
    let _cleanup = Cleanup(Arc::clone(&processes));

    let run = processes
        .spawn(
            "dayflow-calendar",
            "DayFlow Calendar",
            &PathBuf::from("/tmp"),
            "dev",
            &CommandSpec {
                program: "sh".into(),
                args: vec![
                    "-c".into(),
                    format!("{python} -m http.server {TEST_PORT} --bind 127.0.0.1 & wait"),
                ],
                kind: CommandKind::Service,
                env: BTreeMap::new(),
                cwd: None,
            },
        )
        .expect("spawn");

    let mut ports = PortManager::new();
    let entry = wait_for_port(&mut ports, &processes).await;

    match entry {
        Some(entry) => {
            assert_eq!(entry.ownership, PortOwnership::Managed);
            assert_eq!(entry.project_id.as_deref(), Some("dayflow-calendar"));
            assert_eq!(entry.project_name.as_deref(), Some("DayFlow Calendar"));
            assert_eq!(entry.run_id.as_deref(), Some(run.run_id.as_str()));
            assert_eq!(entry.command_id.as_deref(), Some("dev"));
            assert_ne!(
                entry.pid, run.pid,
                "the listening pid should be the grandchild, not the shell — \
                 if these match, this test is no longer exercising the parent walk",
            );
        }
        None => panic!("port {TEST_PORT} never showed up as managed"),
    }

    processes.stop(&run.run_id).expect("stop");

    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let listed = ports
            .list(&processes.running_pids(), true)
            .expect("list ports");
        if !listed.iter().any(|e| e.port == TEST_PORT) {
            return;
        }
    }
    panic!("port {TEST_PORT} was still bound after the run was stopped");
}

async fn wait_for_port(
    ports: &mut PortManager,
    processes: &Arc<ProcessManager<MockRuntime>>,
) -> Option<devhub_lib::testing::PortEntry> {
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(50)).await;
        let listed = ports
            .list(&processes.running_pids(), true)
            .expect("list ports");
        if let Some(entry) = listed.into_iter().find(|e| e.port == TEST_PORT) {
            return Some(entry);
        }
    }
    None
}

fn which_python() -> Option<String> {
    let output = std::process::Command::new("sh")
        .args(["-c", "command -v python3"])
        .output()
        .ok()?;
    let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!path.is_empty()).then_some(path)
}
