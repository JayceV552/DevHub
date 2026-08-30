import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ActivityItem,
  AppMemory,
  Board,
  ActivityColumn,
  ColumnFilters,
  ClipboardSnapshot,
  CommandSpec,
  DeviceLogin,
  GitHubStatus,
  LoginOutcome,
  OutputBatch,
  OutputLine,
  PortEntry,
  ProcessDescription,
  Project,
  ProjectScan,
  ProjectView,
  RepositoryIssuePage,
  Run,
  SavedItem,
  Settings,
  SystemMemorySnapshot,
  TrackedRun,
  TodoBoard,
  TodoItem,
  TodoStepInput,
} from "./types";

export const api = {
  listProjects: () => invoke<ProjectView[]>("list_projects"),
  scanProject: (path: string) => invoke<ProjectScan>("scan_project", { path }),
  addProject: (input: {
    name: string;
    path: string;
    repository?: string | null;
    group?: string | null;
    commands: Record<string, CommandSpec>;
  }) => invoke<Project>("add_project", input),
  updateProject: (input: {
    id: string;
    name: string;
    repository?: string | null;
    group?: string | null;
    commands: Record<string, CommandSpec>;
  }) => invoke<Project>("update_project", input),
  removeProject: (id: string) => invoke<void>("remove_project", { id }),
  detectNewCommands: (id: string) =>
    invoke<Record<string, CommandSpec>>("detect_new_commands", { id }),

  startCommand: (projectId: string, commandId: string) =>
    invoke<Run>("start_command", { projectId, commandId }),
  stopRun: (runId: string) => invoke<void>("stop_run", { runId }),
  restartRun: (runId: string) => invoke<Run>("restart_run", { runId }),
  listRuns: () => invoke<Run[]>("list_runs"),
  getRunOutput: (runId: string) => invoke<OutputLine[]>("get_run_output", { runId }),
  clearRun: (runId: string) => invoke<void>("clear_run", { runId }),
  startGroup: (group: string) => invoke<Run[]>("start_group", { group }),
  stopGroup: (group: string) => invoke<void>("stop_group", { group }),

  listOrphans: () => invoke<TrackedRun[]>("list_orphans"),
  stopOrphan: (pid: number) => invoke<void>("stop_orphan", { pid }),
  dismissOrphan: (pid: number) => invoke<void>("dismiss_orphan", { pid }),
  stopAllOrphans: () => invoke<void>("stop_all_orphans"),

  listPorts: () => invoke<PortEntry[]>("list_ports"),
  describeProcess: (pid: number) =>
    invoke<ProcessDescription | null>("describe_process", { pid }),
  killPortProcess: (pid: number, runId: string | null) =>
    invoke<void>("kill_port_process", { pid, runId }),

  activityBoard: (force = false) => invoke<Board>("activity_board", { force }),
  listColumns: () => invoke<ActivityColumn[]>("list_columns"),
  addColumn: (title: string, filters: ColumnFilters) =>
    invoke<ActivityColumn>("add_column", { title, filters }),
  updateColumn: (id: string, title: string, filters: ColumnFilters) =>
    invoke<ActivityColumn>("update_column", { id, title, filters }),
  removeColumn: (id: string) => invoke<void>("remove_column", { id }),
  moveColumn: (id: string, delta: number) =>
    invoke<ActivityColumn[]>("move_column", { id, delta }),
  markColumnRead: (id: string) => invoke<ActivityColumn>("mark_column_read", { id }),
  listSaved: () => invoke<SavedItem[]>("list_saved"),
  saveItem: (item: ActivityItem) => invoke<void>("save_item", { item }),
  unsaveItem: (id: string) => invoke<void>("unsave_item", { id }),

  githubActivity: (force = false) => invoke<ActivityItem[]>("github_activity", { force }),
  githubStatus: () => invoke<GitHubStatus>("github_status"),
  githubStartLogin: () => invoke<DeviceLogin>("github_start_login"),
  githubCancelLogin: () => invoke<void>("github_cancel_login"),
  setGithubToken: (token: string) => invoke<void>("set_github_token", { token }),
  clearGithubToken: () => invoke<void>("clear_github_token"),
  githubRepositories: () => invoke<string[]>("github_repositories"),
  githubSearchRepositories: (query: string) => invoke<string[]>("github_search_repositories", { query }),

  clipboardSnapshot: () => invoke<ClipboardSnapshot>("clipboard_snapshot"),
  clipboardImageData: (id: string) => invoke<string | null>("clipboard_image_data", { id }),
  copyClipboardEntry: (id: string) => invoke<void>("copy_clipboard_entry", { id }),
  deleteClipboardEntry: (id: string) => invoke<void>("delete_clipboard_entry", { id }),
  clearClipboardHistory: () => invoke<void>("clear_clipboard_history"),
  appMemory: () => invoke<AppMemory>("app_memory"),
  systemMemory: () => invoke<SystemMemorySnapshot>("system_memory"),

  todoBoard: () => invoke<TodoBoard>("todo_board"),
  todoRepositoryIssues: (repository: string, cursor: string | null) =>
    invoke<RepositoryIssuePage>("todo_repository_issues", { repository, cursor }),
  setTodoRepositories: (repositories: string[]) =>
    invoke<string[]>("set_todo_repositories", { repositories }),
  addTodo: (title: string, steps: TodoStepInput[] = []) =>
    invoke<TodoItem>("add_todo", { title, steps }),
  updateTodo: (id: string, title: string, steps: TodoStepInput[]) =>
    invoke<TodoItem>("update_todo", { id, title, steps }),
  setTodoStep: (id: string, stepId: string, done: boolean) =>
    invoke<TodoItem>("set_todo_step", { id, stepId, done }),
  setTodoCompleted: (id: string, completed: boolean) =>
    invoke<TodoItem>("set_todo_completed", { id, completed }),
  deleteTodo: (id: string) => invoke<void>("delete_todo", { id }),

  getSettings: () => invoke<Settings>("get_settings"),
  updateSettings: (settings: Settings) => invoke<Settings>("update_settings", { settings }),
  getConfigPath: () => invoke<string>("get_config_path"),
  getResolvedPath: () => invoke<string[]>("get_resolved_path"),
};

export const onGitHubAuth = (handler: (outcome: LoginOutcome) => void): Promise<UnlistenFn> =>
  listen<LoginOutcome>("devhub://github-auth", (event) => handler(event.payload));

export const onOutput = (handler: (batch: OutputBatch) => void): Promise<UnlistenFn> =>
  listen<OutputBatch>("devhub://output", (event) => handler(event.payload));

export const onRunChange = (handler: (run: Run) => void): Promise<UnlistenFn> =>
  listen<Run>("devhub://run", (event) => handler(event.payload));

export const onClipboardChange = (handler: () => void): Promise<UnlistenFn> =>
  listen("devhub://clipboard", handler);

export const errorMessage = (err: unknown): string =>
  typeof err === "string" ? err : err instanceof Error ? err.message : String(err);
