import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";

import { AddProjectDialog } from "../components/projects/AddProjectDialog";
import { EditProjectDialog } from "../components/projects/EditProjectDialog";
import { ProjectDetail } from "../components/projects/ProjectDetail";
import { ProjectList, type ProjectGroup } from "../components/projects/ProjectList";
import { needsAttention, projectStatus, type ProjectStatus } from "../components/projects/projectStatus";
import { PageHeader } from "../components/common/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useDevHub } from "../hooks/useDevHub";
import type { ProjectView, Run } from "../lib/types";

type StatusFilter = "all" | "running" | "attention";

export function ProjectsPage() {
  const { projects, runs, loading, refreshProjects, focusedProject, setFocusedProject } = useDevHub();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectView | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [, setClock] = useState(() => Date.now());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Keeps "5m ago" honest when nothing is running to re-render the page.
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const runsByProject = useMemo(() => {
    const buckets = new Map<string, Run[]>();
    for (const run of runs) {
      const bucket = buckets.get(run.projectId);
      if (bucket) bucket.push(run);
      else buckets.set(run.projectId, [run]);
    }
    return buckets;
  }, [runs]);

  const statuses = useMemo(
    () => new Map(projects.map((project): [string, ProjectStatus] => [
      project.id,
      projectStatus(project, runsByProject.get(project.id) ?? []),
    ])),
    [projects, runsByProject],
  );
  const runningCount = [...statuses.values()].filter((status) => status === "running").length;
  const attentionCount = [...statuses.values()].filter(needsAttention).length;
  const workspaceCount = new Set(projects.map((project) => project.group).filter(Boolean)).size;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      const status = statuses.get(project.id) ?? "idle";
      if (filter === "running" && status !== "running") return false;
      if (filter === "attention" && !needsAttention(status)) return false;
      if (!needle) return true;
      return [project.name, project.path, project.repository, project.group, project.branch]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [projects, statuses, query, filter]);

  const groups = useMemo<ProjectGroup[]>(() => {
    const buckets = new Map<string, ProjectView[]>();
    const ungrouped: ProjectView[] = [];
    for (const project of visible) {
      if (!project.group) {
        ungrouped.push(project);
        continue;
      }
      const bucket = buckets.get(project.group) ?? [];
      bucket.push(project);
      buckets.set(project.group, bucket);
    }
    const named = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, members]): ProjectGroup => ({ name, projects: members }));
    return ungrouped.length > 0 ? [...named, { name: null, projects: ungrouped }] : named;
  }, [visible]);

  const selected = projects.find((project) => project.id === focusedProject) ?? null;

  if (loading) return <div className="spinner-page">Loading projects…</div>;

  return (
    <div className="projects-page">
      <PageHeader
        className="projects-header"
        title="Projects"
        subtitle={`${countOf(projects.length, "project")}${workspaceCount > 0 ? ` across ${countOf(workspaceCount, "workspace")}` : ""}`}
        actions={<div className="page-toolbar projects-toolbar">
          <Tabs value={filter} onValueChange={(value) => setFilter(value as StatusFilter)}>
            <TabsList className="projects-filter" aria-label="Filter projects by status">
              <TabsTrigger value="all">All<span className="projects-filter-count">{projects.length}</span></TabsTrigger>
              <TabsTrigger value="running">Running<span className="projects-filter-count">{runningCount}</span></TabsTrigger>
              <TabsTrigger value="attention">Attention<span className="projects-filter-count">{attentionCount}</span></TabsTrigger>
            </TabsList>
          </Tabs>
          <label className="toolbar-search" htmlFor="project-search">
            <Search aria-hidden="true" />
            <Input
              id="project-search"
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search projects…"
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>⌘K</kbd>
          </label>
          <Button size="sm" onClick={() => setAdding(true)}><Plus />Add project</Button>
        </div>}
      />

      {projects.length === 0 ? (
        <div className="empty-state">
          <h3>No projects yet</h3>
          <p>Point DevHub at a folder and it will discover scripts, git metadata and development services.</p>
          <Button onClick={() => setAdding(true)}><Plus />Add your first project</Button>
        </div>
      ) : (
        <div className={`projects-body ${selected ? "has-detail" : ""}`}>
          {visible.length === 0 ? (
            <div className="empty-state projects-empty">
              <h3>No matching projects</h3>
              <p>{filter === "all" ? "Try a different search query." : "Try a different search query or status filter."}</p>
            </div>
          ) : (
            <ProjectList
              groups={groups}
              runsByProject={runsByProject}
              statuses={statuses}
              selectedId={selected?.id ?? null}
              expandAll={query.trim() !== "" || filter !== "all"}
              onSelect={setFocusedProject}
              onEdit={setEditing}
              onRemoved={(projectId) => {
                if (projectId === focusedProject) setFocusedProject(null);
                void refreshProjects();
              }}
            />
          )}
          {selected ? (
            <ProjectDetail
              project={selected}
              runs={runsByProject.get(selected.id) ?? []}
              status={statuses.get(selected.id) ?? "idle"}
              onClose={() => setFocusedProject(null)}
              onEdit={() => setEditing(selected)}
            />
          ) : null}
        </div>
      )}

      {adding ? <AddProjectDialog onClose={() => setAdding(false)} onAdded={refreshProjects} /> : null}
      {editing ? <EditProjectDialog project={editing} onClose={() => setEditing(null)} onSaved={refreshProjects} /> : null}
    </div>
  );
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
