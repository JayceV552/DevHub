import { useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, GitBranch, Pencil, X } from "lucide-react";

import { useDevHub } from "../../hooks/useDevHub";
import { api } from "../../lib/api";
import { outputStore } from "../../lib/outputStore";
import type { PortEntry, ProjectView, Run } from "../../lib/types";
import { StatusDot } from "../common/StatusDot";
import { Button } from "../ui/button";

export function ProjectCard({ project, ports, onRemoved, onEdit }: {
  project: ProjectView;
  ports: PortEntry[];
  onRemoved: () => void;
  onEdit: () => void;
}) {
  const { start, stop, openTab, runFor, runsForProject, report, focusedProject, setFocusedProject } = useDevHub();
  const focused = focusedProject === project.id;
  const runs = runsForProject(project.id);
  const liveRun = runs.find((run) => run.status === "running");
  const latestRun = liveRun ?? runs[0];
  const outputRunId = latestRun?.runId ?? "__no-run__";
  const lines = useSyncExternalStore(
    (listener) => outputStore.subscribe(outputRunId, listener),
    () => outputStore.get(outputRunId),
    () => outputStore.get(outputRunId),
  );
  const lastLine = lines[lines.length - 1];
  const projectPorts = ports.filter((port) => port.projectId === project.id);
  const commandIds = Object.keys(project.commands);

  const remove = async () => {
    if (!window.confirm(`Remove "${project.name}" from DevHub?\n\nThe folder itself is not touched.`)) return;
    try {
      await api.removeProject(project.id);
      onRemoved();
    } catch (err) {
      report(err);
    }
  };

  return (
    <article
      className={`project-card ${liveRun ? "is-running" : ""} ${project.pathExists ? "" : "is-missing"} ${focused ? "is-focused" : ""}`}
      onClick={() => setFocusedProject(focused ? null : project.id)}
      aria-pressed={focused}
    >
      <div className="pc-head">
        <span className={`pc-dot ${liveRun ? "running" : ""} ${project.pathExists ? "" : "missing"}`} />
        <div className="pc-main">
          <div className="pc-titles">
            <h3 className="pc-name">{project.name}</h3>
            {project.branch ? <span className="pc-branch"><GitBranch />{project.branch}</span> : null}
          </div>
          <div className="pc-path" title={project.path}>{shortenPath(project.path)}</div>
        </div>
        <div className="pc-status">
          {liveRun ? <StatusDot run={liveRun} label={liveRun.commandId} /> : <span className="status"><span className="dot" />Idle</span>}
          <Button
            variant="ghost"
            size="icon-xs"
            title="Edit project and scripts"
            onClick={(event) => {
              event.stopPropagation();
              onEdit();
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            title="Remove project"
            onClick={(event) => {
              event.stopPropagation();
              remove();
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="pc-cmds">
        {commandIds.length === 0 ? (
          <span className="pc-empty">No commands configured.</span>
        ) : commandIds.map((commandId) => (
          <CommandButton
            key={commandId}
            project={project}
            commandId={commandId}
            run={runFor(project.id, commandId)}
            onStart={() => start(project.id, commandId)}
            onStop={(runId) => stop(runId)}
            onOpen={(runId) => openTab(runId)}
            onFocus={() => setFocusedProject(project.id)}
          />
        ))}
      </div>

      {projectPorts.length > 0 || lastLine ? (
        <div className="pc-foot">
          {projectPorts.map((port) => (
            <a
              key={`${port.port}-${port.pid}`}
              className="port-chip"
              href={`http://localhost:${port.port}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openUrl(`http://localhost:${port.port}`).catch(report);
              }}
            >
              localhost:{port.port}<ExternalLink />
            </a>
          ))}
          {lastLine ? (
            <span className={`pc-log ${lastLine.stream === "stderr" ? "is-error" : ""}`} title={lastLine.text}>
              {lastLine.text}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function CommandButton({ project, commandId, run, onStart, onStop, onOpen, onFocus }: {
  project: ProjectView;
  commandId: string;
  run: Run | undefined;
  onStart: () => void;
  onStop: (runId: string) => void;
  onOpen: (runId: string) => void;
  onFocus: () => void;
}) {
  const spec = project.commands[commandId];
  const isRunning = run?.status === "running";
  const failed = run?.status === "failed";

  return (
    <button
      className={`command-btn ${isRunning ? "active" : ""} ${failed ? "failed" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        if (isRunning && run) onStop(run.runId);
        else onStart();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (run) {
          onFocus();
          onOpen(run.runId);
        }
      }}
      disabled={!project.pathExists}
      title={`${spec.program} ${spec.args.join(" ")}${run ? "\nRight-click to open its output" : ""}`}
    >
      {isRunning ? "■" : "▶"} {commandId}
    </button>
  );
}

function shortenPath(path: string): string {
  const home = path.match(/^\/Users\/[^/]+/)?.[0];
  const relative = home ? path.replace(home, "~") : path;
  if (relative.length <= 54) return relative;
  const parts = relative.split("/");
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : relative;
}
