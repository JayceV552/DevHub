import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  Code2,
  Copy,
  File as FileIcon,
  Image as ImageIcon,
  Link2,
  MemoryStick,
  RefreshCw,
  Type,
} from "lucide-react";

import { api, onClipboardChange } from "../../lib/api";
import type { ClipboardEntry, ClipboardSnapshot, SystemMemorySnapshot } from "../../lib/types";
import { Button } from "../ui/button";

export function OverviewPanels({ onNavigate, onReport }: {
  onNavigate: (page: string) => void;
  onReport: (error: unknown) => void;
}) {
  const [clipboard, setClipboard] = useState<ClipboardSnapshot | null>(null);
  const [memory, setMemory] = useState<SystemMemorySnapshot | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refreshClipboard = useCallback(() => {
    api.clipboardSnapshot().then(setClipboard).catch(onReport);
  }, [onReport]);

  const refreshMemory = useCallback(() => {
    setMemoryLoading(true);
    api.systemMemory()
      .then(setMemory)
      .catch(onReport)
      .finally(() => setMemoryLoading(false));
  }, [onReport]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    api.clipboardSnapshot().then((snapshot) => { if (active) setClipboard(snapshot); }).catch(onReport);
    onClipboardChange(() => { if (active) refreshClipboard(); })
      .then((stop) => { unlisten = stop; })
      .catch(onReport);
    return () => { active = false; unlisten?.(); };
  }, [onReport, refreshClipboard]);

  useEffect(() => {
    let active = true;
    api.systemMemory().then((snapshot) => { if (active) setMemory(snapshot); }).catch(onReport);
    const timer = window.setInterval(() => {
      api.systemMemory().then((snapshot) => { if (active) setMemory(snapshot); }).catch(onReport);
    }, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [onReport]);

  const recent = clipboard?.entries.slice(0, 5) ?? [];
  const largestConsumer = useMemo(
    () => Math.max(1, ...(memory?.consumers.map((consumer) => consumer.residentBytes) ?? [])),
    [memory],
  );

  const copy = async (entry: ClipboardEntry) => {
    try {
      await api.copyClipboardEntry(entry.id);
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((current) => current === entry.id ? null : current), 1_200);
    } catch (error) {
      onReport(error);
    }
  };

  return (
    <div className="overview-panels section">
      <section className="overview-panel recent-clipboard-panel">
        <header className="overview-panel-header">
          <div className="overview-panel-title"><Clipboard /><div><h2>Recent clipboard</h2><p>The latest items captured by DevHub</p></div></div>
          <Button variant="ghost" size="sm" onClick={() => onNavigate("clipboard")}>View all</Button>
        </header>
        {recent.length === 0 ? (
          <div className="overview-panel-empty">Your recent clipboard items will appear here.</div>
        ) : (
          <div className="recent-clipboard-list">
            {recent.map((entry) => {
              const Icon = clipboardIcon(entry);
              return (
                <button key={entry.id} className="recent-clipboard-item" onClick={() => void copy(entry)}>
                  {entry.kind === "image" && entry.previewDataUrl
                    ? <img src={entry.previewDataUrl} alt="Clipboard preview" />
                    : <span className={`clipboard-kind-icon is-${entry.kind}`}><Icon /></span>}
                  <span className="recent-clipboard-copy">
                    <strong>{clipboardTitle(entry)}</strong>
                    <small>{formatRelative(entry.copiedAt)}</small>
                  </span>
                  <span className="recent-clipboard-action">{copiedId === entry.id ? <Check /> : <Copy />}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="overview-panel memory-panel">
        <header className="overview-panel-header">
          <div className="overview-panel-title"><MemoryStick /><div><h2>System memory</h2><p>{memory ? `${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)} used` : "Loading current usage…"}</p></div></div>
          <Button variant="ghost" size="icon-sm" title="Refresh memory usage" onClick={refreshMemory} disabled={memoryLoading}>
            <RefreshCw className={memoryLoading ? "animate-spin" : ""} />
          </Button>
        </header>
        {memory?.consumers.length ? (
          <div className="memory-consumer-list">
            {memory.consumers.map((consumer, index) => (
              <div className="memory-consumer" key={consumer.name}>
                <span className="memory-rank">{index + 1}</span>
                <div className="memory-consumer-main">
                  <div><strong>{consumer.name}</strong><span>{formatBytes(consumer.residentBytes)}</span></div>
                  <div className="memory-meter"><i style={{ width: `${Math.max(4, consumer.residentBytes / largestConsumer * 100)}%` }} /></div>
                </div>
                {consumer.processCount > 1 ? <small>{consumer.processCount} processes</small> : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="overview-panel-empty">Loading running applications…</div>
        )}
      </section>
    </div>
  );
}

function clipboardIcon(entry: ClipboardEntry) {
  if (entry.kind === "image") return ImageIcon;
  if (entry.kind === "file") return FileIcon;
  if (entry.kind === "code") return Code2;
  if (entry.kind === "link") return Link2;
  return Type;
}

function clipboardTitle(entry: ClipboardEntry): string {
  if (entry.kind === "image") {
    return entry.width && entry.height ? `Image · ${entry.width} × ${entry.height}` : "Image";
  }
  if (entry.files?.length) {
    const name = entry.files[0].split(/[\\/]/).pop() ?? entry.files[0];
    return entry.files.length === 1 ? name : `${name} +${entry.files.length - 1}`;
  }
  const content = entry.content?.replace(/\s+/g, " ").trim();
  return content || "Empty clipboard item";
}

function formatRelative(value: string): string {
  const elapsed = Math.max(0, Date.now() - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
