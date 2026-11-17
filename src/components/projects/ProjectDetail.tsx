import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Check,
  Copy,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Pencil,
  Play,
  Square,
  SquareTerminal,
  TriangleAlert,
  X,
} from "lucide-react";

import { useDevHub } from "../../hooks/useDevHub";
import { stripAnsi } from "../../lib/ansi";
import { outputStore } from "../../lib/outputStore";
import type { PortEntry, ProjectView, Run } from "../../lib/types";
import { formatDuration, runDuration } from "../common/StatusDot";
import { Button } from "../ui/button";
import { formatAgo, monogram, projectAvatarColor, shortenPath, StatusPill, type ProjectStatus } from "./projectStatus";
import { useI18n } from "../../lib/i18n";

export function ProjectDetail({ project, runs, status, onClose, onEdit }: {
  project: ProjectView;
  runs: Run[];
  status: ProjectStatus;
  onClose: () => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  const { ports, start, stop, openTab, runFor, report } = useDevHub();
  const [closing, setClosing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setClosing(false);
    bodyRef.current?.scrollTo({ top: 0 });
  }, [project.id]);

  const commandIds = Object.keys(project.commands);
  const projectPorts = [
    ...new Map(
      ports
        .filter((entry) => entry.projectId === project.id)
        .map((entry): [number, PortEntry] => [entry.port, entry]),
    ).values(),
  ].sort((a, b) => a.port - b.port);
  const repositoryUrl = project.repository ? `https://github.com/${project.repository}` : null;

  const handleClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 200);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = (url: string) => {
    openUrl(url).catch(report);
  };

  return (
    <aside className={`project-detail ${closing ? "is-closing" : ""}`} aria-label={t("{name} details", { name: project.name })}>
      <header className="project-detail-head">
        <div className="project-detail-title">
          <span
            className="project-avatar is-large"
            style={{ backgroundColor: projectAvatarColor(project.name) }}
            aria-hidden="true"
          >
            {monogram(project.name)}
          </span>
          <div className="project-detail-heading">
            <h2 title={project.name}>{project.name}</h2>
            <CopyPath path={project.path} onError={report} />
          </div>
          <div className="project-detail-actions">
            <Button variant="ghost" size="icon-sm" title={t("Edit project and scripts")} aria-label={t("Edit project")} onClick={onEdit}>
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon-sm" title={t("Close")} aria-label={t("Close project details")} onClick={handleClose}>
              <X />
            </Button>
          </div>
        </div>
        <div className="project-detail-meta">
          <StatusPill status={status} runs={runs} />
          {project.branch ? (
            <span className="project-meta-pill" title={t("Current branch")}>
              <GitBranch aria-hidden="true" /><span>{project.branch}</span>
            </span>
          ) : null}
          {repositoryUrl ? (
            <a
              className="project-meta-pill is-link"
              href={repositoryUrl}
              title={t("Open {title} on GitHub", { title: project.repository ?? "" })}
              onClick={(event) => {
                event.preventDefault();
                open(repositoryUrl);
              }}
            >
              <FolderGit2 aria-hidden="true" /><span>{project.repository}</span>
            </a>
          ) : null}
        </div>
      </header>

      <div ref={bodyRef} className="project-detail-body">
        {project.pathExists ? null : (
          <p className="project-detail-alert">
            <TriangleAlert aria-hidden="true" />
            <span>{t("This folder no longer exists, so its scripts cannot run. If it moved, remove the project and add it again from its new location.")}</span>
          </p>
        )}

        <section className="project-detail-section">
          <header>
            <h3>{t("Scripts")}</h3>
            <span>{commandIds.length}</span>
          </header>
          {commandIds.length === 0 ? (
            <p className="project-detail-empty">
              {t("No scripts configured.")} <button type="button" className="link-button" onClick={onEdit}>{t("Add one")}</button>
            </p>
          ) : (
            <div className="project-script-list">
              {commandIds.map((commandId) => (
                <ScriptRow
                  key={commandId}
                  project={project}
                  commandId={commandId}
                  run={runFor(project.id, commandId)}
                  onStart={() => void start(project.id, commandId)}
                  onStop={(runId) => void stop(runId)}
                  onShowOutput={openTab}
                />
              ))}
            </div>
          )}
        </section>

        {projectPorts.length > 0 ? (
          <section className="project-detail-section">
            <header>
              <h3>{t("Ports")}</h3>
              <span>{projectPorts.length}</span>
            </header>
            <div className="project-port-list">
              {projectPorts.map((entry) => (
                <a
                  key={entry.port}
                  className="project-port-link"
                  href={`http://localhost:${entry.port}`}
                  onClick={(event) => {
                    event.preventDefault();
                    open(`http://localhost:${entry.port}`);
                  }}
                >
                  <span className="dot" />
                  <span>localhost:{entry.port}</span>
                  {entry.commandId ? <small>{entry.commandId}</small> : null}
                  <ExternalLink aria-hidden="true" />
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}

function ScriptRow({ project, commandId, run, onStart, onStop, onShowOutput }: {
  project: ProjectView;
  commandId: string;
  run: Run | undefined;
  onStart: () => void;
  onStop: (runId: string) => void;
  onShowOutput: (runId: string) => void;
}) {
  const { t } = useI18n();
  const spec = project.commands[commandId];
  const command = [spec.program, ...spec.args].join(" ");
  const isRunning = run?.status === "running";
  const outputRunId = run?.runId ?? "__no-run__";
  const lines = useSyncExternalStore(
    (listener) => outputStore.subscribe(outputRunId, listener),
    () => outputStore.get(outputRunId),
    () => outputStore.get(outputRunId),
  );
  // The newest line earns its space while a script is live, or when it explains a failure.
  const lastLine = isRunning || run?.status === "failed" ? lines[lines.length - 1] : undefined;
  const lastText = lastLine ? stripAnsi(lastLine.text).trim() : "";

  return (
    <div className={`project-script ${isRunning ? "is-running" : ""}`}>
      <Button
        variant="outline"
        size="icon-sm"
        className="project-script-toggle"
        title={isRunning ? t("Stop {target}", { target: commandId }) : t("Run {script}", { script: commandId })}
        aria-label={isRunning ? t("Stop {target}", { target: commandId }) : t("Run {script}", { script: commandId })}
        disabled={!isRunning && !project.pathExists}
        onClick={() => (run && isRunning ? onStop(run.runId) : onStart())}
      >
        {isRunning ? <Square fill="currentColor" /> : <Play fill="currentColor" />}
      </Button>
      <div className="project-script-main">
        <div className="project-script-title">
          <strong>{commandId}</strong>
          <span>{spec.kind}</span>
        </div>
        <code title={command}>{command}</code>
        {lastText ? (
          <span className={`project-script-log ${lastLine?.stream === "stderr" ? "is-error" : ""}`} title={lastText}>
            {lastText}
          </span>
        ) : null}
      </div>
      {run ? (
        <div className="project-script-side">
          <RunState run={run} />
          <Button
            variant="ghost"
            size="icon-xs"
            title={t("Show output")}
            aria-label={t("Show {script} output", { script: commandId })}
            onClick={() => onShowOutput(run.runId)}
          >
            <SquareTerminal />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RunState({ run }: { run: Run }) {
  const { t } = useI18n();
  const duration = formatDuration(runDuration(run));
  const label = run.status === "running"
    ? duration
    : run.status === "failed"
      ? t("exit {code}", { code: run.exitCode ?? "?" })
      : run.status === "succeeded" ? t("passed") : t("stopped");

  return (
    <span className={`project-run-state is-${run.status}`} title={t("Started {ago} · ran {duration}", { ago: formatAgo(run.startedAt), duration })}>
      {label}
    </span>
  );
}

function CopyPath({ path, onError }: { path: string; onError: (err: unknown) => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={`project-detail-path ${copied ? "is-copied" : ""}`}
      title={copied ? t("Copied") : t("Copy {path}", { path })}
      onClick={() => navigator.clipboard.writeText(path).then(() => setCopied(true), onError)}
    >
      <span>{shortenPath(path)}</span>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}
