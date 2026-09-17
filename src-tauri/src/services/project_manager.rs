use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};
use crate::models::{CommandKind, CommandSpec, Project, ProjectScan};

pub struct ProjectManager;

impl ProjectManager {
    pub fn scan(path: &Path) -> Result<ProjectScan> {
        if !path.is_dir() {
            return Err(Error::NotADirectory(path.display().to_string()));
        }
        let path = dunce::canonicalize(path)?;

        let mut commands = BTreeMap::new();
        let mut detected_from = Vec::new();

        if let Some((manager, scripts)) = Self::detect_node(&path) {
            detected_from.push(format!("package.json ({manager})"));
            for name in scripts {
                commands.insert(
                    name.clone(),
                    CommandSpec {
                        program: manager.to_string(),
                        args: if manager == "npm" {
                            vec!["run".into(), name.clone()]
                        } else {
                            vec![name.clone()]
                        },
                        kind: CommandKind::guess_from_name(&name),
                        env: BTreeMap::new(),
                        cwd: None,
                    },
                );
            }
        }

        if path.join("Cargo.toml").is_file() {
            detected_from.push("Cargo.toml".to_string());
            for (name, args, kind) in [
                ("run", vec!["run"], CommandKind::Service),
                ("test", vec!["test"], CommandKind::Task),
                ("build", vec!["build"], CommandKind::Task),
                ("check", vec!["check"], CommandKind::Task),
                ("clippy", vec!["clippy"], CommandKind::Task),
            ] {
                commands
                    .entry(format!("cargo:{name}"))
                    .or_insert(CommandSpec {
                        program: "cargo".into(),
                        args: args.into_iter().map(String::from).collect(),
                        kind,
                        env: BTreeMap::new(),
                        cwd: None,
                    });
            }
        }

        if let Some((detected_file, program, tasks)) = Self::detect_gradle(&path) {
            detected_from.push(format!("{detected_file} (gradle)"));
            for (name, args, kind) in tasks {
                commands
                    .entry(format!("gradle:{name}"))
                    .or_insert(CommandSpec {
                        program: program.clone(),
                        args: args.into_iter().map(String::from).collect(),
                        kind,
                        env: BTreeMap::new(),
                        cwd: None,
                    });
            }
        }

        if let Some((program, tasks)) = Self::detect_maven(&path) {
            detected_from.push("pom.xml (maven)".to_string());
            for (name, args, kind) in tasks {
                commands
                    .entry(format!("mvn:{name}"))
                    .or_insert(CommandSpec {
                        program: program.clone(),
                        args: args.into_iter().map(String::from).collect(),
                        kind,
                        env: BTreeMap::new(),
                        cwd: None,
                    });
            }
        }

        if let Some((manager, tasks)) = Self::detect_dart(&path) {
            detected_from.push(format!("pubspec.yaml ({manager})"));
            for (name, program, args, kind) in tasks {
                commands
                    .entry(format!("{manager}:{name}"))
                    .or_insert(CommandSpec {
                        program,
                        args,
                        kind,
                        env: BTreeMap::new(),
                        cwd: None,
                    });
            }
        }

        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Untitled".to_string());

        Ok(ProjectScan {
            repository: Self::read_remote(&path),
            branch: Self::read_branch(&path),
            name,
            path,
            detected_from,
            commands,
        })
    }

    fn detect_node(path: &Path) -> Option<(&'static str, Vec<String>)> {
        let text = std::fs::read_to_string(path.join("package.json")).ok()?;
        let json: serde_json::Value = serde_json::from_str(&text).ok()?;

        let scripts = json
            .get("scripts")
            .and_then(|s| s.as_object())
            .map(|map| map.keys().cloned().collect())
            .unwrap_or_default();

        Some((Self::detect_package_manager(path, &json), scripts))
    }

