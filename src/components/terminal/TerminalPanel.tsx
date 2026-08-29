import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, PanelBottomOpen } from "lucide-react";

import { useDevHub } from "../../hooks/useDevHub";
import { Terminal } from "./Terminal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 300;

export function TerminalPanel() {
  const {
    openTabs,
    activeTab,
    setActiveTab,
    closeTab,
    runs,
    projects,
    focusedProject,
    setFocusedProject,
    stop,
    restart,
    report,
  } = useDevHub();

  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [collapsed, setCollapsed] = useState(
    () => window.localStorage.getItem("devhub.terminal-collapsed") === "true",
  );
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      dragState.current = { startY: event.clientY, startHeight: height };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [height],
  );

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    const next = drag.startHeight - (event.clientY - drag.startY);
    setHeight(Math.max(MIN_HEIGHT, Math.min(next, window.innerHeight - 180)));
  }, []);

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    dragState.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "w" && activeTab) {
        event.preventDefault();
        closeTab(activeTab);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        setCollapsed((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab, closeTab]);

  useEffect(() => {
    window.localStorage.setItem("devhub.terminal-collapsed", String(collapsed));
  }, [collapsed]);

  const allTabs = useMemo(
    () =>
      openTabs
        .map((runId) => runs.find((run) => run.runId === runId))
        .filter((run): run is NonNullable<typeof run> => run !== undefined),
    [openTabs, runs],
  );

  const tabRuns = useMemo(
    () =>
      focusedProject === null
        ? allTabs
        : allTabs.filter((run) => run.projectId === focusedProject),
    [allTabs, focusedProject],
  );

  const scopes = useMemo(() => {
    const seen = new Map<string, string>();
    for (const run of allTabs) seen.set(run.projectId, run.projectName);
    return [...seen.entries()];
  }, [allTabs]);

  const active =
    tabRuns.find((run) => run.runId === activeTab) ?? tabRuns[tabRuns.length - 1];

  useEffect(() => {
    if (tabRuns.length === 0) return;
    if (!tabRuns.some((run) => run.runId === activeTab)) {
      setActiveTab(tabRuns[tabRuns.length - 1].runId);
    }
  }, [tabRuns, activeTab, setActiveTab]);

  if (allTabs.length === 0) return null;

  if (collapsed) {
    return (
      <button className="terminal-collapsed-bar" onClick={() => setCollapsed(false)}>
        <PanelBottomOpen />
        <span>Terminal</span>
        <span className="terminal-collapsed-count">{allTabs.length}</span>
        <kbd>⌘J</kbd>
      </button>
    );
  }

  const focusedName = projects.find((p) => p.id === focusedProject)?.name;

  return (
    <>
      <div
        className="terminal-resizer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal panel"
      />
      <section className="terminal" style={{ height }}>
        <div className="terminal-tabs">
          {scopes.length > 1 ? (
            <div className="terminal-scope">
              <Select
                value={focusedProject ?? "all"}
                onValueChange={(value) => setFocusedProject(value === "all" ? null : value)}
              >
                <SelectTrigger size="sm" aria-label="Terminal scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {scopes.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {tabRuns.map((run) => (
            <button
              key={run.runId}
              className={`terminal-tab ${run.runId === active?.runId ? "active" : ""}`}
              onClick={() => setActiveTab(run.runId)}
            >
              <span className={`status ${run.status}`}>
                <span className="dot" />
              </span>
              {focusedProject === null ? `${run.projectName} / ` : ""}
              {run.commandId}
              <span
                className="tab-close"
                role="button"
                tabIndex={-1}
                aria-label={`Close ${run.projectName} ${run.commandId}`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(run.runId);
                }}
              >
                ×
              </span>
            </button>
          ))}
          <button className="terminal-collapse-button" onClick={() => setCollapsed(true)} title="Hide terminal (⌘J)" aria-label="Hide terminal">
            <ChevronDown />
          </button>
        </div>

        {active ? (
          <Terminal
            key={active.runId}
            run={active}
            onStop={stop}
            onRestart={restart}
            onReport={report}
          />
        ) : (
          <div className="terminal-body">
            <span className="terminal-empty">
              {focusedName
                ? `No output open for ${focusedName}.`
                : "No output open."}
            </span>
          </div>
        )}
      </section>
    </>
  );
}
