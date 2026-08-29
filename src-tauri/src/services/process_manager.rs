use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::error::{Error, Result};
use crate::models::{CommandSpec, OutputLine, OutputStream, Run, RunStatus};
use crate::services::{PathResolver, RunRegistry};

pub const EVENT_OUTPUT: &str = "devhub://output";
pub const EVENT_RUN: &str = "devhub://run";

const BATCH_INTERVAL: Duration = Duration::from_millis(40);
const MAX_FINISHED_RUNS: usize = 100;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputBatch<'a> {
    run_id: &'a str,
    lines: &'a [OutputLine],
}

struct RunEntry {
    run: Run,
    buffer: VecDeque<OutputLine>,
    buffer_limit: usize,
    next_seq: u64,
    stop_requested: bool,
}

impl RunEntry {
    fn push(&mut self, stream: OutputStream, text: String) -> OutputLine {
        let line = OutputLine {
            run_id: self.run.run_id.clone(),
            seq: self.next_seq,
            stream,
            text,
        };
        self.next_seq += 1;
        if self.buffer.len() >= self.buffer_limit {
            self.buffer.pop_front();
        }
        self.buffer.push_back(line.clone());
        line
    }
}

pub struct ProcessManager<R: Runtime = tauri::Wry> {
    app: AppHandle<R>,
    runs: Mutex<HashMap<String, RunEntry>>,
    buffer_limit: usize,
    stop_grace: Duration,
    registry: Arc<RunRegistry>,
    runtime: tokio::runtime::Handle,
}

impl<R: Runtime> ProcessManager<R> {
    pub fn new(
        app: AppHandle<R>,
        buffer_limit: usize,
        stop_grace_seconds: u64,
        runtime: tokio::runtime::Handle,
        registry: Arc<RunRegistry>,
    ) -> Self {
        Self {
            app,
            runs: Mutex::new(HashMap::new()),
            buffer_limit,
            stop_grace: Duration::from_secs(stop_grace_seconds),
            registry,
            runtime,
        }
    }

    pub fn spawn(
        self: &Arc<Self>,
        project_id: &str,
        project_name: &str,
        project_path: &Path,
        command_id: &str,
        spec: &CommandSpec,
    ) -> Result<Run> {
        if let Some(existing) = self.active_run_for(project_id, command_id) {
            return Err(Error::AlreadyRunning {
                command: existing.command_id,
            });
        }

        let cwd = match &spec.cwd {
            Some(rel) => project_path.join(rel),
            None => project_path.to_path_buf(),
        };

        let program =
            PathResolver::resolve_program(&spec.program).ok_or_else(|| Error::ProgramNotFound {
                program: spec.program.clone(),
                shell: PathResolver::login_shell(),
            })?;

        let mut command = Command::new(&program);
        command
            .args(&spec.args)
            .current_dir(&cwd)
            .env("PATH", PathResolver::search_path())
            .envs(&spec.env)
            .env("FORCE_COLOR", "1")
            .env("CLICOLOR_FORCE", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(false);

        #[cfg(unix)]
        command.process_group(0);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
            command.creation_flags(CREATE_NEW_PROCESS_GROUP);
        }

        let mut child = {
            let _guard = self.runtime.enter();
            command.spawn().map_err(|source| Error::Spawn {
                program: spec.program.clone(),
                source,
            })?
        };

        let run_id = uuid::Uuid::new_v4().to_string();
        let display_command = std::iter::once(spec.program.clone())
            .chain(spec.args.iter().cloned())
            .collect::<Vec<_>>()
            .join(" ");

        let run = Run {
            run_id: run_id.clone(),
            project_id: project_id.to_string(),
            project_name: project_name.to_string(),
            command_id: command_id.to_string(),
            kind: spec.kind,
            display_command,
            pid: child.id(),
            started_at: Utc::now(),
            finished_at: None,
            status: RunStatus::Running,
            exit_code: None,
        };

        self.runs.lock().unwrap().insert(
            run_id.clone(),
            RunEntry {
                run: run.clone(),
                buffer: VecDeque::new(),
                buffer_limit: self.buffer_limit,
                next_seq: 0,
                stop_requested: false,
            },
        );
        self.registry.track(&run);
        let _ = self.app.emit(EVENT_RUN, &run);

        let (tx, rx) = mpsc::channel::<(OutputStream, String)>(1024);
        if let Some(stdout) = child.stdout.take() {
            self.runtime
                .spawn(pump(stdout, OutputStream::Stdout, tx.clone()));
        }
        if let Some(stderr) = child.stderr.take() {
            self.runtime
                .spawn(pump(stderr, OutputStream::Stderr, tx.clone()));
        }
        drop(tx);

        self.runtime
            .spawn(Arc::clone(self).collect(run_id.clone(), rx));
        self.runtime
            .spawn(Arc::clone(self).supervise(run_id, child));

        Ok(run)
    }

