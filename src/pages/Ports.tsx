import { useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  ExternalLink,
  RefreshCw,
  Search,
} from "lucide-react";

import { Button } from "../components/ui/button";
import { PageHeader } from "../components/common/PageHeader";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { useDevHub } from "../hooks/useDevHub";
import { api } from "../lib/api";
import type { PortEntry, PortOwnership, ProcessDescription } from "../lib/types";
import { useI18n } from "../lib/i18n";

export function PortsPage() {
  const { t } = useI18n();
  const { ports, refreshPorts, report } = useDevHub();
  const [process, setProcess] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [showEditorHelpers, setShowEditorHelpers] = useState(false);
  const [pendingKill, setPendingKill] = useState<{ entry: PortEntry; description: ProcessDescription | null } | null>(null);

  const editorHelperCount = ports.filter(isEditorHelper).length;
  const displayedPorts = useMemo(
    () => showEditorHelpers ? ports : ports.filter((entry) => !isEditorHelper(entry)),
    [ports, showEditorHelpers],
  );
  const managedCount = displayedPorts.filter((entry) => entry.ownership === "managed").length;
  const externalCount = displayedPorts.length - managedCount;

  const processCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of displayedPorts) {
      const name = entry.processName ?? "unknown";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([nameA, countA], [nameB, countB]) => countB - countA || nameA.localeCompare(nameB));
  }, [displayedPorts]);

  const visible = useMemo(() => {
    const needle = query.trim().replace(/^:/, "").toLowerCase();
    const filtered = displayedPorts.filter((entry) => {
      if (process !== null && (entry.processName ?? "unknown") !== process) return false;
      if (!needle) return true;
      return [String(entry.port), entry.processName, entry.projectName, entry.commandId, entry.pid !== null ? String(entry.pid) : null]
        .filter((value): value is string => value !== null && value !== undefined)
        .some((value) => value.toLowerCase().includes(needle));
    });

    return filtered.sort((a, b) => a.port - b.port);
  }, [displayedPorts, process, query]);

  const managed = visible.filter((entry) => entry.ownership === "managed");
  const external = visible.filter((entry) => entry.ownership === "external");

  const stop = async (entry: PortEntry) => {
    if (entry.ownership === "managed" && entry.runId) {
      try {
        await api.killPortProcess(entry.pid ?? 0, entry.runId);
        await refreshPorts();
      } catch (err) {
        report(err);
      }
      return;
    }
    if (entry.pid === null) return;
    try {
      setPendingKill({ entry, description: await api.describeProcess(entry.pid) });
    } catch (err) {
      report(err);
    }
  };

  const stopAllManaged = async () => {
    const unique = [...new Map(managed.filter((entry) => entry.runId).map((entry) => [entry.runId, entry])).values()];
    try {
      await Promise.all(unique.map((entry) => api.killPortProcess(entry.pid ?? 0, entry.runId)));
      await refreshPorts();
    } catch (err) {
      report(err);
    }
  };

  const confirmKill = async () => {
    if (!pendingKill?.entry.pid) return;
    try {
      await api.killPortProcess(pendingKill.entry.pid, null);
      setPendingKill(null);
      await refreshPorts();
    } catch (err) {
      report(err);
      setPendingKill(null);
    }
  };

  return (
    <>
      <PageHeader
        className="ports-page-header"
        title={t("Ports")}
        subtitle={(
          <>
            {t("{count} listening", { count: displayedPorts.length })} · <span className="text-success">{t("{count} started by DevHub", { count: managedCount })}</span> · {t("{count} external", { count: externalCount })}
            {!showEditorHelpers && editorHelperCount > 0 ? ` · ${t("{count} editor helper ports hidden", { count: editorHelperCount })}` : ""}
          </>
        )}
        actions={<div className="page-toolbar ports-toolbar">
          <label className="toolbar-search" htmlFor="port-search">
            <Search aria-hidden="true" />
            <Input id="port-search" type="search" value={query} placeholder=":5173 / node / dayflow…" onChange={(event) => setQuery(event.target.value)} />
          </label>
          {editorHelperCount > 0 ? (
            <Button variant="outline" size="sm" onClick={() => { setShowEditorHelpers((value) => !value); setProcess(null); }}>
              {showEditorHelpers ? <EyeOff /> : <Eye />}
              {showEditorHelpers ? t("Hide helpers") : t("Show helpers ({count})", { count: editorHelperCount })}
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={() => refreshPorts()}><RefreshCw />{t("Refresh")}</Button>
        </div>}
      />

      {processCounts.length > 1 ? (
        <div className={`chip-row-container ${filterExpanded ? "is-expanded" : ""}`}>
          <div className="chip-row">
            {processCounts.map(([name, count]) => (
              <Button
                key={name}
                variant="outline"
                size="sm"
                className={process === name ? "is-selected" : undefined}
                aria-pressed={process === name}
                onClick={() => setProcess(process === name ? null : name)}
              >
                {name}<span className="chip-count">{count}</span>
              </Button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="chip-expand-toggle"
            onClick={() => setFilterExpanded((prev) => !prev)}
            aria-expanded={filterExpanded}
          >
            {filterExpanded ? <ChevronUp /> : <ChevronDown />}
            <span>{filterExpanded ? t("Collapse") : t("Expand")}</span>
          </Button>
        </div>
      ) : null}

      {displayedPorts.length === 0 ? (
        <div className="empty-state">
          <h3>{editorHelperCount > 0 ? t("Only editor helpers are listening") : t("Nothing listening")}</h3>
          <p>{editorHelperCount > 0 ? t("Use Show helpers to inspect them.") : t("Start a development server and its TCP port will appear here.")}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state"><h3>{t("No matching ports")}</h3><p>{t("Try a different port, process or project filter.")}</p></div>
      ) : (
        <div className="ports-panel">
          <div className="ports-row is-head">
            <span>{t("Port")}</span><span>{t("Process")}</span><span>{t("Project · command")}</span><span>PID</span><span>{t("Address")}</span><span />
          </div>
          {managed.length > 0 ? (
            <PortsGroup ownership="managed" entries={managed} onOpen={(entry) => openUrl(`http://localhost:${entry.port}`).catch(report)} onStop={stop} onStopAll={stopAllManaged} />
          ) : null}
          {external.length > 0 ? (
            <PortsGroup ownership="external" entries={external} onOpen={(entry) => openUrl(`http://localhost:${entry.port}`).catch(report)} onStop={stop} />
          ) : null}
        </div>
      )}

      <Dialog open={pendingKill !== null} onOpenChange={(open) => { if (!open) setPendingKill(null); }}>
        {pendingKill ? (
          <DialogContent className="sm:max-w-[430px]">
            <DialogHeader className="is-danger">
              <span className="dialog-danger-icon"><AlertTriangle /></span>
              <div>
                <DialogTitle>{t("End this process?")}</DialogTitle>
                <DialogDescription>
                  {isEditorHelper(pendingKill.entry)
                    ? t("This is an editor helper. Ending it can interrupt code intelligence, and its parent app may restart it.")
                    : t("It was not started by DevHub. Its parent application may restart it automatically.")}
                </DialogDescription>
              </div>
            </DialogHeader>
            <div className="dialog-body">
              <dl className="dialog-kill-facts">
                <div><dt>{t("Process")}</dt><dd>{pendingKill.description?.name ?? pendingKill.entry.processName ?? t("unknown")}</dd></div>
                <div><dt>{t("Port · PID")}</dt><dd>{pendingKill.entry.port} · {pendingKill.entry.pid}</dd></div>
                <div><dt>{t("Address")}</dt><dd>{pendingKill.entry.address}</dd></div>
              </dl>
              {pendingKill.description?.command ? <div className="dialog-cmdline">{pendingKill.description.command}</div> : null}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setPendingKill(null)}>{t("Cancel")}</Button>
              <Button variant="destructive" onClick={confirmKill}>{t("End process")}</Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

function isEditorHelper(entry: PortEntry): boolean {
  const name = entry.processName?.toLowerCase().replace(/[ -]/g, "_") ?? "";
  return name === "language_server" || name.endsWith("_language_server");
}

function PortsGroup({ ownership, entries, onOpen, onStop, onStopAll }: {
  ownership: PortOwnership;
  entries: PortEntry[];
  onOpen: (entry: PortEntry) => void;
  onStop: (entry: PortEntry) => void;
  onStopAll?: () => void;
}) {
  const { t } = useI18n();
  const managed = ownership === "managed";
  return (
    <section>
      <div className={`ports-group ${ownership}`}>
        <span className="dot" />
        <span className="label">{managed ? t("Started by DevHub") : t("External processes")}</span>
        <span className="count">{entries.length}</span>
        <span className="end">
          {managed ? <button className="link-button" onClick={onStopAll}>{t("Stop all")}</button> : t("DevHub does not manage these · Kill requires confirmation")}
        </span>
      </div>
      {entries.map((entry) => (
        <div className="ports-row is-data" key={`${entry.port}-${entry.pid}-${entry.address}`}>
          <span className={`port-num ${ownership}`}><span className="dot" />{entry.port}</span>
          <span className="ports-cell-mono">{entry.processName ?? "—"}</span>
          <span className="ports-cell-owner">
            {entry.projectName ?? <span className="ports-cell-faint">—</span>}
            {entry.commandId ? <span className="cmd"> · {entry.commandId}</span> : null}
          </span>
          <span className="ports-cell-faint">{entry.pid ?? "—"}</span>
          <span className="ports-cell-faint" title={entry.address}>{entry.address}</span>
          <span className="ports-actions">
            <Button variant="outline" size="xs" className="port-open-button" onClick={() => onOpen(entry)}>{t("Open")}<ExternalLink /></Button>
            <Button variant={managed ? "outline" : "destructive"} size="xs" onClick={() => onStop(entry)} disabled={entry.pid === null}>
              {managed ? `■ ${t("Stop")}` : t("Kill")}
            </Button>
          </span>
        </div>
      ))}
    </section>
  );
}
