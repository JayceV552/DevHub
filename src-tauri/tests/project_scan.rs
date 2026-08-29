use std::fs;

use devhub_lib::testing::{CommandKind, ProjectManager};

fn fixture() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path();

    fs::write(
        path.join("package.json"),
        r#"{
            "name": "calendar",
            "scripts": {
                "dev": "vite",
                "build": "vite build",
                "test": "vitest run",
                "typecheck": "tsc --noEmit"
            }
        }"#,
    )
    .unwrap();
    fs::write(path.join("pnpm-lock.yaml"), "lockfileVersion: '9.0'\n").unwrap();

    fs::create_dir(path.join(".git")).unwrap();
    fs::write(path.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
    fs::write(
        path.join(".git/config"),
        "[core]\n\trepositoryformatversion = 0\n\
         [remote \"origin\"]\n\turl = git@github.com:dayflow-js/calendar.git\n",
    )
    .unwrap();

    dir
}

#[test]
fn detects_pnpm_scripts_branch_and_remote() {
    let dir = fixture();
    let scan = ProjectManager::scan(dir.path()).expect("scan");

    assert_eq!(scan.repository.as_deref(), Some("dayflow-js/calendar"));
    assert_eq!(scan.branch.as_deref(), Some("main"));
    assert!(
        scan.detected_from.iter().any(|s| s.contains("pnpm")),
        "should have identified pnpm from the lockfile, got {:?}",
        scan.detected_from,
    );

    let mut names: Vec<&str> = scan.commands.keys().map(String::as_str).collect();
    names.sort_unstable();
    assert_eq!(names, ["build", "dev", "test", "typecheck"]);

    assert_eq!(scan.commands["dev"].kind, CommandKind::Service);
    assert_eq!(scan.commands["test"].kind, CommandKind::Task);
    assert_eq!(scan.commands["build"].kind, CommandKind::Task);

    assert_eq!(scan.commands["dev"].program, "pnpm");
    assert_eq!(scan.commands["dev"].args, vec!["dev"]);
}

#[test]
fn npm_projects_get_a_run_prefix() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("package.json"),
        r#"{"scripts": {"typecheck": "tsc"}}"#,
    )
    .unwrap();
    fs::write(dir.path().join("package-lock.json"), "{}").unwrap();

    let scan = ProjectManager::scan(dir.path()).expect("scan");
    assert_eq!(scan.commands["typecheck"].program, "npm");
    assert_eq!(scan.commands["typecheck"].args, vec!["run", "typecheck"]);
}

#[test]
fn a_cargo_project_gets_cargo_commands() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();

    let scan = ProjectManager::scan(dir.path()).expect("scan");
    assert_eq!(scan.commands["cargo:run"].program, "cargo");
    assert_eq!(scan.commands["cargo:run"].kind, CommandKind::Service);
    assert_eq!(scan.commands["cargo:test"].kind, CommandKind::Task);
}

#[test]
fn cargo_defaults_do_not_clobber_package_json_scripts() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join("package.json"),
        r#"{"scripts": {"build": "vite build", "test": "vitest"}}"#,
    )
    .unwrap();
    fs::write(dir.path().join("pnpm-lock.yaml"), "").unwrap();
    fs::write(dir.path().join("Cargo.toml"), "[package]\nname = \"x\"\n").unwrap();

    let scan = ProjectManager::scan(dir.path()).expect("scan");
    assert_eq!(
        scan.commands["build"].program, "pnpm",
        "npm script was overwritten"
    );
    assert_eq!(scan.commands["cargo:build"].program, "cargo");
}

#[test]
fn scanning_a_file_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("not-a-dir.txt");
    fs::write(&file, "x").unwrap();

    assert!(ProjectManager::scan(&file).is_err());
}
