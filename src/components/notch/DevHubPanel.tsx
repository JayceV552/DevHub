import { api } from "../../lib/api";
import type { NotchDictionary } from "../../lib/notchI18n";
import type { NotchQuickStats } from "../../lib/types";

interface DevHubPanelProps {
  stats: NotchQuickStats | null;
  t: NotchDictionary;
  onChanged: () => void;
}

export function DevHubPanel({ stats, t, onChanged }: DevHubPanelProps) {
  const awake = stats?.caffeinateActive ?? false;
  const openMain = () => api.showDevHubMainWindow().catch(() => {});

  return (
    <div className="notch-stats">
      <button type="button" className="notch-stat" onClick={openMain}>
        <span className="notch-stat-value">{stats?.activePortsCount ?? "–"}</span>
        <span className="notch-stat-label">{t.activePorts}</span>
      </button>
      <button type="button" className="notch-stat" onClick={openMain}>
        <span className="notch-stat-value">{stats?.runningProcessesCount ?? "–"}</span>
        <span className="notch-stat-label">{t.runningProcesses}</span>
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={awake}
        className={`notch-stat ${awake ? "is-on" : ""}`}
        onClick={() => {
          api.toggleCaffeinate().then(onChanged).catch(() => {});
        }}
      >
        <span className="notch-switch" aria-hidden="true">
          <span />
        </span>
        <span className="notch-stat-label">
          {t.keepAwake} · {awake ? t.on : t.off}
        </span>
      </button>
    </div>
  );
}
