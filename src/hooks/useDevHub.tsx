import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api, errorMessage, onOutput, onRunChange } from "../lib/api";
import { outputStore } from "../lib/outputStore";
import type { PortEntry, ProjectView, Run } from "../lib/types";

interface DevHubValue {
  projects: ProjectView[];
  runs: Run[];
  ports: PortEntry[];
  loading: boolean;
  error: string | null;
  dismissError: () => void;
  openTabs: string[];
  activeTab: string | null;
  focusedProject: string | null;
  setFocusedProject: (projectId: string | null) => void;
  refreshProjects: () => Promise<void>;
  refreshPorts: () => Promise<void>;
  start: (projectId: string, commandId: string) => Promise<void>;
  stop: (runId: string) => Promise<void>;
  restart: (runId: string) => Promise<void>;
  openTab: (runId: string) => void;
  closeTab: (runId: string) => void;
  setActiveTab: (runId: string | null) => void;
  runFor: (projectId: string, commandId: string) => Run | undefined;
  runsForProject: (projectId: string) => Run[];
  report: (err: unknown) => void;
}

const DevHubContext = createContext<DevHubValue | null>(null);

const PORT_POLL_MS = 4_000;

export function DevHubProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [focusedProject, setFocusedProject] = useState<string | null>(null);

  const report = useCallback((err: unknown) => setError(errorMessage(err)), []);

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await api.listProjects());
    } catch (err) {
      report(err);
    }
  }, [report]);

  const refreshPorts = useCallback(async () => {
    try {
      setPorts(await api.listPorts());
    } catch (err) {
      report(err);
    }
  }, [report]);

  useEffect(() => {
    let cancelled = false;
    const unlisten: Array<() => void> = [];

    (async () => {
      try {
        const [loadedProjects, loadedRuns] = await Promise.all([
          api.listProjects(),
          api.listRuns(),
        ]);
        if (cancelled) return;
        setProjects(loadedProjects);
        setRuns(loadedRuns);
      } catch (err) {
        if (!cancelled) report(err);
      } finally {
        if (!cancelled) setLoading(false);
      }

      unlisten.push(
        await onOutput((batch) => outputStore.append(batch.runId, batch.lines)),
        await onRunChange((run) =>
          setRuns((previous) => {
            const index = previous.findIndex((r) => r.runId === run.runId);
            if (index === -1) return [run, ...previous];
            const next = previous.slice();
            next[index] = run;
            return next;
          }),
        ),
      );
      if (cancelled) unlisten.forEach((fn) => fn());
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, [report]);

  const openTab = useCallback((runId: string) => {
    setOpenTabs((tabs) => (tabs.includes(runId) ? tabs : [...tabs, runId]));
    setActiveTab(runId);
  }, []);

  const closeTab = useCallback((runId: string) => {
    setOpenTabs((tabs) => {
      const next = tabs.filter((id) => id !== runId);
      setActiveTab((current) =>
        current === runId ? (next[next.length - 1] ?? null) : current,
      );
      return next;
    });
    outputStore.clear(runId);
  }, []);

  const start = useCallback(
    async (projectId: string, commandId: string) => {
      try {
        const run = await api.startCommand(projectId, commandId);
        setRuns((previous) => [run, ...previous.filter((r) => r.runId !== run.runId)]);
        setFocusedProject((current) => (current === null ? null : projectId));
        openTab(run.runId);
      } catch (err) {
        report(err);
      }
    },
    [openTab, report],
  );

  const stop = useCallback(
    async (runId: string) => {
      try {
        await api.stopRun(runId);
      } catch (err) {
        report(err);
      }
    },
    [report],
  );

  const restart = useCallback(
    async (runId: string) => {
      try {
        const run = await api.restartRun(runId);
        setRuns((previous) => [run, ...previous.filter((r) => r.runId !== run.runId)]);
        openTab(run.runId);
      } catch (err) {
        report(err);
      }
    },
    [openTab, report],
  );

  const anyRunning = runs.some((run) => run.status === "running");
  const refreshPortsRef = useRef(refreshPorts);
  refreshPortsRef.current = refreshPorts;
  useEffect(() => {
    refreshPortsRef.current();
    const timer = window.setInterval(() => refreshPortsRef.current(), PORT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyRunning]);

  const runFor = useCallback(
    (projectId: string, commandId: string) =>
      runs.find(
        (run) =>
          run.projectId === projectId &&
          run.commandId === commandId &&
          run.status === "running",
      ) ??
      runs.find((run) => run.projectId === projectId && run.commandId === commandId),
    [runs],
  );

  const runsForProject = useCallback(
    (projectId: string) => runs.filter((run) => run.projectId === projectId),
    [runs],
  );

  const value = useMemo<DevHubValue>(
    () => ({
      projects,
      runs,
      ports,
      loading,
      error,
      dismissError: () => setError(null),
      openTabs,
      activeTab,
      focusedProject,
      setFocusedProject,
      refreshProjects,
      refreshPorts,
      start,
      stop,
      restart,
      openTab,
      closeTab,
      setActiveTab,
      runFor,
      runsForProject,
      report,
    }),
    [
      projects, runs, ports, loading, error, openTabs, activeTab, focusedProject,
      refreshProjects, refreshPorts, start, stop, restart, openTab, closeTab,
      runFor, runsForProject, report,
    ],
  );

  return <DevHubContext.Provider value={value}>{children}</DevHubContext.Provider>;
}

export function useDevHub(): DevHubValue {
  const value = useContext(DevHubContext);
  if (!value) throw new Error("useDevHub must be used inside <DevHubProvider>");
  return value;
}
