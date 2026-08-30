import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Code2, Copy, Eraser, File as FileIcon, Image as ImageIcon, Link2, Search, Trash2, Type } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { PageHeader } from "../components/common/PageHeader";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useDevHub } from "../hooks/useDevHub";
import { api, onClipboardChange } from "../lib/api";
import { highlightCode } from "../lib/codeHighlight";
import type { ClipboardEntry, ClipboardSnapshot } from "../lib/types";

type ClipboardFilter = "all" | "text" | "image" | "file" | "code";

export function ClipboardPage() {
  const { report } = useDevHub();
  const [snapshot, setSnapshot] = useState<ClipboardSnapshot | null>(null);
  const [filter, setFilter] = useState<ClipboardFilter>("all");
  const [query, setQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ entry: ClipboardEntry; dataUrl: string } | null>(null);

  const refresh = useCallback(() => {
    api.clipboardSnapshot().then(setSnapshot).catch(report);
  }, [report]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    api.clipboardSnapshot().then((value) => { if (active) setSnapshot(value); }).catch(report);
    onClipboardChange(() => { if (active) refresh(); })
      .then((stop) => { unlisten = stop; })
      .catch(report);
    return () => { active = false; unlisten?.(); };
  }, [refresh, report]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (snapshot?.entries ?? []).filter((entry) => {
      if (filter === "text" && entry.kind !== "text") return false;
      if (filter === "image" && entry.kind !== "image") return false;
      if (filter === "file" && entry.kind !== "file") return false;
      if (filter === "code" && entry.kind !== "code" && entry.kind !== "link") return false;
      return !needle
        || entry.content?.toLowerCase().includes(needle)
        || entry.files?.some((file) => file.toLowerCase().includes(needle));
    });
  }, [filter, query, snapshot]);

  const groups = useMemo(() => [
    { id: "text", title: "Text", icon: Type, entries: visible.filter((entry) => entry.kind === "text") },
    { id: "image", title: "Images", icon: ImageIcon, entries: visible.filter((entry) => entry.kind === "image") },
    { id: "code", title: "Code & links", icon: Code2, entries: visible.filter((entry) => entry.kind === "code" || entry.kind === "link") },
    { id: "file", title: "Files", icon: FileIcon, entries: visible.filter((entry) => entry.kind === "file") },
  ].filter((group) => filter === "all" || group.id === filter), [filter, visible]);

  const copy = async (entry: ClipboardEntry) => {
    try {
      await api.copyClipboardEntry(entry.id);
      setCopiedId(entry.id);
      window.setTimeout(() => setCopiedId((current) => current === entry.id ? null : current), 1200);
    } catch (error) {
      report(error);
    }
  };

  const remove = async (entry: ClipboardEntry) => {
    try {
      await api.deleteClipboardEntry(entry.id);
      refresh();
    } catch (error) {
      report(error);
    }
  };

  const clear = async () => {
    if (!window.confirm("Clear all clipboard history? This cannot be undone.")) return;
    try {
      await api.clearClipboardHistory();
      refresh();
    } catch (error) {
      report(error);
    }
  };

  const openPreview = async (entry: ClipboardEntry) => {
    if (!entry.previewDataUrl) return;
    setPreview({ entry, dataUrl: entry.previewDataUrl });
    try {
      const dataUrl = await api.clipboardImageData(entry.id);
      if (dataUrl && dataUrl !== entry.previewDataUrl) {
        const img = new window.Image();
        img.onload = () => {
          setPreview((current) => current?.entry.id === entry.id ? { entry, dataUrl } : current);
        };
        img.src = dataUrl;
      }
    } catch (error) {
      report(error);
    }
  };

  const openLink = (entry: ClipboardEntry) => {
    if (!entry.content) return;
    openUrl(entry.content).catch(report);
  };

  if (!snapshot) return <div className="spinner-page">Loading clipboard…</div>;

  return (
    <div className="clipboard-page">
      <PageHeader
        className="clipboard-header"
        title="Clipboard"
        subtitle={(
          <>
            {snapshot.entries.length} items · kept {snapshot.retentionDays} days · {formatBytes(snapshot.totalBytes)} of {formatBytes(snapshot.capBytes)}
          </>
        )}
        actions={<div className="clipboard-toolbar">
          <label className="toolbar-search" htmlFor="clipboard-search">
            <Search aria-hidden="true" />
            <Input id="clipboard-search" type="search" value={query} placeholder="Search clipboard…" onChange={(event) => setQuery(event.target.value)} />
          </label>
          <Button variant="outline" size="sm" onClick={clear} disabled={snapshot.entries.length === 0}><Eraser />Clear</Button>
        </div>}
      />

      <Tabs className="clipboard-filter-tabs" value={filter} onValueChange={(value) => setFilter(value as ClipboardFilter)}>
        <TabsList className="clipboard-filter-list" aria-label="Filter clipboard history">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="text">Text</TabsTrigger>
          <TabsTrigger value="image">Images</TabsTrigger>
          <TabsTrigger className="clipboard-code-tab" value="code">Code & links</TabsTrigger>
          <TabsTrigger value="file">Files</TabsTrigger>
        </TabsList>
      </Tabs>

      {visible.length === 0 ? (
        <div className="empty-state clipboard-empty">
          <h3>{snapshot.entries.length === 0 ? "Copy something to get started" : "No matching clipboard items"}</h3>
          <p>{snapshot.entries.length === 0 ? "Text and images you copy will appear here automatically." : "Try another search or content filter."}</p>
        </div>
      ) : (
        <div className={`clipboard-columns ${groups.length === 1 ? "is-single" : ""}`}>
          {groups.map((group) => (
            <section className={`clipboard-column is-${group.id}`} key={group.id}>
              <header>
                <group.icon />
                <strong>{group.title}</strong>
                <span>{group.entries.length}</span>
              </header>
              <div className="clipboard-column-body">
                {group.entries.length === 0 ? <p className="clipboard-column-empty">Nothing here yet.</p> : group.entries.map((entry) => (
                  <ClipboardCard
                    key={entry.id}
                    entry={entry}
                    copied={copiedId === entry.id}
                    onCopy={() => copy(entry)}
                    onDelete={() => remove(entry)}
                    onPreview={() => openPreview(entry)}
                    onOpenLink={() => openLink(entry)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={preview !== null} onOpenChange={(open) => { if (!open) setPreview(null); }}>
        {preview ? (
          <DialogContent className="clipboard-preview-dialog">
            <DialogHeader>
              <DialogTitle>Clipboard image</DialogTitle>
              <DialogDescription>
                {preview.entry.width ?? "—"} × {preview.entry.height ?? "—"} · {formatBytes(preview.entry.byteSize)}
              </DialogDescription>
            </DialogHeader>
            <div className="clipboard-preview-stage">
              <img src={preview.dataUrl} alt={`Clipboard preview ${preview.entry.width ?? ""}×${preview.entry.height ?? ""}`} />
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

function ClipboardCard({ entry, copied, onCopy, onDelete, onPreview, onOpenLink }: {
  entry: ClipboardEntry;
  copied: boolean;
  onCopy: () => void;
  onDelete: () => void;
  onPreview: () => void;
  onOpenLink: () => void;
}) {
  const isCode = entry.kind === "code";
  const highlighted = useMemo(() => isCode && entry.content ? highlightCode(entry.content) : null, [entry.content, isCode]);
  return (
    <article className={`clipboard-card is-${entry.kind}`}>
      {entry.kind === "image" && entry.previewDataUrl ? (
        <button className="clipboard-image-button" type="button" onClick={onPreview} aria-label="Preview clipboard image">
          <img src={entry.previewDataUrl} alt={`Clipboard image ${entry.width ?? ""}×${entry.height ?? ""}`} />
        </button>
      ) : entry.kind === "file" ? (
        <div className="clipboard-files">
          {(entry.files ?? []).map((file) => (
            <div key={file}><FileIcon /><span title={file}>{file.split(/[\\/]/).pop() || file}</span></div>
          ))}
        </div>
      ) : entry.kind === "link" ? (
        <button className="clipboard-link" type="button" onClick={onOpenLink} title="Open in browser"><Link2 /><span>{entry.content}</span></button>
      ) : isCode ? (
        <>
          <div className="clipboard-code-head"><Code2 /><strong>CODE · {highlighted?.language ?? "text"}</strong></div>
          <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted?.html ?? "" }} /></pre>
        </>
      ) : (
        <p>{entry.content}</p>
      )}
      <footer>
        <span>{formatAge(entry.copiedAt)}</span>
        <span>{formatBytes(entry.byteSize)}</span>
        {entry.copyCount > 1 ? <span>{entry.copyCount} copies</span> : null}
        <span className="spacer" />
        <Button variant="ghost" size="icon-xs" title="Copy again" aria-label="Copy again" onClick={onCopy}>
          {copied ? <Check /> : <Copy />}
        </Button>
        <Button variant="ghost" size="icon-xs" className="clipboard-delete" title="Delete" aria-label="Delete clipboard item" onClick={onDelete}><Trash2 /></Button>
      </footer>
    </article>
  );
}

function formatAge(timestamp: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
