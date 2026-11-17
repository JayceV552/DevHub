export type CommandKind = "service" | "task";

export type RunStatus = "running" | "succeeded" | "failed" | "stopped";

export type OutputStreamKind = "stdout" | "stderr" | "system";

export interface CommandSpec {
  program: string;
  args: string[];
  kind: CommandKind;
  env?: Record<string, string>;
  cwd?: string | null;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  repository?: string | null;
  group?: string | null;
  commands: Record<string, CommandSpec>;
}

export interface ProjectView extends Project {
  branch: string | null;
  pathExists: boolean;
}

export interface ProjectScan {
  name: string;
  path: string;
  repository: string | null;
  branch: string | null;
  detectedFrom: string[];
  commands: Record<string, CommandSpec>;
}

export interface Run {
  runId: string;
  projectId: string;
  projectName: string;
  commandId: string;
  kind: CommandKind;
  displayCommand: string;
  pid: number | null;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  exitCode: number | null;
}

export interface OutputLine {
  runId: string;
  seq: number;
  stream: OutputStreamKind;
  text: string;
}

export interface OutputBatch {
  runId: string;
  lines: OutputLine[];
}

export type PortOwnership = "managed" | "external";

export interface PortEntry {
  port: number;
  protocol: string;
  address: string;
  pid: number | null;
  processName: string | null;
  ownership: PortOwnership;
  projectId: string | null;
  projectName: string | null;
  runId: string | null;
  commandId: string | null;
}

export interface TrackedRun {
  pid: number;
  start_time: number;
  project_id: string;
  project_name: string;
  command_id: string;
  display_command: string;
  started_at: string;
}

export interface ProcessDescription {
  pid: number;
  name: string;
  command: string;
}

export type Theme = "system" | "light" | "dark";

export type ActivityType = "commit" | "pullRequest" | "issue" | "discussion" | "release" | "star" | "fork" | "publish";
export type ActivityState = "open" | "merged" | "closed" | "published";

export interface ActivityItem {
  id: string;
  repository: string;
  projectName: string | null;
  activityType: ActivityType;
  state: ActivityState;
  number: number | null;
  title: string;
  url: string;
  actor: string | null;
  actorAvatar: string | null;
  timestamp: string;
  commentCount: number | null;
  body?: string | null;
  labels?: Array<{ name: string; color: string }>;
  additions?: number | null;
  deletions?: number | null;
  changedFiles?: number | null;
  reviewDecision?: string | null;
  action?: string | null;
}

export interface DeviceLogin {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
}

export type LoginOutcome =
  | { status: "authorized" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export type ClientIdSource = "user" | "bundled";

export interface GitHubStatus {
  connected: boolean;
  method: "oauth" | "pat" | null;
  hasClientId: boolean;
  clientIdSource: ClientIdSource | null;
  hasBundledClientId: boolean;
  loginPending: boolean;
}

export interface ColumnFilters {
  repositories: string[];
  users: string[];
  types: ActivityType[];
  states: ActivityState[];
  query?: string | null;
  hideBots: boolean;
}

export interface ActivityColumn {
  id: string;
  title: string;
  filters: ColumnFilters;
  readThrough?: string | null;
}

export interface BoardColumn extends ActivityColumn {
  items: ActivityItem[];
  unread: number;
}

export interface Board {
  columns: BoardColumn[];
  saved: string[];
}

export interface SavedItem extends ActivityItem {
  savedAt: string;
}

export const emptyFilters = (): ColumnFilters => ({
  repositories: [],
  users: [],
  types: [],
  states: [],
  query: null,
  hideBots: false,
});

export interface Settings {
  theme: Theme;
  output_buffer_lines: number;
  stop_grace_seconds: number;
  hide_system_ports: boolean;
  clipboard_storage_cap_mb: number;
  github_client_id?: string | null;
  enable_notch?: boolean;
  language?: "zh" | "en";
}

export interface NotchInfo {
  hasPhysicalNotch: boolean;
  screenWidth: number;
  screenHeight: number;
  safeAreaTop: number;
  notchX: number;
  notchWidth: number;
}

export interface StatusBarApp {
  name: string;
  bundleId: string;
  pid: number;
  isHidden: boolean;
  isOnscreen: boolean;
  isSystem: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  iconBase64: string;
}

export interface StatusBarAppsResponse {
  hiddenCount: number;
  totalCount: number;
  apps: StatusBarApp[];
}

export interface MusicStatus {
  isRunning: boolean;
  player: string;
  bundleId: string;
  isPlaying: boolean;
  title: string;
  artist: string;
  album: string;
  duration: number;
  /** Seconds, as of `sampledAt`. */
  position: number;
  /** Unix epoch ms when `position` was sampled. */
  sampledAt: number;
  /** JPEG data URL of the album artwork. */
  artwork?: string | null;
  /** PNG data URL of the playing app's icon. */
  appIcon?: string | null;
}

export interface CalendarEvent {
  id: string;
  title: string;
  /** Unix epoch ms. */
  start: number;
  end: number;
  allDay: boolean;
  /** "#rrggbb" */
  color: string;
  calendar: string;
}

export interface CalendarEventsResponse {
  access: "authorized" | "denied" | "restricted" | "notDetermined";
  events: CalendarEvent[];
}

export interface NotchQuickStats {
  activePortsCount: number;
  runningProcessesCount: number;
  caffeinateActive: boolean;
}

export type ClipboardKind = "text" | "code" | "link" | "image" | "file";

export interface ClipboardEntry {
  id: string;
  kind: ClipboardKind;
  content: string | null;
  files: string[] | null;
  previewDataUrl: string | null;
  byteSize: number;
  createdAt: string;
  copiedAt: string;
  copyCount: number;
  width: number | null;
  height: number | null;
}

export interface ClipboardSnapshot {
  entries: ClipboardEntry[];
  totalBytes: number;
  capBytes: number;
  retentionDays: number;
}

export interface AppMemory {
  residentBytes: number;
  processCount: number;
}

export interface MemoryConsumer {
  name: string;
  residentBytes: number;
  processCount: number;
}

export interface SystemMemorySnapshot {
  totalBytes: number;
  usedBytes: number;
  consumers: MemoryConsumer[];
}

export interface TodoStep {
  id: string;
  text: string;
  done: boolean;
}

// A checklist row on its way back to Rust: rows typed just now have no id yet.
export interface TodoStepInput {
  id?: string;
  text: string;
  done: boolean;
}

export interface TodoItem {
  id: string;
  title: string;
  steps: TodoStep[];
  completed: boolean;
  createdAt: string;
}

export interface TodoBoard {
  repositories: string[];
  todos: TodoItem[];
  issueGroups: RepositoryIssueGroup[];
  issueError: string | null;
}

export interface RepositoryIssueGroup {
  repository: string;
  totalCount: number;
  issues: ActivityItem[];
  endCursor: string | null;
  hasNextPage: boolean;
}

export interface RepositoryIssuePage extends RepositoryIssueGroup {
  endCursor: string | null;
  hasNextPage: boolean;
}

export const isRunning = (run: Run) => run.status === "running";
