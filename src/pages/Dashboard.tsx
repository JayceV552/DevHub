import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { formatDuration, runDuration, StatusDot } from "../components/common/StatusDot";
import { Button } from "../components/ui/button";
import { useDevHub } from "../hooks/useDevHub";
import { api } from "../lib/api";

export function DashboardPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { projects, runs, ports, openTab, report } = useDevHub();

  const running = runs.filter((run) => run.status === "running");
  const services = running.filter((run) => run.kind === "service");
  const devPorts = ports.filter((port) => port.ownership === "managed");
  const recent = runs.filter((run) => run.status !== "running").slice(0, 6);
  const [memoryBytes, setMemoryBytes] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => api.appMemory()
      .then((memory) => { if (active) setMemoryBytes(memory.residentBytes); })
      .catch(report);
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [report]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">{greeting()}</h1>
          <p className="page-subtitle">
            {running.length === 0
              ? "Nothing running right now."
              : `${services.length} service${services.length === 1 ? "" : "s"} up · ${
                  devPorts.length
                } port${devPorts.length === 1 ? "" : "s"} in use`}
          </p>
        </div>
      </div>

      <div className="stat-row section">
        <div className="stat">
          <div className="value">{projects.length}</div>
          <div className="label">Projects</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: running.length ? "var(--success)" : undefined }}>
            {running.length}
          </div>
          <div className="label">Running</div>
        </div>
        <div className="stat">
          <div className="value">{devPorts.length}</div>
          <div className="label">Development ports</div>
        </div>
        <div className="stat">
          <div className="value" style={{ color: recent.some((r) => r.status === "failed") ? "var(--danger)" : undefined }}>
            {recent.filter((run) => run.status === "failed").length}
          </div>
          <div className="label">Recent failures</div>
        </div>
        <div className="stat">
          <div className="value">{memoryBytes === null ? "—" : formatBytes(memoryBytes)}</div>
          <div className="label">App memory</div>
        </div>
      </div>

      <section className="section">
        <h2 className="section-title">
          Running <span className="rule" />
        </h2>
        {running.length === 0 ? (
          <div className="empty-state" style={{ padding: "28px 24px" }}>
            <p style={{ margin: 0 }}>
              Nothing is running.{" "}
              <Button size="sm" onClick={() => onNavigate("projects")}>
                Go to Projects
              </Button>
            </p>
          </div>
        ) : (
          <table className="table">
            <tbody>
              {running.map((run) => {
                const runPorts = ports.filter((port) => port.runId === run.runId);
                return (
                  <tr key={run.runId}>
                    <td style={{ fontWeight: 550 }}>{run.projectName}</td>
                    <td className="mono" style={{ color: "var(--text-muted)" }}>
                      {run.commandId}
                    </td>
                    <td>
                      <StatusDot run={run} showDuration={false} />
                    </td>
                    <td>
                      {runPorts.map((port) => (
                        <a
                          key={port.port}
                          className="port-chip"
                          style={{ marginRight: 6 }}
                          href={`http://localhost:${port.port}`}
                          onClick={(event) => {
                            event.preventDefault();
                            openUrl(`http://localhost:${port.port}`).catch(report);
                          }}
                        >
                          :{port.port} ↗
                        </a>
                      ))}
                    </td>
                    <td className="num">{formatDuration(runDuration(run))}</td>
                    <td style={{ textAlign: "right" }}>
                      <Button size="sm" variant="ghost" onClick={() => openTab(run.runId)}>
                        Output
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {recent.length > 0 ? (
        <section className="section">
          <h2 className="section-title">
            Recent commands <span className="rule" />
          </h2>
          <table className="table">
            <tbody>
              {recent.map((run) => (
                <tr key={run.runId}>
                  <td style={{ fontWeight: 550 }}>{run.projectName}</td>
                  <td className="mono" style={{ color: "var(--text-muted)" }}>
                    {run.commandId}
                  </td>
                  <td>
                    <StatusDot run={run} />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <Button size="sm" variant="ghost" onClick={() => openTab(run.runId)}>
                      Output
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
