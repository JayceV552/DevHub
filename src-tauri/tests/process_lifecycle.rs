use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use devhub_lib::testing::{
    CommandKind, CommandSpec, PathResolver, ProcessManager, RunRegistry, RunStatus,
};
use tauri::test::MockRuntime;

fn manager() -> Arc<ProcessManager<MockRuntime>> {
    let app = tauri::test::mock_app();
    Arc::new(ProcessManager::new(
        app.handle().clone(),
        5_000,
        1,
        tokio::runtime::Handle::current(),
        Arc::new(RunRegistry::load(std::env::temp_dir().as_path())),
    ))
}

fn spec(program: &str, args: &[&str], kind: CommandKind) -> CommandSpec {
    CommandSpec {
        program: program.to_string(),
        args: args.iter().map(|s| s.to_string()).collect(),
        kind,
        env: BTreeMap::new(),
        cwd: None,
    }
}

async fn eventually<T>(mut check: impl FnMut() -> Option<T>) -> T {
    for _ in 0..200 {
        if let Some(value) = check() {
            return value;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("condition was never met within 5s");
}

#[tokio::test]
async fn captures_stdout_and_reports_success() {
    let processes = manager();
    let run = processes
        .spawn(
            "demo",
            "Demo",
            &PathBuf::from("/tmp"),
            "greet",
            &spec("sh", &["-c", "echo hello from devhub"], CommandKind::Task),
        )
        .expect("spawn");

    let finished = eventually(|| {
        processes
            .list_runs()
            .into_iter()
            .find(|r| r.run_id == run.run_id && r.status.is_terminal())
    })
    .await;

    assert_eq!(finished.status, RunStatus::Succeeded);
    assert_eq!(finished.exit_code, Some(0));

    let output = processes.get_output(&run.run_id).expect("buffered output");
    let text: Vec<&str> = output.iter().map(|line| line.text.as_str()).collect();
    assert!(
        text.contains(&"hello from devhub"),
        "stdout was not captured, got {text:?}",
    );
    assert!(
        text.iter().any(|line| line.contains("exited with code 0")),
        "missing the exit note, got {text:?}",
    );
}

#[tokio::test]
async fn a_nonzero_exit_is_a_failure_and_stderr_is_kept() {
    let processes = manager();
    let run = processes
        .spawn(
            "demo",
            "Demo",
            &PathBuf::from("/tmp"),
            "boom",
            &spec("sh", &["-c", "echo bad >&2; exit 3"], CommandKind::Task),
        )
        .expect("spawn");

    let finished = eventually(|| {
        processes
            .list_runs()
            .into_iter()
            .find(|r| r.run_id == run.run_id && r.status.is_terminal())
    })
    .await;

    assert_eq!(finished.status, RunStatus::Failed);
    assert_eq!(finished.exit_code, Some(3));

    let output = processes.get_output(&run.run_id).expect("buffered output");
    assert!(
        output.iter().any(|line| line.text == "bad"),
        "stderr was not captured",
    );
}

#[tokio::test]
async fn stopping_a_service_reports_stopped_not_failed() {
    let processes = manager();
    let run = processes
        .spawn(
            "demo",
            "Demo",
            &PathBuf::from("/tmp"),
            "dev",
            &spec("sh", &["-c", "sleep 120"], CommandKind::Service),
        )
        .expect("spawn");

    processes.stop(&run.run_id).expect("stop");

    let finished = eventually(|| {
        processes
            .list_runs()
            .into_iter()
            .find(|r| r.run_id == run.run_id && r.status.is_terminal())
    })
    .await;

    assert_eq!(finished.status, RunStatus::Stopped);
}

#[tokio::test]
async fn waiting_for_stop_allows_the_same_command_to_restart_immediately() {
    let processes = manager();
    let dev = spec(
        "sh",
        &["-c", "trap '' TERM; while :; do sleep 1; done"],
        CommandKind::Service,
    );

    let first = processes
        .spawn("website", "Website", &PathBuf::from("/tmp"), "dev", &dev)
        .expect("first start");

    processes
        .stop_and_wait(&first.run_id)
        .await
        .expect("stop before restart");

    let second = processes
        .spawn("website", "Website", &PathBuf::from("/tmp"), "dev", &dev)
        .expect("replacement should start immediately");
    assert_ne!(first.run_id, second.run_id);

    processes
        .stop_and_wait(&second.run_id)
        .await
        .expect("cleanup replacement");
}

#[tokio::test]
async fn refuses_to_start_the_same_command_twice() {
    let processes = manager();
    let dev = spec("sh", &["-c", "sleep 120"], CommandKind::Service);
    let path = PathBuf::from("/tmp");

    let first = processes
        .spawn("demo", "Demo", &path, "dev", &dev)
        .expect("first spawn");

    let second = processes.spawn("demo", "Demo", &path, "dev", &dev);
    assert!(second.is_err(), "second spawn should have been refused");

    processes.stop(&first.run_id).expect("stop");
}

#[tokio::test]
async fn a_missing_program_fails_to_spawn() {
    let processes = manager();
    let result = processes.spawn(
        "demo",
        "Demo",
        &PathBuf::from("/tmp"),
        "nope",
        &spec("devhub-no-such-binary", &[], CommandKind::Task),
    );

    let message = result.expect_err("should not have spawned").to_string();
    assert!(
        message.contains("devhub-no-such-binary"),
        "error should name the program, got: {message}",
    );
    assert!(
        message.contains("PATH"),
        "error should explain that this is a PATH problem, got: {message}",
    );
}

#[tokio::test]
async fn children_inherit_the_resolved_path() {
    let processes = manager();
    let run = processes
        .spawn(
            "demo",
            "Demo",
            &PathBuf::from("/tmp"),
            "print-path",
            &spec("sh", &["-c", "printf '%s' \"$PATH\""], CommandKind::Task),
        )
        .expect("spawn");

    eventually(|| {
        processes
            .list_runs()
            .into_iter()
            .find(|r| r.run_id == run.run_id && r.status.is_terminal())
    })
    .await;

    let output = processes.get_output(&run.run_id).expect("buffered output");
    let child_path = output
        .iter()
        .find(|line| line.text.contains('/'))
        .map(|line| line.text.clone())
        .expect("child should have printed a PATH");

    assert_eq!(
        child_path,
        PathResolver::search_path(),
        "the child's PATH does not match the one DevHub resolved",
    );
}

#[test]
fn the_login_shell_contributes_directories_launchd_would_not() {
    let launchd_default = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

    let extra: Vec<String> = std::env::split_paths(PathResolver::search_path())
        .map(|dir| dir.display().to_string())
        .filter(|dir| !launchd_default.contains(&dir.as_str()))
        .collect();

    assert!(
        !extra.is_empty(),
        "the resolved PATH is no better than launchd's default, so the probe \
         is not doing anything",
    );
}

#[tokio::test]
async fn a_program_only_the_login_shell_knows_about_still_starts() {
    const LAUNCHD_PATH: [&str; 4] = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

    let Some(program) = std::env::split_paths(PathResolver::search_path())
        .filter(|dir| !LAUNCHD_PATH.contains(&dir.display().to_string().as_str()))
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flatten()
        .flatten()
        .find(|entry| {
            entry
                .file_type()
                .is_ok_and(|t| t.is_file() || t.is_symlink())
                && PathResolver::resolve_program(&entry.file_name().to_string_lossy()).is_some()
                && !LAUNCHD_PATH
                    .iter()
                    .any(|dir| std::path::Path::new(dir).join(entry.file_name()).exists())
        })
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
    else {
        eprintln!("skipping: nothing on PATH outside launchd's default");
        return;
    };

    let processes = manager();
    let started = processes.spawn(
        "demo",
        "Demo",
        &PathBuf::from("/tmp"),
        "probe",
        &spec(&program, &[], CommandKind::Task),
    );

    let run = started.unwrap_or_else(|err| {
        panic!("`{program}` is on the resolved PATH but would not start: {err}")
    });
    processes.stop(&run.run_id).ok();
}
