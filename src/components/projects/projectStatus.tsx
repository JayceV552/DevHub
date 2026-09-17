import type { ProjectView, Run } from "../../lib/types";
import { relativeTime } from "../activity/ActivityCard";

export type ProjectStatus = "running" | "failed" | "missing" | "idle";

const LABELS: Record<ProjectStatus, string> = {
  running: "Running",
  failed: "Failed",
  missing: "Path missing",
  idle: "Idle",
};

// `runs` must be newest first: the order `list_runs` returns and the store keeps.
export function projectStatus(project: ProjectView, runs: Run[]): ProjectStatus {
  if (runs.some((run) => run.status === "running")) return "running";
  if (!project.pathExists) return "missing";
  return runs[0]?.status === "failed" ? "failed" : "idle";
}

export const needsAttention = (status: ProjectStatus) => status === "failed" || status === "missing";

export function StatusPill({ status, runs }: { status: ProjectStatus; runs: Run[] }) {
  const running = runs.filter((run) => run.status === "running");
  const latest = runs[0];
  const title = status === "running"
    ? running.map((run) => run.displayCommand).join("\n")
    : status === "failed" && latest
      ? `${latest.commandId} exited with code ${latest.exitCode ?? "unknown"}`
      : status === "missing"
        ? "The project folder no longer exists"
        : undefined;

  return (
    <span className={`project-status is-${status}`} title={title}>
      <span className="dot" />
      {LABELS[status]}
      {running.length > 1 ? <span className="project-status-count">{running.length}</span> : null}
    </span>
  );
}

// The same pick `start_group` makes in Rust: the first service script by name.
export function defaultService(project: ProjectView): string | undefined {
  return Object.entries(project.commands).find(([, spec]) => spec.kind === "service")?.[0];
}

export function formatAgo(timestamp: string): string {
  const elapsed = relativeTime(new Date(timestamp));
  return elapsed === "now" ? "just now" : `${elapsed} ago`;
}

export function monogram(name: string): string {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "?";
}

export function shortenPath(path: string): string {
  const home = path.match(/^\/Users\/[^/]+/)?.[0];
  const relative = home ? path.replace(home, "~") : path;
  if (relative.length <= 54) return relative;
  const parts = relative.split("/");
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : relative;
}

const AVATAR_PALETTE = [
  "#818cf8", // Soft Indigo
  "#a78bfa", // Soft Violet
  "#c084fc", // Soft Purple
  "#f472b6", // Soft Pink
  "#fb7185", // Soft Rose
  "#f87171", // Soft Coral
  "#fb923c", // Soft Orange
  "#f59e0b", // Soft Amber
  "#34d399", // Soft Emerald / Mint
  "#2dd4bf", // Soft Teal
  "#22d3ee", // Soft Cyan
  "#38bdf8", // Soft Sky
  "#60a5fa", // Soft Blue
  "#94a3b8", // Soft Slate
  "#a8a29e", // Soft Warm Gray
  "#8b5cf6", // Soft Lavender
];

export function projectAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}

