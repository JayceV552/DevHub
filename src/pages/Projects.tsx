import { useEffect, useMemo, useRef, useState } from "react";
import { Folder, Plus, Search } from "lucide-react";

import { AddProjectDialog } from "../components/projects/AddProjectDialog";
import { EditProjectDialog } from "../components/projects/EditProjectDialog";
import { ProjectCard } from "../components/projects/ProjectCard";
import { PageHeader } from "../components/common/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useDevHub } from "../hooks/useDevHub";
import { api } from "../lib/api";
import type { ProjectView } from "../lib/types";

export function ProjectsPage() {
  const { projects, ports, runs, loading, refreshProjects } = useDevHub();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectView | null>(null);
  const [query, setQuery] = useState("");
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

  const runningIds = useMemo(
    () => new Set(runs.filter((run) => run.status === "running").map((run) => run.projectId)),
    [runs],
  );
  const runningCount = runningIds.size;
  const missingCount = projects.filter((project) => !project.pathExists).length;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      if (!needle) return true;
      return [project.name, project.path, project.repository, project.group, project.branch]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle));
    });
  }, [projects, query]);

  const { groups, ungrouped } = useMemo(() => {
    const buckets = new Map<string, ProjectView[]>();
    const loose: ProjectView[] = [];
    for (const project of visible) {
      if (project.group) {
        const bucket = buckets.get(project.group) ?? [];
        bucket.push(project);
        buckets.set(project.group, bucket);
      } else loose.push(project);
    }
    return { groups: [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)), ungrouped: loose };
  }, [visible]);

  if (loading) return <div className="spinner-page">Loading projects…</div>;

  return (
    <>
      <PageHeader
        className="projects-header"
        title="Projects"
        subtitle={(
          <>
            {projects.length} projects · <span className="text-success">{runningCount} running</span>
            {missingCount > 0 ? ` · ${missingCount} path missing` : ""}
          </>
        )}
        actions={<div className="page-toolbar projects-toolbar">
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
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <h3>No matching projects</h3>
          <p>Try a different search query.</p>
        </div>
      ) : null}

      {groups.map(([groupName, groupProjects]) => (
        <GroupSection key={groupName} name={groupName} projects={groupProjects} onChanged={refreshProjects} onEdit={setEditing} />
      ))}

      {ungrouped.length > 0 ? (
        <section className="section">
          {groups.length > 0 ? (
            <div className="group-bar"><Folder /><h3>Ungrouped</h3><span className="rule" /></div>
          ) : null}
          <div className="card-grid">
            {ungrouped.map((project) => <ProjectCard key={project.id} project={project} ports={ports} onRemoved={refreshProjects} onEdit={() => setEditing(project)} />)}
          </div>
        </section>
      ) : null}

      {adding ? <AddProjectDialog onClose={() => setAdding(false)} onAdded={refreshProjects} /> : null}
      {editing ? <EditProjectDialog project={editing} onClose={() => setEditing(null)} onSaved={refreshProjects} /> : null}
    </>
  );
}

function GroupSection({ name, projects, onChanged, onEdit }: {
  name: string;
  projects: ProjectView[];
  onChanged: () => void;
  onEdit: (project: ProjectView) => void;
}) {
  const { ports, runs, report } = useDevHub();
  const [busy, setBusy] = useState(false);
  const projectIds = new Set(projects.map((project) => project.id));
  const runningCount = new Set(
    runs
      .filter((run) => run.status === "running" && projectIds.has(run.projectId))
      .map((run) => run.projectId),
  ).size;

  const act = async (action: "start" | "stop") => {
    setBusy(true);
    try {
      await (action === "start" ? api.startGroup(name) : api.stopGroup(name));
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="section">
      <div className="group-bar">
        <Folder />
        <h3>{name}</h3>
        <span className="meta">{runningCount}/{projects.length} running</span>
        <span className="rule" />
        <Button variant="outline" size="xs" onClick={() => act("start")} disabled={busy}>▶ Start all</Button>
        <Button variant="outline" size="xs" onClick={() => act("stop")} disabled={busy || runningCount === 0}>■ Stop all</Button>
      </div>
      <div className="card-grid">
        {projects.map((project) => <ProjectCard key={project.id} project={project} ports={ports} onRemoved={onChanged} onEdit={() => onEdit(project)} />)}
      </div>
    </section>
  );
}