    async fn collect(
        self: Arc<Self>,
        run_id: String,
        mut rx: mpsc::Receiver<(OutputStream, String)>,
    ) {
        let mut batch: Vec<OutputLine> = Vec::new();

        loop {
            let received = tokio::time::timeout(BATCH_INTERVAL, rx.recv()).await;

            match received {
                // A line arrived: record it and keep filling the batch.
                Ok(Some((stream, text))) => {
                    let Some(line) = self.record(&run_id, stream, text) else {
                        return; // run was removed from under us
                    };
                    batch.push(line);
                    if batch.len() < 400 {
                        continue;
                    }
                }
                // Channel closed: the process's pipes are done.
                Ok(None) => {
                    self.flush(&run_id, &mut batch);
                    return;
                }
                // Quiet for a moment — flush whatever we have.
                Err(_) => {}
            }
            self.flush(&run_id, &mut batch);
        }
    }

    fn flush(&self, run_id: &str, batch: &mut Vec<OutputLine>) {
        if batch.is_empty() {
            return;
        }
        let _ = self.app.emit(
            EVENT_OUTPUT,
            OutputBatch {
                run_id,
                lines: batch,
            },
        );
        batch.clear();
    }

    fn record(&self, run_id: &str, stream: OutputStream, text: String) -> Option<OutputLine> {
        self.runs
            .lock()
            .unwrap()
            .get_mut(run_id)
            .map(|e| e.push(stream, text))
    }

    async fn supervise(self: Arc<Self>, run_id: String, mut child: tokio::process::Child) {
        let status = child.wait().await;

        let (exit_code, note) = match status {
            Ok(status) => (
                status.code(),
                match status.code() {
                    Some(code) => format!("Process exited with code {code}"),
                    None => "Process terminated by signal".to_string(),
                },
            ),
            Err(err) => (None, format!("Failed to wait for process: {err}")),
        };

        let updated = {
            let mut runs = self.runs.lock().unwrap();
            let Some(entry) = runs.get_mut(&run_id) else {
                return;
            };
            let line = entry.push(OutputStream::System, note);
            entry.run.status = if entry.stop_requested {
                RunStatus::Stopped
            } else if exit_code == Some(0) {
                RunStatus::Succeeded
            } else {
                RunStatus::Failed
            };
            entry.run.exit_code = exit_code;
            entry.run.finished_at = Some(Utc::now());
            (entry.run.clone(), line)
        };

        let _ = self.app.emit(
            EVENT_OUTPUT,
            OutputBatch {
                run_id: &run_id,
                lines: std::slice::from_ref(&updated.1),
            },
        );
        let _ = self.app.emit(EVENT_RUN, &updated.0);

        if let Some(pid) = updated.0.pid {
            self.registry.forget(pid);
        }
        self.prune_finished();
    }

    pub fn stop(self: &Arc<Self>, run_id: &str) -> Result<()> {
        let pid = {
            let mut runs = self.runs.lock().unwrap();
            let entry = runs
                .get_mut(run_id)
                .ok_or_else(|| Error::RunNotFound(run_id.into()))?;
            if entry.run.status.is_terminal() {
                return Ok(());
            }
            entry.stop_requested = true;
            entry
                .run
                .pid
                .ok_or_else(|| Error::Other("run has no pid".into()))?
        };

        terminate_group(pid);

        let this = Arc::clone(self);
        let run_id = run_id.to_string();
        let grace = self.stop_grace;
        self.runtime.spawn(async move {
            tokio::time::sleep(grace).await;
            let still_running = this
                .runs
                .lock()
                .unwrap()
                .get(&run_id)
                .is_some_and(|e| !e.run.status.is_terminal());
            if still_running {
                kill_group(pid);
            }
        });

        Ok(())
    }

