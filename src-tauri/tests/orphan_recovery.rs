use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use devhub_lib::testing::{CommandKind, CommandSpec, ProcessManager, RunRegistry};
use tauri::test::MockRuntime;

fn alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

fn service(script: &str) -> CommandSpec {
    CommandSpec {
        program: "sh".into(),
        args: vec!["-c".into(), script.into()],
        kind: CommandKind::Service,
        env: BTreeMap::new(),
        cwd: None,
    }
}

fn session(dir: &std::path::Path) -> (Arc<ProcessManager<MockRuntime>>, Arc<RunRegistry>) {
    let registry = Arc::new(RunRegistry::load(dir));
    let app = tauri::test::mock_app();
    let processes = Arc::new(ProcessManager::new(
        app.handle().clone(),
        1_000,
        1,
        tokio::runtime::Handle::current(),
        Arc::clone(&registry),
    ));
    (processes, registry)
}

#[tokio::test]
async fn a_process_that_outlives_its_session_is_found_and_can_be_stopped() {
    let dir = tempfile::tempdir().expect("tempdir");

    let leader = {
        let (processes, _registry) = session(dir.path());
        let run = processes
            .spawn(
                "website",
                "Calendar Website",
                &PathBuf::from("/tmp"),
                "dev",
                &service("sleep 300 & wait"),
            )
            .expect("spawn");

        run.pid.expect("run has a pid")
    };

    assert!(
        alive(leader),
        "the process should have outlived its session"
    );

    let (_processes, registry) = session(dir.path());
    let orphans = registry.survivors();

    let orphan = orphans
        .iter()
        .find(|entry| entry.pid == leader)
        .expect("the surviving process should be listed as an orphan");
    assert_eq!(orphan.project_name, "Calendar Website");
    assert_eq!(orphan.command_id, "dev");
    assert!(
        registry.verify(leader),
        "the pid should still verify as ours"
    );

    devhub_lib::testing::terminate_group(leader);

    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(25)).await;
        if !alive(leader) {
            registry.forget(leader);
            assert!(
                registry.survivors().iter().all(|e| e.pid != leader),
                "a stopped orphan should not be reported again",
            );
            return;
        }
    }
    panic!("the orphan survived being stopped");
}

#[tokio::test]
async fn a_clean_exit_leaves_nothing_behind() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (processes, _registry) = session(dir.path());

    let run = processes
        .spawn(
            "demo",
            "Demo",
            &PathBuf::from("/tmp"),
            "build",
            &service("exit 0"),
        )
        .expect("spawn");

    for _ in 0..200 {
        tokio::time::sleep(Duration::from_millis(25)).await;
        let done = processes
            .list_runs()
            .into_iter()
            .any(|r| r.run_id == run.run_id && r.status.is_terminal());
        if done {
            break;
        }
    }

    let next = RunRegistry::load(dir.path());
    assert!(
        next.survivors().is_empty(),
        "a command that exited cleanly was recorded as an orphan",
    );
}

#[tokio::test]
async fn stop_all_terminates_every_running_group() {
    let dir = tempfile::tempdir().expect("tempdir");
    let (processes, registry) = session(dir.path());

    let leaders: Vec<u32> = ["a", "b", "c"]
        .iter()
        .map(|name| {
            processes
                .spawn(
                    name,
                    name,
                    &PathBuf::from("/tmp"),
                    "dev",
                    &service("sleep 300 & wait"),
                )
                .expect("spawn")
                .pid
                .expect("pid")
        })
        .collect();

    assert!(
        leaders.iter().all(|pid| alive(*pid)),
        "all three should be running"
    );

    processes.stop_all();

    for pid in &leaders {
        let mut gone = false;
        for _ in 0..100 {
            tokio::time::sleep(Duration::from_millis(25)).await;
            if !alive(*pid) {
                gone = true;
                break;
            }
        }
        assert!(gone, "process group {pid} survived stop_all");
    }

    for pid in &leaders {
        registry.forget(*pid);
    }
    assert!(RunRegistry::load(dir.path()).survivors().is_empty());
}
