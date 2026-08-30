import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import {
  Clipboard,
  FolderKanban,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  RadioTower,
  Settings,
} from "lucide-react";

import { OrphanBanner } from "./components/common/OrphanBanner";
import { useWindowDragHandle } from "./components/common/PageHeader";
import { TerminalPanel } from "./components/terminal/TerminalPanel";
import { Button } from "./components/ui/button";
import { formatDuration } from "./components/common/StatusDot";
import { DevHubProvider, useDevHub } from "./hooks/useDevHub";
import { ActivityPage } from "./pages/Activity";
import { DashboardPage } from "./pages/Dashboard";
import { PortsPage } from "./pages/Ports";
import { ProjectsPage } from "./pages/Projects";
import { SettingsPage } from "./pages/Settings";
import { ClipboardPage } from "./pages/Clipboard";
import { api, onClipboardChange } from "./lib/api";

type Page = "dashboard" | "projects" | "ports" | "clipboard" | "activity" | "settings";

const NAV: Array<{ id: Page; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }> = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "ports", label: "Ports", icon: RadioTower },
  { id: "clipboard", label: "Clipboard", icon: Clipboard },
  { id: "activity", label: "GitHub", icon: GitHubLogo },
  { id: "settings", label: "Settings", icon: Settings },
];

function DevHubLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" fill="none" {...props}>
      <rect width="100" height="100" rx="24" fill="#3b82f6" />
      <path
        d="M 30 28 L 46 44 L 30 60"
        stroke="#ffffff"
        strokeWidth="8.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 52 60 L 70 60"
        stroke="#ffffff"
        strokeWidth="8.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GitHubLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 .7a11.3 11.3 0 0 0-3.6 22c.6.1.8-.2.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.5-1.4-1.3-1.7-1.3-1.7-1.1-.8.1-.8.1-.8 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6A4.7 4.7 0 0 1 5.8 8c-.1-.3-.5-1.6.1-3.3 0 0 1-.3 3.5 1.3a11.8 11.8 0 0 1 6.3 0c2.4-1.6 3.5-1.3 3.5-1.3.6 1.7.2 3 .1 3.3a4.7 4.7 0 0 1 1.2 3.3c0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2V22c0 .4.2.7.8.6A11.3 11.3 0 0 0 12 .7Z" />
    </svg>
  );
}

export default function App() {
  return (
    <DevHubProvider>
      <Shell />
    </DevHubProvider>
  );
}

function Shell() {
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => window.localStorage.getItem("devhub.sidebar-collapsed") === "true",
  );
  const [, setClock] = useState(() => Date.now());
  const [clipboardCount, setClipboardCount] = useState(0);
  const { projects, runs, ports, error, dismissError, openTab, setFocusedProject } = useDevHub();
  const sidebarWindowDragHandle = useWindowDragHandle();

  const counts: Record<Page, string | null> = {
    dashboard: null,
    projects: projects.length ? String(projects.length) : null,
    ports: ports.length ? String(ports.length) : null,
    clipboard: clipboardCount ? String(clipboardCount) : null,
    activity: null,
    settings: null,
  };

  const running = runs.filter((run) => run.status === "running");
  const runningCount = running.length;

  useEffect(() => {
    if (runningCount === 0) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [runningCount]);

  useEffect(() => {
    window.localStorage.setItem("devhub.sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const refresh = () => api.clipboardSnapshot()
      .then((snapshot) => { if (active) setClipboardCount(snapshot.entries.length); })
      .catch(() => {});
    refresh();
    onClipboardChange(refresh).then((stop) => { unlisten = stop; }).catch(() => {});
    return () => { active = false; unlisten?.(); };
  }, []);

  return (
    <div className={`app ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <nav className="sidebar">
        <div className="sidebar-brand" {...sidebarWindowDragHandle}>
          <span className="brand-mark"><DevHubLogo aria-hidden="true" /></span>
          <span className="brand-copy">
            <strong>DevHub</strong>
            <small>Workspace control</small>
          </span>
        </div>
        <div className="sidebar-section-label">Workspace</div>
        <div className="sidebar-nav">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <Button
                key={item.id}
                variant="ghost"
                className="nav-item"
                aria-current={page === item.id ? "page" : undefined}
                title={sidebarCollapsed ? item.label : undefined}
                onClick={() => setPage(item.id)}
              >
                <span className="nav-icon"><Icon aria-hidden="true" /></span>
                <span className="nav-label">{item.label}</span>
                {counts[item.id] ? <span className="nav-count">{counts[item.id]}</span> : null}
              </Button>
            );
          })}
        </div>
        {running.length > 0 ? (
          <div className="sidebar-running-wrap">
            <div className="sidebar-section-label">Running</div>
            <div className="sidebar-running">
              {running.map((run) => (
                <button
                  key={run.runId}
                  onClick={() => {
                    setFocusedProject(run.projectId);
                    openTab(run.runId);
                    setPage("projects");
                  }}
                >
                  <span className="dot" />
                  <span className="name">{run.projectName}</span>
                  <span className="dur">{formatDuration(Math.max(0, Date.now() - Date.parse(run.startedAt)))}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="sidebar-footer">
          <div className="sidebar-status">
            <span className={`status ${runningCount ? "running" : ""}`}>
              <span className="dot" />
              <span className="status-label">{runningCount ? `${runningCount} running` : "Idle"}</span>
            </span>
            <button
              className="sidebar-collapse-button"
              onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </button>
          </div>
        </div>
      </nav>

      <main className="main">
        {error ? (
          <div className="error-bar">
            <span>{error}</span>
            <span className="spacer" />
            <Button variant="ghost" size="sm" onClick={dismissError}>
              Dismiss
            </Button>
          </div>
        ) : null}

        <OrphanBanner />

        <div className={`page ${page === "activity" || page === "clipboard" ? "is-board" : ""}`}>
          {page === "dashboard" ? <DashboardPage onNavigate={(p) => setPage(p as Page)} /> : null}
          {page === "projects" ? <ProjectsPage /> : null}
          {page === "ports" ? <PortsPage /> : null}
          {page === "clipboard" ? <ClipboardPage /> : null}
          {page === "activity" ? <ActivityPage /> : null}
          {page === "settings" ? <SettingsPage /> : null}
        </div>

        <TerminalPanel />
      </main>
    </div>
  );
}
