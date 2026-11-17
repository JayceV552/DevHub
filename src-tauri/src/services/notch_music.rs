//! Long-lived now-playing stream.
//!
//! Instead of spawning the Swift helper once per poll (≈70ms of process
//! start-up each time, plus re-encoding artwork), DevHub keeps one
//! `devhub-notch-helper music-stream` child alive. The helper samples
//! MediaRemote in-process and only writes a JSON line when something visible
//! changes; each line is cached here and pushed to the notch webview.
//!
//! The helper exits on its own when its stdin closes, so it never outlives
//! DevHub even if we crash.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::models::MusicStatus;

pub const MUSIC_EVENT: &str = "devhub://notch-music";
const RESTART_DELAY: Duration = Duration::from_secs(3);
const MAX_FAST_FAILURES: u32 = 5;

#[derive(Default)]
pub struct MusicStream {
    started: AtomicBool,
    latest: Arc<Mutex<Option<MusicStatus>>>,
}

impl MusicStream {
    pub fn latest(&self) -> Option<MusicStatus> {
        self.latest.lock().unwrap().clone()
    }

    /// Starts the background reader once; later calls are no-ops.
    pub fn start(&self, app: &AppHandle, helper: PathBuf) {
        if self.started.swap(true, Ordering::SeqCst) {
            return;
        }
        let latest = Arc::clone(&self.latest);
        let app = app.clone();
        let spawn = thread::Builder::new()
            .name("notch-music".into())
            .spawn(move || run(&app, &helper, &latest));
        if spawn.is_err() {
            self.started.store(false, Ordering::SeqCst);
        }
    }
}

fn run(app: &AppHandle, helper: &PathBuf, latest: &Mutex<Option<MusicStatus>>) {
    let mut fast_failures = 0;
    loop {
        let started = std::time::Instant::now();
        if let Err(err) = stream_once(app, helper, latest) {
            eprintln!("[notch] music stream error: {err}");
        }
        // A helper that keeps dying immediately (e.g. MediaRemote missing)
        // shouldn't be respawned forever.
        if started.elapsed() < Duration::from_secs(5) {
            fast_failures += 1;
            if fast_failures >= MAX_FAST_FAILURES {
                eprintln!("[notch] music stream disabled after repeated failures");
                return;
            }
        } else {
            fast_failures = 0;
        }
        thread::sleep(RESTART_DELAY);
    }
}

fn stream_once(
    app: &AppHandle,
    helper: &PathBuf,
    latest: &Mutex<Option<MusicStatus>>,
) -> std::io::Result<()> {
    // stdin is held open (and never written) so the helper can detect our exit.
    let mut child = Command::new(helper)
        .arg("music-stream")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()?;

    let stdout = child.stdout.take().expect("piped stdout");
    for line in BufReader::new(stdout).lines() {
        let line = line?;
        let Ok(status) = serde_json::from_str::<MusicStatus>(&line) else {
            continue;
        };
        *latest.lock().unwrap() = Some(status.clone());
        let _ = app.emit_to("notch", MUSIC_EVENT, &status);
    }
    let _ = child.kill();
    let _ = child.wait();
    Ok(())
}
