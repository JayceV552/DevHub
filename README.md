<p align="center">
  <img src="public/devhub.svg" width="88" alt="DevHub icon">
</p>

<h1 align="center">DevHub</h1>

<p align="center">
  A desktop control center for local development.
  Run projects, inspect ports, follow logs, manage clipboard history, and keep up with GitHub activity in one place.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="AGPL-3.0 license"></a>
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/Rust-2024-000000?logo=rust&logoColor=white" alt="Rust 2024">
</p>

## Why DevHub?

DevHub answers a simple question: **what is happening in my local development environment right now?**

- Add a project and run scripts detected from `package.json` or `Cargo.toml`.
- Start, stop, and restart commands while viewing live, ANSI-colored output.
- See every listening TCP port and which project or process owns it.
- Search and reuse clipboard history across text, images, files, code, and links.
- Follow pull requests, issues, discussions, releases, and pushes in a customizable GitHub board.
- Group projects into workspaces and recover processes left behind after an unexpected exit.

## Screenshots

<table>
  <tr>
    <td width="50%">
      <img src="public/devhub-projects.jpg" alt="DevHub project manager and command output">
      <br><sub><b>Projects</b> — run commands and follow their output.</sub>
    </td>
    <td width="50%">
      <img src="public/devhub-ports.jpg" alt="DevHub port inspector">
      <br><sub><b>Ports</b> — find what is listening and who owns it.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="public/devhub-clipboard.jpg" alt="DevHub clipboard history">
      <br><sub><b>Clipboard</b> — search text, images, files, code, and links.</sub>
    </td>
    <td width="50%">
      <img src="public/devhub-github.jpg" alt="DevHub GitHub activity board">
      <br><sub><b>GitHub</b> — organize repository activity into focused columns.</sub>
    </td>
  </tr>
</table>

## Getting started

### Requirements

- Node.js 20+
- [pnpm](https://pnpm.io/)
- Rust 1.95+
- The [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

### Run locally

```bash
git clone https://github.com/JayceV552/DevHub.git
cd DevHub
pnpm install
pnpm app
```

Build a native application bundle with:

```bash
pnpm app:build
```

## GitHub access

Connect from **Settings** with GitHub's device flow or a personal access token. DevHub only reads activity data; credentials are stored in the operating system keychain.

## Development

```bash
pnpm typecheck
cd src-tauri && cargo test
```

The frontend uses React, TypeScript, and Tailwind CSS. The desktop backend is built with Tauri and Rust.

See the [roadmap](ROADMAP.md) for planned work.

## License

DevHub is licensed under the [GNU Affero General Public License v3.0](LICENSE).
