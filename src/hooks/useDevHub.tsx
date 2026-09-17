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
  const runsRef = useRef<Run[]>([]);

  useEffect(() => {
    runsRef.current = runs;
  }, [runs]);

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
        runsRef.current = loadedRuns;
        setRuns(loadedRuns);
      } catch (err) {
        if (!cancelled) report(err);
      } finally {
        if (!cancelled) setLoading(false);
      }

      unlisten.push(
        await onOutput((batch) => outputStore.append(batch.runId, batch.lines)),
        await onRunChange((run) => {
          setRuns((previous) => {
            const index = previous.findIndex((r) => r.runId === run.runId);
            const next = index === -1 ? [run, ...previous] : previous.slice();
            if (index !== -1) next[index] = run;
            runsRef.current = next;
            return next;
          });

          setOpenTabs((tabs) => {
            const existingIndex = tabs.findIndex((tabRunId) => {
              if (tabRunId === run.runId) return false;
              const tabRun = runsRef.current.find((r) => r.runId === tabRunId);
              return (
                tabRun !== undefined &&
                tabRun.projectId === run.projectId &&
                tabRun.commandId === run.commandId
              );
            });

            if (existingIndex !== -1) {
              const oldRunId = tabs[existingIndex];
              outputStore.clear(oldRunId);
              const next = [...tabs];
              next[existingIndex] = run.runId;
              setActiveTab((current) => (current === oldRunId ? run.runId : current));
              return next;
            }
            return tabs;
          });
        }),
      );
      if (cancelled) unlisten.forEach((fn) => fn());
    })();

    return () => {
      cancelled = true;
      unlisten.forEach((fn) => fn());
    };
  }, [report]);

  const openTab = useCallback((runId: string) => {
    const targetRun = runsRef.current.find((r) => r.runId === runId);

    setOpenTabs((tabs) => {
      if (targetRun) {
        const existingIndex = tabs.findIndex((tabRunId) => {
          if (tabRunId === targetRun.runId) return true;
          const tabRun = runsRef.current.find((r) => r.runId === tabRunId);
          return (
            tabRun !== undefined &&
            tabRun.projectId === targetRun.projectId &&
            tabRun.commandId === targetRun.commandId
          );
        });

        if (existingIndex !== -1) {
          const oldRunId = tabs[existingIndex];
          if (oldRunId !== targetRun.runId) {
            outputStore.clear(oldRunId);
          }
          const next = [...tabs];
          next[existingIndex] = targetRun.runId;
          return next.filter((id, idx) => {
            if (idx === existingIndex) return true;
            if (id === targetRun.runId) return false;
            const r = runsRef.current.find((item) => item.runId === id);
            if (
              r &&
              r.projectId === targetRun.projectId &&
              r.commandId === targetRun.commandId
            ) {
              outputStore.clear(id);
              return false;
            }
            return true;
          });
        }
      }

      return tabs.includes(runId) ? tabs : [...tabs, runId];
    });

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
        runsRef.current = [run, ...runsRef.current.filter((r) => r.runId !== run.runId)];
        setRuns(runsRef.current);
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
        runsRef.current = [run, ...runsRef.current.filter((r) => r.runId !== run.runId)];
        setRuns(runsRef.current);
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