    pub fn stop_all(self: &Arc<Self>) {
        let pids: Vec<u32> = {
            let mut runs = self.runs.lock().unwrap();
            runs.values_mut()
                .filter(|e| !e.run.status.is_terminal())
                .filter_map(|e| {
                    e.stop_requested = true;
                    e.run.pid
                })
                .collect()
        };
        for pid in pids {
            terminate_group(pid);
        }
    }

    pub fn list_runs(&self) -> Vec<Run> {
        let mut runs: Vec<Run> = self
            .runs
            .lock()
            .unwrap()
            .values()
            .map(|e| e.run.clone())
            .collect();
        runs.sort_by_key(|run| std::cmp::Reverse(run.started_at));
        runs
    }

    pub fn get_output(&self, run_id: &str) -> Result<Vec<OutputLine>> {
        self.runs
            .lock()
            .unwrap()
            .get(run_id)
            .map(|e| e.buffer.iter().cloned().collect())
            .ok_or_else(|| Error::RunNotFound(run_id.into()))
    }

    pub fn clear_run(&self, run_id: &str) -> Result<()> {
        let mut runs = self.runs.lock().unwrap();
        match runs.get(run_id) {
            None => Err(Error::RunNotFound(run_id.into())),
            Some(entry) if !entry.run.status.is_terminal() => Err(Error::Other(
                "cannot clear a run that is still running".into(),
            )),
            Some(_) => {
                runs.remove(run_id);
                Ok(())
            }
        }
    }

    pub fn active_run_for(&self, project_id: &str, command_id: &str) -> Option<Run> {
        self.runs
            .lock()
            .unwrap()
            .values()
            .find(|e| {
                e.run.project_id == project_id
                    && e.run.command_id == command_id
                    && !e.run.status.is_terminal()
            })
            .map(|e| e.run.clone())
    }

    pub fn running_pids(&self) -> HashMap<u32, Run> {
        self.runs
            .lock()
            .unwrap()
            .values()
            .filter(|e| !e.run.status.is_terminal())
            .filter_map(|e| e.run.pid.map(|pid| (pid, e.run.clone())))
            .collect()
    }

    fn prune_finished(&self) {
        let mut runs = self.runs.lock().unwrap();
        let mut finished: Vec<(String, chrono::DateTime<Utc>)> = runs
            .values()
            .filter(|e| e.run.status.is_terminal())
            .map(|e| (e.run.run_id.clone(), e.run.started_at))
            .collect();
        if finished.len() <= MAX_FINISHED_RUNS {
            return;
        }
        finished.sort_by_key(|(_, started_at)| *started_at);
        for (run_id, _) in finished.iter().take(finished.len() - MAX_FINISHED_RUNS) {
            runs.remove(run_id);
        }
    }
}

async fn pump<R>(reader: R, stream: OutputStream, tx: mpsc::Sender<(OutputStream, String)>)
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if tx.send((stream, line)).await.is_err() {
            break;
        }
    }
}

#[cfg(unix)]
pub fn terminate_group(pid: u32) {
    unsafe { libc::killpg(pid as i32, libc::SIGTERM) };
}

#[cfg(unix)]
pub fn kill_group(pid: u32) {
    unsafe { libc::killpg(pid as i32, libc::SIGKILL) };
}

