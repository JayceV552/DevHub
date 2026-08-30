use std::collections::BTreeMap;
use std::path::PathBuf;
use std::net::{SocketAddr, TcpStream};
use std::sync::Arc;
use std::time::Duration;

use devhub_lib::testing::{
    CommandKind, CommandSpec, PortManager, PortOwnership, ProcessManager, Run, RunRegistry,
};
use tauri::test::MockRuntime;

const TEST_PORT: u16 = 47_311;
const POLL_INTERVAL: Duration = Duration::from_millis(50);
/// CI runners are slow enough to spawn `python3 -m http.server` that the
/// original 5s budget was not always enough for the listener to appear.
const POLL_BUDGET: Duration = Duration::from_secs(15);

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
                    // `-u` because stdout is a pipe here, and a block-buffered
                    // banner would make "no output" ambiguous when this fails.
                    format!("{python} -u -m http.server {TEST_PORT} --bind 127.0.0.1 & wait"),
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
        None => panic!("{}", diagnose(&mut ports, &processes, &run, &python)),
    }

    processes.stop(&run.run_id).expect("stop");

    for _ in 0..poll_attempts() {
        tokio::time::sleep(POLL_INTERVAL).await;
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
    for _ in 0..poll_attempts() {
        tokio::time::sleep(POLL_INTERVAL).await;
        let listed = ports
            .list(&processes.running_pids(), true)
            .expect("list ports");
        if let Some(entry) = listed.into_iter().find(|e| e.port == TEST_PORT) {
            return Some(entry);
        }
    }
    None
}

fn poll_attempts() -> u32 {
    (POLL_BUDGET.as_millis() / POLL_INTERVAL.as_millis()) as u32
}

/// This has only ever failed on CI, so say what the poll actually saw: whether
/// the run died, what the child printed, and which listeners were visible.
fn diagnose(
    ports: &mut PortManager,
    processes: &Arc<ProcessManager<MockRuntime>>,
    run: &Run,
    python: &str,
) -> String {
    // Connecting proves whether anything is actually bound, independently of
    // the socket enumeration under test — it separates "the server never came
    // up" from "the server is up but PortManager cannot see it".
    let reachable = match TcpStream::connect_timeout(
        &SocketAddr::from(([127, 0, 0, 1], TEST_PORT)),
        Duration::from_secs(1),
    ) {
        Ok(_) => "yes, something is listening".to_string(),
        Err(e) => format!("no ({e})"),
    };

    let status = processes
        .list_runs()
        .into_iter()
        .find(|r| r.run_id == run.run_id)
        .map(|r| format!("{:?}, exit code {:?}", r.status, r.exit_code))
        .unwrap_or_else(|| "run is no longer tracked".to_string());

    let output = match processes.get_output(&run.run_id) {
        Ok(lines) if lines.is_empty() => "    <no output>".to_string(),
        Ok(lines) => lines
            .iter()
            .map(|line| format!("    [{:?}] {}", line.stream, line.text))
            .collect::<Vec<_>>()
            .join("\n"),
        Err(e) => format!("    <unavailable: {e}>"),
    };

    let listening = match ports.list(&processes.running_pids(), false) {
        Ok(entries) if entries.is_empty() => "    <none>".to_string(),
        Ok(entries) => entries
            .iter()
            .map(|e| format!("    {} pid={:?} {:?}", e.port, e.pid, e.ownership))
            .collect::<Vec<_>>()
            .join("\n"),
        Err(e) => format!("    <unavailable: {e}>"),
    };

    format!(
        "port {TEST_PORT} never showed up as managed after {POLL_BUDGET:?}\n\
         \x20 interpreter: {python}\n\
         \x20 shell pid: {:?}\n\
         \x20 run status: {status}\n\
         \x20 port reachable by connect(): {reachable}\n\
         \x20 child output:\n{output}\n\
         \x20 all listening ports (unfiltered):\n{listening}",
        run.pid,
    )
}

fn which_python() -> Option<String> {
    let output = std::process::Command::new("sh")
        .args(["-c", "command -v python3"])
        .output()
        .ok()?;
    let path = String::from_utf8(output.stdout).ok()?.trim().to_string();
    (!path.is_empty()).then_some(path)
}
