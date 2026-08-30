import { openUrl } from "@tauri-apps/plugin-opener";

import { formatDuration, runDuration, StatusDot } from "../components/common/StatusDot";
import { OverviewPanels } from "../components/dashboard/OverviewPanels";
import { Button } from "../components/ui/button";
import { TodoBoard } from "../components/dashboard/TodoBoard";
import { useDevHub } from "../hooks/useDevHub";

export function DashboardPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { projects, runs, ports, openTab, report } = useDevHub();

  const running = runs.filter((run) => run.status === "running");
  const recent = runs.filter((run) => run.status !== "running").slice(0, 6);
  return (
    <>
      <TodoBoard
        projectRepositories={projects.map((project) => project.repository).filter((repository): repository is string => Boolean(repository))}
        onNavigate={onNavigate}
        onReport={report}
      />

      <OverviewPanels onNavigate={onNavigate} onReport={report} />

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
