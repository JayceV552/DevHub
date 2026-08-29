import { useCallback, useEffect, useState } from "react";

import { api, errorMessage } from "../../lib/api";
import type { TrackedRun } from "../../lib/types";
import { Button } from "../ui/button";

export function OrphanBanner() {
  const [orphans, setOrphans] = useState<TrackedRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.listOrphans().then(setOrphans).catch(() => {});
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
            {orphans.length} process{orphans.length === 1 ? "" : "es"} from a previous session
            {orphans.length === 1 ? " is" : " are"} still running
          </strong>
          <p>
            DevHub did not shut down cleanly, so these kept going. Stopping one ends its whole
            process tree.
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
          Stop all
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
            <span className="orphan-pid">pid {orphan.pid}</span>
            <span className="spacer" />
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => act(() => api.dismissOrphan(orphan.pid), [orphan.pid])}
              title="Leave it running and stop tracking it"
            >
              Ignore
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => act(() => api.stopOrphan(orphan.pid), [orphan.pid])}
            >
              Stop
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
