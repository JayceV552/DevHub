# DevHub

A local development workspace: what am I running, on which ports, and did it pass?

DevHub is a desktop app that keeps track of your projects, starts and stops their
commands, streams the output, and tells you which project owns which port. It is not
an editor and not a DevOps platform — it answers one question well:

> What is the state of my development environment right now?

## Status

Working today:

- **Projects** — add a folder; DevHub reads `package.json` scripts (detecting
  pnpm/yarn/npm/bun from the lockfile) or `Cargo.toml`, plus the git branch and
  GitHub remote, and turns each script into a button.
- **Process manager** — start/stop/restart commands, with long-running services
  distinguished from one-shot tasks. Stopping signals the whole **process group**,
  so `pnpm dev → node → vite` dies as a unit instead of orphaning the child that
  holds the port.
- **Output panel** — live stdout/stderr with ANSI colour, tabbed per run, with
  clickable `localhost:` links.
- **Ports** — every listening TCP port, attributed back to the project that owns it
  by walking each socket's parent chain. Ports DevHub started can be stopped
  directly; external ones (Postgres, Redis, Docker) require confirmation.
- **Workspaces** — group projects and start or stop them together.
- **GitHub Activity** — a multi-column board of saved queries with quick filters and a keyboard-friendly detail drawer.
  Each column has its own filters (repository, kind, state, text, hide bots), its own
  unread count and a mark-all-read. Items can be saved for later. Read only, by design.
- **Orphan recovery** — if DevHub is force-quit or crashes, the processes it started
  survive in their own groups. They are recorded on disk, found on the next launch,
  and can be stopped from a banner instead of hunted down with `ps`.
- **Theme** — dark, light, or follow the system appearance. The terminal's ANSI
  palette switches with it, so coloured build output stays readable on both.

Not built yet: the interactive PTY terminal, and persistent run history.
See [ROADMAP.md](ROADMAP.md).

## Running it

```bash
pnpm install
pnpm app
```

`pnpm app` runs `tauri dev`, which starts Vite on port 1420 and the Rust side
together. `pnpm app:build` produces a bundled `.app`.

Requires Rust 1.95+ (edition 2024) and Node 20+.

## Configuration

Everything lives in one TOML file, safe to edit by hand:

```
~/Library/Application Support/com.devhub.app/config.toml
```

```toml
[[projects]]
id = "dayflow-calendar"
name = "DayFlow Calendar"
path = "/Users/me/projects/dayflow/calendar"
repository = "dayflow-js/calendar"
group = "DayFlow"

[projects.commands.dev]
program = "pnpm"
args = ["dev"]
kind = "service"

[projects.commands.test]
program = "pnpm"
args = ["test"]
kind = "task"
```

Commands are stored as **program + args**, never as a raw shell string. Nothing is
handed to `sh -c`, so there is no quoting or injection surface, and the same config
works across platforms.

`kind` decides behaviour: a `service` is expected to keep running and hold a port; a
`task` is expected to exit, and its exit code is the result.

## Finding your tools

A desktop app launched from Finder does **not** inherit your shell's `PATH` — macOS
gives it launchd's minimal `/usr/bin:/bin:/usr/sbin:/sbin`. Anything installed by a
version manager (nvm, fnm, volta, asdf) lives in a directory that only exists on
`PATH` because a shell profile put it there, so `npm` and `pnpm` disappear the moment
the app is opened normally rather than from a terminal.

DevHub asks a login shell for its `PATH` once at startup and uses that, merged with
whatever it inherited. Settings shows the resolved list, which is the first place to
look if a command is not found.

## Connecting GitHub

Sign in from Settings, or paste a personal access token.

Sign-in uses the **device flow**, and the reason is worth recording. GitHub added PKCE
support in 2025, but it still requires `client_secret` when redeeming an authorization
code — it does not distinguish public from confidential clients — so PKCE alone does
not exempt a desktop app, and a secret shipped inside a binary is not a secret. The
usual workaround is to run a backend that holds the secret and proxies the exchange
(this is what the unrelated devhubapp.com does). The device flow needs only a client
ID, and its token refresh is documented as not requiring the secret either, so a local
tool can use it with no server and nothing to leak.

