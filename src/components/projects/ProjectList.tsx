import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ChevronDown, Ellipsis, Folder, GitBranch, Pencil, Play, Square, SquareTerminal, Trash2 } from "lucide-react";

import { useDevHub } from "../../hooks/useDevHub";
import { api } from "../../lib/api";
import type { ProjectView, Run } from "../../lib/types";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { defaultService, formatAgo, monogram, projectAvatarColor, shortenPath, StatusPill, type ProjectStatus } from "./projectStatus";

export interface ProjectGroup {
  // `null` collects the projects that belong to no workspace group.
  name: string | null;
  projects: ProjectView[];
}

const COLLAPSED_GROUPS_KEY = "devhub.projects.collapsed-groups";
const ROW_PORT_LIMIT = 2;

export function ProjectList({ groups, runsByProject, statuses, selectedId, expandAll, onSelect, onEdit, onRemoved }: {
  groups: ProjectGroup[];
  runsByProject: Map<string, Run[]>;
  statuses: Map<string, ProjectStatus>;
  selectedId: string | null;
  expandAll: boolean;
  onSelect: (projectId: string) => void;
  onEdit: (project: ProjectView) => void;
  onRemoved: (projectId: string) => void;
}) {
  const { ports } = useDevHub();
  const [collapsed, setCollapsed] = useState(readCollapsedGroups);

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);

  // The backend lists a port once per owning process; a row shows each port once.
  const portsByProject = useMemo(() => {
    const buckets = new Map<string, number[]>();
    for (const entry of ports) {
      if (!entry.projectId) continue;
      const bucket = buckets.get(entry.projectId) ?? [];
      if (!bucket.includes(entry.port)) bucket.push(entry.port);
      buckets.set(entry.projectId, bucket);
    }
    for (const bucket of buckets.values()) bucket.sort((a, b) => a - b);
    return buckets;
  }, [ports]);

  const toggleGroup = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const showGroupHeads = groups.some((group) => group.name !== null);

  return (
    <div className="project-list">
      <div className="project-list-head" aria-hidden="true">
        <span>Project</span>
        <span>Status</span>
        <span className="project-col-ports">Ports</span>
        <span className="project-col-last">Last run</span>
        <span />
      </div>
      <div className="project-list-scroll">
        {groups.map((group) => {
          const key = group.name ?? "";
          const expanded = expandAll || !collapsed.has(key);
          return (
            <section key={key} className="project-group">
              {showGroupHeads ? (
                <GroupHead
                  group={group}
                  expanded={expanded}
                  canCollapse={!expandAll}
                  runningCount={group.projects.filter((project) => statuses.get(project.id) === "running").length}
                  onToggle={() => toggleGroup(key)}
                />
              ) : null}
              {expanded ? group.projects.map((project) => (
                <ProjectRow
                  key={project.id}
                  project={project}
                  runs={runsByProject.get(project.id) ?? []}
                  status={statuses.get(project.id) ?? "idle"}
                  ports={portsByProject.get(project.id) ?? []}
                  selected={project.id === selectedId}
                  onSelect={() => onSelect(project.id)}
                  onEdit={() => onEdit(project)}
                  onRemoved={() => onRemoved(project.id)}
                />
              )) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function readCollapsedGroups(): Set<string> {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_GROUPS_KEY) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((name): name is string => typeof name === "string") : []);
  } catch {
    return new Set();
  }
}

function GroupHead({ group, expanded, canCollapse, runningCount, onToggle }: {
  group: ProjectGroup;
  expanded: boolean;
  canCollapse: boolean;
  runningCount: number;
  onToggle: () => void;
}) {
  const { report } = useDevHub();
  const [busy, setBusy] = useState(false);
  const { name, projects } = group;

  const act = async (groupName: string, action: "start" | "stop") => {
    setBusy(true);
    try {
      await (action === "start" ? api.startGroup(groupName) : api.stopGroup(groupName));
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="project-group-head">
      <button
        type="button"
        className="project-group-toggle"
        aria-expanded={expanded}
        disabled={!canCollapse}
        onClick={onToggle}
      >
        <ChevronDown className="project-group-chevron" aria-hidden="true" />
        <Folder className="project-group-icon" aria-hidden="true" />
        <span className="project-group-name">{name ?? "Ungrouped"}</span>
        <span className="project-group-meta">
          {projects.length} {projects.length === 1 ? "project" : "projects"}
          {runningCount > 0 ? <span className="text-success"> · {runningCount} running</span> : null}
        </span>
      </button>
      {name !== null ? (
        <div className="project-group-actions">
          {runningCount > 0 ? (
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => void act(name, "stop")}>
              <Square fill="currentColor" />Stop all
            </Button>
          ) : null}
          <Button variant="outline" size="xs" disabled={busy} onClick={() => void act(name, "start")}>
            <Play fill="currentColor" />Start all
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ProjectRow({ project, runs, status, ports, selected, onSelect, onEdit, onRemoved }: {
  project: ProjectView;
  runs: Run[];
  status: ProjectStatus;
  ports: number[];
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemoved: () => void;
}) {
  const { start, stop, openTab, report } = useDevHub();
  const rowRef = useRef<HTMLDivElement>(null);
  const running = runs.filter((run) => run.status === "running");
  const latest = runs[0];
  const service = defaultService(project);

  // Selection also arrives from outside the list, e.g. the sidebar's running list.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

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
    <div ref={rowRef} className={`project-row ${selected ? "is-selected" : ""}`} onClick={onSelect}>
      <div className="project-cell-name">
        <span
          className="project-avatar"
          style={{ backgroundColor: projectAvatarColor(project.name) }}
          aria-hidden="true"
        >
          {monogram(project.name)}
        </span>
        <button
          type="button"
          className="project-name-button"
          aria-current={selected ? "true" : undefined}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <span className="project-name-line">
            <span className="project-name">{project.name}</span>
            {project.branch ? (
              <span className="project-branch" title={project.branch}>
                <GitBranch aria-hidden="true" /><span>{project.branch}</span>
              </span>
            ) : null}
          </span>
          <span className="project-path" title={project.path}>{shortenPath(project.path)}</span>
        </button>
      </div>

      <div className="project-cell">
        <StatusPill status={status} runs={runs} />
      </div>

      <div className="project-cell project-col-ports">
        {ports.length === 0 ? <span className="project-cell-empty">—</span> : null}
        {ports.slice(0, ROW_PORT_LIMIT).map((port) => (
          <a
            key={port}
            className="port-chip"
            href={`http://localhost:${port}`}
            title={`Open http://localhost:${port}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openUrl(`http://localhost:${port}`).catch(report);
            }}
          >
            :{port}
          </a>
        ))}
        {ports.length > ROW_PORT_LIMIT ? (
          <span className="project-port-more" title={ports.slice(ROW_PORT_LIMIT).map((port) => `:${port}`).join(" ")}>
            +{ports.length - ROW_PORT_LIMIT}
          </span>
        ) : null}
      </div>

      <div className="project-cell project-col-last">
        {latest ? (
          <span className="project-last-run" title={latest.displayCommand}>
            <span>{formatAgo(latest.startedAt)}</span>
            <small>{latest.commandId}</small>
          </span>
        ) : <span className="project-cell-empty">—</span>}
      </div>

      <div className="project-row-actions" onClick={(event) => event.stopPropagation()}>
        {running.length > 0 ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="project-row-stop"
            title={`Stop ${running.map((run) => run.commandId).join(", ")}`}
            aria-label={`Stop ${project.name}`}
            onClick={() => running.forEach((run) => void stop(run.runId))}
          >
            <Square fill="currentColor" />
          </Button>
        ) : service ? (
          <Button
            variant="ghost"
            size="icon-xs"
            className="is-reveal"
            title={`Run ${service}`}
            aria-label={`Run ${service} in ${project.name}`}
            disabled={!project.pathExists}
            onClick={() => void start(project.id, service)}
          >
            <Play fill="currentColor" />
          </Button>
        ) : <span className="project-row-slot" />}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-xs" className="is-reveal" aria-label={`More actions for ${project.name}`}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            {latest ? (
              <DropdownMenuItem
                onSelect={() => {
                  onSelect();
                  openTab(latest.runId);
                }}
              >
                <SquareTerminal />Show output
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem onSelect={onEdit}><Pencil />Edit project…</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => void remove()}>
              <Trash2 />Remove from DevHub
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
