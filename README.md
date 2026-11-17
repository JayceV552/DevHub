<p align="center">
  <img src="public/devhub.svg" width="88" alt="DevHub icon">
</p>

<h1 align="center">DevHub</h1>

<p align="center">
  A desktop control center for local development.
  Run projects, inspect ports, follow logs, manage clipboard history, and keep up with GitHub activity in one place —
  plus a notch island on macOS for music, calendar, and menu bar apps.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue.svg" alt="AGPL-3.0 license"></a>
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/Rust-2024-000000?logo=rust&logoColor=white" alt="Rust 2024">
</p>

## Why DevHub?

DevHub answers a simple question: **what is happening in my local development environment right now?**

Add a project and run scripts detected from `package.json` or `Cargo.toml`.<br>
Start, stop, and restart commands while viewing live ANSI colored output.<br>
See every listening TCP port and which project or process owns it.<br>
Search and reuse clipboard history across text, images, files, code, and links.<br>
Follow pull requests, issues, discussions, releases, and pushes in a customizable GitHub board.<br>
Keep personal todos beside repository issues in a focused Todo Board.<br>
Group projects into workspaces and recover processes left behind after an unexpected exit.<br>
On MacBooks with a notch, hover the notch for now playing, your calendar, and menu bar apps hidden behind it.<br>
Use DevHub in English or Simplified Chinese; switching in Settings applies instantly.

## Notch island (macOS)

Hover the camera notch to open a small control center. It stays out of the way until you need it.

![DevHub notch island: music and calendar](public/devhub-notch-home-en.png)

**Now playing.** Album artwork, the playing app, progress, and playback controls for any app that reports to macOS Now Playing (Music, Spotify, Telegram, browsers, podcasts…). While something plays, the collapsed notch shows the artwork and a live equalizer tinted from the cover.

![Collapsed notch with artwork and equalizer](public/devhub-notch-collapsed.png)

**Calendar.** A five-day strip with today's events from the macOS Calendar (asked for on first use). In Chinese, the lunar date is shown too.

**Menu bar apps.** On a notched display, menu bar icons that don't fit end up hidden behind the camera. The Apps tab lists every menu bar app: click to bring one to the front, right-click to quit.

![Notch apps tab](public/devhub-notch-apps-en.png)

**DevHub at a glance.** Active ports, running scripts, and a keep-awake switch (`caffeinate -i`).

![Notch DevHub overview](public/devhub-notch-devhub-en.png)

Turn the notch on or off under **Settings → Notch**.

## Language

DevHub ships in English and Simplified Chinese. Pick one under **Settings → Language**; the main window and the notch update immediately.

![Notch in Simplified Chinese with the lunar date](public/devhub-notch-home-zh.png)

## Screenshots

### Todo Board

Keep personal tasks and GitHub issues together on a focused pinboard.

![DevHub Todo Board](public/devhub-overview.jpg)

### Issue Folder

Open a repository folder to browse its latest issues without leaving the board.

![DevHub Issue Folder](public/devhub-issue-folder.jpg)

### Projects

Run project commands and follow their output.

![DevHub project manager and command output](public/devhub-projects.jpg)

### Ports

Find listening ports and identify the project or process that owns each one.

![DevHub port inspector](public/devhub-ports.jpg)

### Clipboard

Search clipboard history across text, images, files, code, and links.

![DevHub clipboard history](public/devhub-clipboard.jpg)

### GitHub Activity

Organize repository activity into focused and customizable columns.

![DevHub GitHub activity board](public/devhub-github.jpg)

## Getting started

### Requirements

Node.js 20+<br>
[pnpm](https://pnpm.io/)<br>
Rust 1.95+<br>
The [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform<br>
On macOS, Xcode Command Line Tools (`swiftc`) to build the notch helper

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

On macOS, `src-tauri/build.rs` also compiles a small Swift helper (`src-tauri/native/notch-helper`) that reads notch geometry, menu bar apps, Now Playing, and calendar events. It is built automatically and bundled with the app; the binary is not committed.

UI text is translated with `t("English source")` from `src/lib/i18n`. Add the Chinese string to `src/lib/i18n/zh.ts`; anything missing falls back to English.

See the [roadmap](ROADMAP.md) for planned work.

## License

DevHub is licensed under the [GNU Affero General Public License v3.0](LICENSE).
