use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use crate::error::{Error, Result};

pub struct CaffeinateManager {
    child: Mutex<Option<Child>>,
}

impl Default for CaffeinateManager {
    fn default() -> Self {
        Self::new()
    }
}

impl CaffeinateManager {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    pub fn is_active(&self) -> bool {
        let mut guard = self.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(Some(_status)) => {
                    *guard = None;
                    false
                }
                Ok(None) => true,
                Err(_) => {
                    *guard = None;
                    false
                }
            }
        } else {
            false
        }
    }

    pub fn start(&self) -> Result<bool> {
        let mut guard = self.child.lock().unwrap();
        if let Some(child) = guard.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok(true),
                _ => {
                    *guard = None;
                }
            }
        }

        let child = Command::new("caffeinate")
            .arg("-i")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .or_else(|_| {
                Command::new("/usr/bin/caffeinate")
                    .arg("-i")
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
            })
            .map_err(|err| Error::Other(format!("Failed to start caffeinate: {err}")))?;

        *guard = Some(child);
        Ok(true)
    }

    pub fn stop(&self) -> Result<bool> {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            #[cfg(unix)]
            {
                let pid = child.id() as libc::pid_t;
                unsafe {
                    libc::kill(pid, libc::SIGTERM);
                }
            }
            let _ = child.kill();
            let _ = child.wait();
        }
        Ok(false)
    }

    pub fn toggle(&self) -> Result<bool> {
        if self.is_active() {
            self.stop()
        } else {
            self.start()
        }
    }
}

impl Drop for CaffeinateManager {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_caffeinate_lifecycle() {
        let manager = CaffeinateManager::new();
        assert!(!manager.is_active());
        if let Ok(active) = manager.start() {
            assert!(active);
            assert!(manager.is_active());
            let stopped = manager.stop().unwrap();
            assert!(!stopped);
            assert!(!manager.is_active());
        }
    }
}