#[cfg(windows)]
pub fn terminate_group(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(windows)]
pub fn kill_group(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// True while a pid exists. `kill(pid, 0)` performs the permission and
    /// existence checks without delivering a signal.
    fn alive(pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }

    /// Spawns a shell that forks a background child, and returns
    /// (shell pid, grandchild pid).
    ///
    /// This is the shape that actually bites in practice: `pnpm dev` is the
    /// shell, `vite` is the grandchild, and the grandchild is what holds the
    /// port.
    async fn spawn_tree() -> (u32, i32) {
        let mut command = Command::new("sh");
        command
            .arg("-c")
            // Print the background child's pid, then block so the parent stays
            // alive too.
            .arg("sleep 120 & echo $!; wait")
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        command.process_group(0);

        let mut child = command.spawn().expect("spawn sh");
        let parent_pid = child.id().expect("child has a pid");

        let stdout = child.stdout.take().expect("piped stdout");
        let mut lines = BufReader::new(stdout).lines();
        let grandchild_pid: i32 = lines
            .next_line()
            .await
            .expect("read line")
            .expect("child printed its pid")
            .trim()
            .parse()
            .expect("pid is a number");

        // Keep the handle alive for the duration of the test.
        tokio::spawn(async move { child.wait().await });

        (parent_pid, grandchild_pid)
    }

    async fn wait_until(mut condition: impl FnMut() -> bool) -> bool {
        for _ in 0..100 {
            if condition() {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        false
    }

    #[test]
    fn spawning_outside_a_runtime_does_not_panic() {
        use crate::models::{CommandKind, CommandSpec};
        use std::collections::BTreeMap;

        let runtime = tokio::runtime::Runtime::new().expect("runtime");
        assert!(
            tokio::runtime::Handle::try_current().is_err(),
            "this test is only meaningful outside a runtime context",
        );

        let app = tauri::test::mock_app();
        let processes = Arc::new(ProcessManager::new(
            app.handle().clone(),
            100,
            1,
            runtime.handle().clone(),
            Arc::new(RunRegistry::load(&std::env::temp_dir())),
        ));

        let run = processes
            .spawn(
                "demo",
                "Demo",
                std::path::Path::new("/tmp"),
                "echo",
                &CommandSpec {
                    program: "sh".into(),
                    args: vec!["-c".into(), "echo alive".into()],
                    kind: CommandKind::Task,
                    env: BTreeMap::new(),
                    cwd: None,
                },
            )
            .expect("spawn must succeed outside a runtime");

        for _ in 0..200 {
            std::thread::sleep(Duration::from_millis(25));
            let finished = processes
                .list_runs()
                .into_iter()
                .find(|r| r.run_id == run.run_id && r.status.is_terminal());
            if let Some(finished) = finished {
                assert_eq!(finished.status, RunStatus::Succeeded);
                let output = processes.get_output(&run.run_id).expect("output");
                assert!(
                    output.iter().any(|line| line.text == "alive"),
                    "output was never collected, so the reader tasks did not run",
                );
                return;
            }
        }
        panic!("the run never finished — background tasks are not being polled");
    }

    #[test]
    fn the_runtime_handle_used_in_production_actually_runs_tasks() {
        let handle = tauri::async_runtime::handle().inner().clone();

        let (tx, rx) = std::sync::mpsc::channel();
        handle.spawn(async move {
            let _ = tx.send("polled");
        });

        assert_eq!(
            rx.recv_timeout(Duration::from_secs(5)).ok(),
            Some("polled"),
            "Tauri's runtime handle did not run the task",
        );
    }

    #[tokio::test]
    async fn terminating_the_group_also_kills_grandchildren() {
        let (parent, grandchild) = spawn_tree().await;
        assert!(alive(parent as i32), "parent should be running");
        assert!(alive(grandchild), "grandchild should be running");

        terminate_group(parent);

        assert!(
            wait_until(|| !alive(grandchild)).await,
            "grandchild {grandchild} survived the group signal — this is exactly \
             the orphaned-dev-server case the process group exists to prevent",
        );
        assert!(
            wait_until(|| !alive(parent as i32)).await,
            "parent survived"
        );
    }

    #[tokio::test]
    async fn killing_only_the_parent_pid_leaves_the_grandchild_running() {
        let (parent, grandchild) = spawn_tree().await;

        unsafe { libc::kill(parent as i32, libc::SIGTERM) };
        assert!(
            wait_until(|| !alive(parent as i32)).await,
            "parent should die"
        );

        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(
            alive(grandchild),
            "grandchild died without a group signal — the premise of this test no longer holds",
        );

        kill_group(parent);
    }
}