If this build ships a client ID, there is nothing to set up — press **Sign in with
GitHub** and you are done. Otherwise, register an app once and paste its Client ID
into Settings:

- **GitHub App** — Settings → Developer settings → GitHub Apps. Grant read-only access
  to Issues, Pull requests, Discussions and Metadata. Tokens last 8 hours and are
  refreshed automatically.
- **OAuth App** — simpler to register, tokens do not expire, but the `repo` scope is
  all-or-nothing: GitHub's OAuth scopes have no read-only variant.

Either way, tick **Enable Device Flow** in the app's settings. The Client ID is not a
secret and lives in `config.toml`; the token itself goes to the OS keychain.

### Shipping a client ID with a build

A published build can carry its own client ID so nobody has to register anything.
Either set `BUNDLED_CLIENT_ID` in `src-tauri/src/services/github_auth.rs`, or pass it
at build time:

```bash
DEVHUB_GITHUB_CLIENT_ID=Iv23li… pnpm tauri build
```

A user-configured ID always wins over the bundled one — someone who registered their
own app did so deliberately, usually to grant narrower permissions than the shipped
app asks for.

Two things to know before making an app public (**Any account**):

- Rate limits for user access tokens are counted **per user**, not per app, so a
  popular build does not exhaust a shared pool.
- Installing a GitHub App means the app *could* mint installation tokens for the
  user's repositories — but only by signing a JWT with the app's **private key**,
  which is generated on demand and does not exist until you create one. DevHub's
  device flow never needs one, so not generating a key makes that access
  impossible rather than merely promised.

## The keychain prompt during development

An unsigned build asks for your keychain password on every launch. This is not a bug
in the token storage — it is what an **ad-hoc signature** means.

A keychain item records which application may read it, and identifies that application
by its code signature. `cargo build` produces an ad-hoc signature whose entire identity
is a hash of the binary:

```
Signature=adhoc
# designated => cdhash H"37e05160544ce8241e26451294c2f30a2dc254c1"
```

Clicking **Always Allow** records *that hash*. The next rebuild produces a different
binary, therefore a different hash, therefore — as far as the keychain is concerned —
a different application that has never been granted access.

A signed build does not have this problem: its identity is the certificate plus the
bundle identifier, which survives rebuilds. For local development a self-signed
code-signing certificate is enough:

1. Keychain Access → Certificate Assistant → **Create a Certificate…**
2. Name it (e.g. `DevHub Local`), Identity Type **Self Signed Root**, Certificate Type
   **Code Signing**.
3. Build with it:

```bash
APPLE_SIGNING_IDENTITY="DevHub Local" pnpm tauri build --debug --bundles app
```

Then **Always Allow** sticks across rebuilds. For a distributed build, an Apple
Developer ID certificate does the same thing and is required anyway.

DevHub reads the credential once per launch and caches it in memory, so this is at
worst one prompt per launch rather than one per page load.

## Architecture

The Rust side is the application, not a shell wrapper. The frontend only renders.

```
React / TypeScript
       │  invoke()          events: devhub://output, devhub://run
       ▼
  Tauri commands            src-tauri/src/commands/
       ▼
  Rust core                 src-tauri/src/services/
    ProjectManager     detection, git, id generation
    PathResolver       login-shell PATH probe, program lookup
    GitHubClient       GraphQL activity feed, cached
    DeviceFlow         device-flow sign-in and token refresh
    TokenStore         GitHub credential in the OS keychain
    ProcessManager     spawning, process groups, output streaming
    PortManager        socket table, pid → project attribution
    ConfigManager      atomic TOML read/write
```

Two design points worth knowing:

**Process groups.** Every child is spawned into its own process group
(`process_group(0)`), so `killpg` reaches the whole tree. Signalling only the parent
pid leaves the grandchild — and its port — behind; there is a test that asserts
exactly that failure mode still exists, so the group logic cannot be quietly
removed.

