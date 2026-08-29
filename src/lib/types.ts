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

export type ActivityType = "commit" | "pullRequest" | "issue" | "discussion" | "release" | "star" | "fork";
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

export const isRunning = (run: Run) => run.status === "running";
