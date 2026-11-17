import { useCallback, useEffect, useState } from "react";

import { api, errorMessage } from "../../lib/api";
import type { TrackedRun } from "../../lib/types";
import { Button } from "../ui/button";
import { useI18n } from "../../lib/i18n";

export function OrphanBanner() {
  const [orphans, setOrphans] = useState<TrackedRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    let active = true;
    const refresh = () => api.listOrphans()
      .then((next) => { if (active) setOrphans(next); })
      .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 4_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const act = useCallback(
    async (action: () => Promise<void>, pids: number[]) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        setOrphans((current) => current.filter((o) => !pids.includes(o.pid)));
      } catch (err) {
        setError(errorMessage(err));
        api.listOrphans().then(setOrphans).catch(() => {});
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (orphans.length === 0) return null;

  return (
    <section className="orphan-banner">
      <header>
        <span className="orphan-icon" aria-hidden="true">
          ⚠
        </span>
        <div>
          <strong>
            {orphans.length === 1
              ? t("1 process from a previous session is still running")
              : t("{count} processes from a previous session are still running", { count: orphans.length })}
          </strong>
          <p>
            {t("DevHub did not shut down cleanly, so these kept going. Stopping one ends its whole process tree.")}
          </p>
        </div>
        <span className="spacer" />
        <Button
          size="sm"
          variant="destructive"
          disabled={busy}
          onClick={() =>
            act(() => api.stopAllOrphans(), orphans.map((o) => o.pid))
          }
        >
          {t("Stop all")}
        </Button>
      </header>

      {error ? <p className="orphan-error">{error}</p> : null}

      <ul className="orphan-list">
        {orphans.map((orphan) => (
          <li key={orphan.pid}>
            <span className="orphan-name">
              {orphan.project_name}
              <span style={{ color: "var(--text-faint)" }}> / {orphan.command_id}</span>
            </span>
            <code>{orphan.display_command}</code>
            <span className="orphan-pid">PID {orphan.pid}</span>
            <span className="spacer" />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => act(() => api.dismissOrphan(orphan.pid), [orphan.pid])}
              title={t("Leave it running and stop tracking it")}
            >
              {t("Ignore")}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => act(() => api.stopOrphan(orphan.pid), [orphan.pid])}
            >
              {t("Stop")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