    fn detect_package_manager(path: &Path, package_json: &serde_json::Value) -> &'static str {
        for (lockfile, manager) in [
            ("pnpm-lock.yaml", "pnpm"),
            ("bun.lockb", "bun"),
            ("bun.lock", "bun"),
            ("yarn.lock", "yarn"),
            ("package-lock.json", "npm"),
        ] {
            if path.join(lockfile).exists() {
                return manager;
            }
        }
        match package_json
            .get("packageManager")
            .and_then(|v| v.as_str())
            .and_then(|v| v.split('@').next())
        {
            Some("pnpm") => "pnpm",
            Some("yarn") => "yarn",
            Some("bun") => "bun",
            _ => "npm",
        }
    }

    fn detect_gradle(
        path: &Path,
    ) -> Option<(String, String, Vec<(&'static str, Vec<&'static str>, CommandKind)>)> {
        let (file_name, file_path) = if path.join("build.gradle.kts").is_file() {
            ("build.gradle.kts".to_string(), path.join("build.gradle.kts"))
        } else if path.join("build.gradle").is_file() {
            ("build.gradle".to_string(), path.join("build.gradle"))
        } else {
            return None;
        };

        let program = if path.join("gradlew").is_file() {
            if cfg!(windows) {
                "gradlew.bat".to_string()
            } else {
                "./gradlew".to_string()
            }
        } else {
            "gradle".to_string()
        };

        let content = std::fs::read_to_string(&file_path).unwrap_or_default();
        let mut tasks = Vec::new();

        if content.contains("org.springframework.boot") || content.contains("spring-boot") {
            tasks.push(("bootRun", vec!["bootRun"], CommandKind::Service));
        }
        tasks.push(("run", vec!["run"], CommandKind::Service));
        tasks.push(("build", vec!["build"], CommandKind::Task));
        tasks.push(("test", vec!["test"], CommandKind::Task));
        tasks.push(("clean", vec!["clean"], CommandKind::Task));

        Some((file_name, program, tasks))
    }

    fn detect_maven(
        path: &Path,
    ) -> Option<(String, Vec<(&'static str, Vec<&'static str>, CommandKind)>)> {
        let pom = path.join("pom.xml");
        if !pom.is_file() {
            return None;
        }

        let program = if path.join("mvnw").is_file() {
            if cfg!(windows) {
                "mvnw.cmd".to_string()
            } else {
                "./mvnw".to_string()
            }
        } else {
            "mvn".to_string()
        };

        let content = std::fs::read_to_string(&pom).unwrap_or_default();
        let mut tasks = Vec::new();

        if content.contains("spring-boot") {
            tasks.push(("spring-boot:run", vec!["spring-boot:run"], CommandKind::Service));
        }
        if content.contains("quarkus") {
            tasks.push(("quarkus:dev", vec!["quarkus:dev"], CommandKind::Service));
        }
        tasks.push(("compile", vec!["compile"], CommandKind::Task));
        tasks.push(("test", vec!["test"], CommandKind::Task));
        tasks.push(("package", vec!["package"], CommandKind::Task));
        tasks.push(("clean", vec!["clean"], CommandKind::Task));

        Some((program, tasks))
    }

    fn detect_dart(
        path: &Path,
    ) -> Option<(&'static str, Vec<(String, String, Vec<String>, CommandKind)>)> {
        let pubspec = path.join("pubspec.yaml");
        let content = std::fs::read_to_string(&pubspec).ok()?;

        let is_flutter = content.contains("sdk: flutter")
            || content
                .lines()
                .any(|l| l.trim() == "flutter:" || l.contains("flutter_test:"));
        let manager = if is_flutter { "flutter" } else { "dart" };

        let mut tasks = Vec::new();
        tasks.push((
            "run".to_string(),
            manager.to_string(),
            vec!["run".to_string()],
            CommandKind::Service,
        ));
        tasks.push((
            "test".to_string(),
            manager.to_string(),
            vec!["test".to_string()],
            CommandKind::Task,
        ));
        if is_flutter {
            tasks.push((
                "build".to_string(),
                "flutter".to_string(),
                vec!["build".to_string()],
                CommandKind::Task,
            ));
        }
        tasks.push((
            "analyze".to_string(),
            manager.to_string(),
            vec!["analyze".to_string()],
            CommandKind::Task,
        ));
        tasks.push((
            "pub:get".to_string(),
            manager.to_string(),
            vec!["pub".to_string(), "get".to_string()],
            CommandKind::Task,
        ));

        if content.contains("build_runner") {
            if is_flutter {
                tasks.push((
                    "build_runner".to_string(),
                    "flutter".to_string(),
                    vec![
                        "pub".to_string(),
                        "run".to_string(),
                        "build_runner".to_string(),
                        "build".to_string(),
                        "--delete-conflicting-outputs".to_string(),
                    ],
                    CommandKind::Task,
                ));
                tasks.push((
                    "build_runner:watch".to_string(),
                    "flutter".to_string(),
                    vec![
                        "pub".to_string(),
                        "run".to_string(),
                        "build_runner".to_string(),
                        "watch".to_string(),
                        "--delete-conflicting-outputs".to_string(),
                    ],
                    CommandKind::Service,
                ));
            } else {
                tasks.push((
                    "build_runner".to_string(),
                    "dart".to_string(),
                    vec![
                        "run".to_string(),
                        "build_runner".to_string(),
                        "build".to_string(),
                        "--delete-conflicting-outputs".to_string(),
                    ],
                    CommandKind::Task,
                ));
                tasks.push((
                    "build_runner:watch".to_string(),
                    "dart".to_string(),
                    vec![
                        "run".to_string(),
                        "build_runner".to_string(),
                        "watch".to_string(),
                        "--delete-conflicting-outputs".to_string(),
                    ],
                    CommandKind::Service,
                ));
            }
        }

        let mut in_scripts = false;
        for line in content.lines() {
            let trimmed = line.trim_end();
            if trimmed.is_empty() || trimmed.trim_start().starts_with('#') {
                continue;
            }
            if !line.starts_with(' ') && !line.starts_with('\t') {
                in_scripts = trimmed.starts_with("scripts:");
                continue;
            }
            if in_scripts {
                if let Some((name, cmd)) = line.trim().split_once(':') {
                    let name = name.trim();
                    let cmd = cmd.trim().trim_matches('"').trim_matches('\'');
                    if !name.is_empty() && !cmd.is_empty() {
                        let parts: Vec<String> =
                            cmd.split_whitespace().map(String::from).collect();
                        if let Some((first, rest)) = parts.split_first() {
                            tasks.push((
                                name.to_string(),
                                first.clone(),
                                rest.to_vec(),
                                CommandKind::guess_from_name(name),
                            ));
                        }
                    }
                }
            }
        }

        Some((manager, tasks))
    }

    pub fn read_branch(path: &Path) -> Option<String> {
        let head = std::fs::read_to_string(Self::git_dir(path)?.join("HEAD")).ok()?;
        head.trim()
            .strip_prefix("ref: refs/heads/")
            .map(String::from)
    }

    pub fn read_remote(path: &Path) -> Option<String> {
        let config = std::fs::read_to_string(Self::git_dir(path)?.join("config")).ok()?;

        let mut in_origin = false;
        for line in config.lines() {
            let line = line.trim();
            if line.starts_with('[') {
                in_origin = line == r#"[remote "origin"]"#;
                continue;
            }
            if !in_origin {
                continue;
            }
            let Some(url) = line.strip_prefix("url = ").or(line.strip_prefix("url=")) else {
                continue;
            };
            return Self::parse_github_slug(url.trim());
        }
        None
    }

    fn parse_github_slug(url: &str) -> Option<String> {
        let rest = url
            .strip_prefix("git@github.com:")
            .or_else(|| url.strip_prefix("https://github.com/"))
            .or_else(|| url.strip_prefix("ssh://git@github.com/"))?;
        let slug = rest.trim_end_matches('/').trim_end_matches(".git");
        let mut parts = slug.split('/');
        let owner = parts.next().filter(|s| !s.is_empty())?;
        let repo = parts.next().filter(|s| !s.is_empty())?;
        Some(format!("{owner}/{repo}"))
    }

    fn git_dir(path: &Path) -> Option<PathBuf> {
        let dot_git = path.join(".git");
        if dot_git.is_dir() {
            return Some(dot_git);
        }
        let pointer = std::fs::read_to_string(&dot_git).ok()?;
        let target = pointer.trim().strip_prefix("gitdir: ")?;
        let target = Path::new(target);
        Some(if target.is_absolute() {
            target.to_path_buf()
        } else {
            path.join(target)
        })
    }

    pub fn make_id(name: &str, existing: &[Project]) -> String {
        let base: String = name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect::<String>()
            .split('-')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        let base = if base.is_empty() {
            "project".to_string()
        } else {
            base
        };

        let taken = |candidate: &str| existing.iter().any(|p| p.id == candidate);
        if !taken(&base) {
            return base;
        }
        (2..)
            .map(|n| format!("{base}-{n}"))
            .find(|c| !taken(c))
            .expect("infinite range")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_both_github_url_forms() {
        let cases = [
            "git@github.com:dayflow-js/calendar.git",
            "https://github.com/dayflow-js/calendar.git",
            "https://github.com/dayflow-js/calendar",
            "ssh://git@github.com/dayflow-js/calendar.git",
        ];
        for url in cases {
            assert_eq!(
                ProjectManager::parse_github_slug(url).as_deref(),
                Some("dayflow-js/calendar"),
                "failed on {url}"
            );
        }
        assert_eq!(
            ProjectManager::parse_github_slug("https://gitlab.com/a/b"),
            None
        );
    }

    #[test]
    fn slugifies_and_deduplicates_ids() {
        assert_eq!(
            ProjectManager::make_id("DayFlow Calendar", &[]),
            "dayflow-calendar"
        );
        assert_eq!(ProjectManager::make_id("  ***  ", &[]), "project");

        let existing = vec![Project {
            id: "dayflow-pro".into(),
            name: "DayFlow Pro".into(),
            path: PathBuf::from("/tmp"),
            repository: None,
            group: None,
            commands: BTreeMap::new(),
        }];
        assert_eq!(
            ProjectManager::make_id("DayFlow Pro", &existing),
            "dayflow-pro-2"
        );
    }

    #[test]
    fn classifies_service_versus_task_scripts() {
        assert_eq!(CommandKind::guess_from_name("dev"), CommandKind::Service);
        assert_eq!(
            CommandKind::guess_from_name("start:api"),
            CommandKind::Service
        );
        assert_eq!(CommandKind::guess_from_name("test"), CommandKind::Task);
        assert_eq!(CommandKind::guess_from_name("typecheck"), CommandKind::Task);
    }
}
