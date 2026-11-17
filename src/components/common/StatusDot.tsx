import { useEffect, useState } from "react";

import type { Run, RunStatus } from "../../lib/types";
import { useI18n } from "../../lib/i18n";

const LABELS: Record<RunStatus, string> = {
  running: "Running",
  succeeded: "Passed",
  failed: "Failed",
  stopped: "Stopped",
};

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function runDuration(run: Run): number {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.now();
  return Math.max(0, end - Date.parse(run.startedAt));
}

export function StatusDot({ run, showDuration = true, label }: {
  run: Run;
  showDuration?: boolean;
  label?: string;
}) {
  const { t } = useI18n();
  const [, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!showDuration || run.status !== "running") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [run.status, showDuration]);

  const detail =
    run.status === "failed" && run.exitCode !== null ? ` (${t("exit {code}", { code: run.exitCode })})` : "";

  return (
    <span className={`status ${run.status}`} title={run.displayCommand}>
      <span className="dot" />
      {label ?? t(LABELS[run.status])}
      {detail}
      {showDuration ? (
        <span style={{ color: "var(--text-faint)" }}>· {formatDuration(runDuration(run))}</span>
      ) : null}
    </span>
  );
}