**PATH resolution.** Programs are resolved to an absolute path before spawning, and
the child is given the resolved `PATH` too — `npm` needs to find `node`. Resolving
ourselves also means a missing program produces "`npm` was not found, check your
version manager" instead of a bare `No such file or directory`.

**The runtime handle.** `ProcessManager` holds a `tokio::runtime::Handle` rather than
calling `tokio::spawn`. Synchronous `#[tauri::command]` functions run on a blocking
thread pool, *outside* the runtime, where `tokio::spawn` and `tokio::process` do not
return an error — they panic, which aborts the whole app. Holding the handle makes
spawning independent of which thread a command happens to land on. There is a plain
`#[test]` (deliberately not a `#[tokio::test]`, which would supply an ambient runtime
and hide the problem) that spawns from outside a runtime.

**Capability scope.** The `opener` plugin needs both a permission *and* a URL scope;
granting `opener:allow-open-url` alone refuses every link at runtime. The scope
deliberately covers all of `http`/`https` rather than just localhost, because the
terminal turns URLs found in command output into links and a terminal that opened
only some of them would be worse than one that opened none. Non-web schemes stay
out. A test reads the capability file and checks the URLs the app builds against the
same glob matcher the plugin uses, since nothing else validates that JSON until
someone clicks.

**Losing track of children.** A dev server outlives DevHub if DevHub does not get to
shut down cleanly, and in-memory run state does not survive a restart — so the
process becomes invisible while still holding its port and telling tools like
`next dev` that "another dev server is already running". Two things address it: the
app handles `SIGTERM`/`SIGINT` (Tauri's `RunEvent::Exit` only covers quitting from
the UI), and every spawned group is written to `running.json` so the next launch can
find whatever still survived.

Registry entries store the process **start time** alongside the pid. A pid on its own
proves nothing — the number gets recycled — and offering to kill a recycled pid would
be considerably worse than the problem being solved.

**A column is a view, not a query.** The activity is fetched once and split across the
columns in Rust, so adding a column costs nothing in API terms and there is one
implementation of what a column means — the one the tests cover. Unread is tracked as
a single `read_through` timestamp per column rather than a set of seen ids: the item
set is unbounded and changes constantly, while "everything up to now" stays correct as
new activity arrives. Saved items are stored whole rather than by id, because the feed
only covers recent activity and a bookmark that resolves to nothing is worse than none.

**One GraphQL query, many repos.** Each repository is aliased into a single query
(`r0:`, `r1:`, …) asking for all four kinds at once, chunked so a large workspace
cannot exceed GitHub's node limit. REST would be a dozen round trips and a lot of
discarded JSON, and discussions are GraphQL-only. Repository names are JSON-encoded
into the query rather than pasted, since they come from user config.

**Output batching.** stdout and stderr are read by separate tasks, funnelled into one
`mpsc` channel, and flushed to the frontend in batches (40 ms, or 400 lines). A
verbose build would otherwise emit one IPC message per line. On the frontend the
lines live outside React in an external store, so only the visible terminal
re-renders.

## Tests

```bash
cd src-tauri && cargo test
```

Covers the parts that are actually hard: process-group termination, run status
semantics (a stopped service is `Stopped`, not `Failed`), port attribution through a
grandchild process, PATH resolution, spawning from outside a Tokio runtime, and
project detection across pnpm/npm/Cargo layouts.

Two of these only fail under conditions a normal `cargo test` does not reproduce, so
they are written to be run deliberately:

- **Runtime context** — `spawning_outside_a_runtime_does_not_panic` is a plain
  `#[test]`. Turning it into a `#[tokio::test]` would make it pass against broken
  code.
- **PATH** — the PATH tests want the environment a Finder launch gives you, where an
  inherited `PATH` cannot save you:

The PATH tests are worth running the way the bug actually appears — under the
environment a Finder launch gives you, where an inherited `PATH` cannot save you:

```bash
env -i HOME=$HOME USER=$USER SHELL=$SHELL TMPDIR=$TMPDIR \
    PATH=/usr/bin:/bin:/usr/sbin:/sbin \
    ./target/debug/deps/process_lifecycle-<hash>
```
