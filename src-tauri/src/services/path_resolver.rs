use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

pub struct PathResolver;

const DELIMITER: &str = "__DEVHUB_PATH__";
const PROBE_TIMEOUT: Duration = Duration::from_secs(8);

static SEARCH_PATH: OnceLock<String> = OnceLock::new();

impl PathResolver {
    pub fn search_path() -> &'static str {
        SEARCH_PATH.get_or_init(build_search_path)
    }

    pub fn resolve_program(program: &str) -> Option<PathBuf> {
        if program.contains(std::path::MAIN_SEPARATOR) {
            let path = PathBuf::from(program);
            return is_executable(&path).then_some(path);
        }

        std::env::split_paths(Self::search_path()).find_map(|dir| {
            let candidate = dir.join(program);
            if is_executable(&candidate) {
                return Some(candidate);
            }
            #[cfg(windows)]
            for extension in windows_extensions() {
                let candidate = dir.join(format!("{program}{extension}"));
                if is_executable(&candidate) {
                    return Some(candidate);
                }
            }
            None
        })
    }

    pub fn login_shell() -> String {
        std::env::var("SHELL").unwrap_or_else(|_| "sh".to_string())
    }
}

fn build_search_path() -> String {
    let mut dirs: Vec<PathBuf> = Vec::new();

    if let Some(from_shell) = probe_login_shell() {
        extend(&mut dirs, &from_shell);
    }
    if let Ok(inherited) = std::env::var("PATH") {
        extend(&mut dirs, &inherited);
    }

    std::env::join_paths(&dirs)
        .map(|joined| joined.to_string_lossy().into_owned())
        .unwrap_or_else(|_| std::env::var("PATH").unwrap_or_default())
}

fn extend(dirs: &mut Vec<PathBuf>, value: &str) {
    for dir in std::env::split_paths(value) {
        if !dir.as_os_str().is_empty() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
}

#[cfg(unix)]
fn probe_login_shell() -> Option<String> {
    let shell = PathResolver::login_shell();
    let script = format!("printf '{DELIMITER}%s{DELIMITER}' \"$PATH\"");

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = std::process::Command::new(&shell)
            .args(["-ilc", &script])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output();
        let _ = tx.send(result);
    });

    let output = rx.recv_timeout(PROBE_TIMEOUT).ok()?.ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    let value = stdout.split(DELIMITER).nth(1)?.trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// Windows GUI processes inherit a usable `PATH`, so there is nothing to probe.
#[cfg(windows)]
fn probe_login_shell() -> Option<String> {
    None
}

#[cfg(windows)]
fn windows_extensions() -> Vec<String> {
    std::env::var("PATHEXT")
        .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
        .split(';')
        .filter(|e| !e.is_empty())
        .map(|e| e.to_ascii_lowercase())
        .collect()
}

#[cfg(unix)]
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata()
        .map(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(windows)]
fn is_executable(path: &Path) -> bool {
    path.is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_a_program_that_is_definitely_installed() {
        let resolved = PathResolver::resolve_program("sh").expect("sh must exist");
        assert!(resolved.is_absolute());
        assert!(is_executable(&resolved));
    }

    #[test]
    fn an_absolute_path_is_used_as_given() {
        assert_eq!(
            PathResolver::resolve_program("/bin/sh"),
            Some(PathBuf::from("/bin/sh")),
        );
        // ...but only when it actually points at something runnable.
        assert_eq!(
            PathResolver::resolve_program("/bin/definitely-not-here"),
            None
        );
    }

    #[test]
    fn a_missing_program_resolves_to_none() {
        assert_eq!(PathResolver::resolve_program("devhub-no-such-binary"), None);
    }

    /// A directory named like the program must not be mistaken for it.
    #[test]
    fn a_directory_is_not_executable() {
        assert!(!is_executable(Path::new("/tmp")));
    }

    #[test]
    fn the_search_path_is_never_empty() {
        let path = PathResolver::search_path();
        assert!(!path.is_empty());
        assert!(
            std::env::split_paths(path).any(|dir| dir == Path::new("/bin")),
            "expected /bin in the search path, got: {path}",
        );
    }

    /// The merge must not produce repeated entries, or the resolved PATH
    /// becomes unreadable in the settings UI.
    #[test]
    fn merged_entries_are_deduplicated() {
        let mut dirs = Vec::new();
        extend(&mut dirs, "/usr/bin:/bin:/usr/bin");
        extend(&mut dirs, "/bin:/usr/local/bin");
        assert_eq!(
            dirs,
            vec![
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
                PathBuf::from("/usr/local/bin"),
            ],
        );
    }
}
