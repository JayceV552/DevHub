# Roadmap

The order is chosen so the app is useful as early as possible. It became genuinely
useful at step 4.

- [x] **1. Project config + Add Project** — folder picker, `package.json` / `Cargo.toml`
      detection, TOML persistence.
- [x] **2. ProcessManager** — start/stop/restart, run status, process-group termination.
- [x] **3. Output panel** — live stdout/stderr, ANSI colour, per-run tabs.
- [x] **4. Ports** — listening ports, PID and process name, attribution to projects.
- [x] **5. Task vs. service** — one-shot commands distinguished from dev servers.
- [x] **6. Workspaces** — group projects, start/stop all.
- [x] **6b. Theming** — dark / light / system, including the terminal palette.
- [x] **6c. Orphan recovery** — find and stop processes left behind by an unclean exit.
- [x] **7. GitHub Activity** — PRs, issues, discussions and releases merged into one
      time-ordered feed via the GraphQL API, credential in the OS keychain.
- [x] **7a. Sign in with GitHub** — device flow, no client secret and no backend.
      Works with a GitHub App (read-only permissions, refreshed tokens) or an OAuth
      App. A pasted token still works for anyone who would rather not register one.
- [x] **7b. Filters** — Ports by process type and owner; the terminal scoped to the
      selected project.
- [x] **7c. Activity board** — multi-column layout with per-column filters, unread
      counts and saved items.
- [ ] **8. Polish** — keyboard shortcuts, system tray, notifications on failure,
      persistent run history (SQLite), an interactive PTY terminal (xterm.js),
      per-project environment overrides and a node-version picker.

## Deliberately not doing

- **A second GitHub client.** No PR review, no issue management, no Actions UI. One
  activity feed, read-only.
- **A full terminal, for now.** The output panel is a log viewer. PTY + xterm.js only
  once there is a real need to type into a running process.
- **SQLite from day one.** A single TOML file is enough until there is history worth
  querying.
