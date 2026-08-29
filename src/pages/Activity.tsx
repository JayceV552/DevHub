import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Home,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { ActivityCard } from "../components/activity/ActivityCard";
import { ColumnDialog } from "../components/activity/ColumnDialog";
import { GitHubConnect } from "../components/activity/GitHubConnect";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useDevHub } from "../hooks/useDevHub";
import { api, errorMessage } from "../lib/api";
import type { ActivityColumn, ActivityItem, ActivityType, Board, BoardColumn, GitHubStatus } from "../lib/types";

export function ActivityPage() {
  const { report } = useDevHub();
  const [board, setBoard] = useState<Board | null>(null);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ActivityColumn | null>(null);
  const [creating, setCreating] = useState(false);
  const [showSaved, setShowSaved] = useState(false);

  const load = useCallback(async (force: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const current = await api.githubStatus();
      setStatus(current);
      if (!current.connected) {
        setBoard(null);
        return;
      }
      const nextBoard = await api.activityBoard(force);
      setBoard(nextBoard);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const savedIds = useMemo(() => new Set(board?.saved ?? []), [board]);
  const totalItems = board?.columns.reduce((sum, column) => sum + column.items.length, 0) ?? 0;

  const toggleSave = async (item: ActivityItem) => {
    try {
      const wasSaved = savedIds.has(item.id);
      if (wasSaved) await api.unsaveItem(item.id);
      else await api.saveItem(item);
      setBoard((current) => current ? {
        ...current,
        saved: wasSaved ? current.saved.filter((id) => id !== item.id) : [...current.saved, item.id],
      } : current);
    } catch (err) {
      report(err);
      load(false);
    }
  };

  const columnAction = async (action: () => Promise<unknown>) => {
    try {
      await action();
      await load(false);
    } catch (err) {
      report(err);
    }
  };

  if (status === null) return <div className="spinner-page">Loading GitHub activity…</div>;

  if (!status.connected) {
    return (
      <>
        <div className="page-header"><div><h1 className="page-title">GitHub Activity</h1><p className="page-subtitle">Not connected</p></div></div>
        <GitHubConnect onReport={report} onConnected={() => load(true)} />
      </>
    );
  }

  return (
    <div className="activity-board-page">
      <div className="page-header activity-board-header">
        <div>
          <h1 className="page-title">GitHub Activity</h1>
          <p className="page-subtitle">
            {board?.columns.length ?? 0} columns · {totalItems} items
          </p>
        </div>
        <div className="page-actions">
          <Button variant={showSaved ? "default" : "outline"} size="sm" onClick={() => setShowSaved((value) => !value)}><Bookmark />Saved</Button>
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}><Plus />Column</Button>
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />{loading ? "Refreshing" : "Refresh"}</Button>
          <Button variant="ghost" size="sm" onClick={() => columnAction(async () => { await api.clearGithubToken(); setBoard(null); })}>Disconnect</Button>
        </div>
      </div>

      {error ? <div className="activity-error">{error}</div> : null}

      {board ? (
        <div className="activity-stage">
          <div className="board">
            {showSaved ? <SavedColumn onToggleSave={toggleSave} onClose={() => setShowSaved(false)} onReport={report} /> : null}
            {board?.columns.map((column, index) => (
              <Column
                key={column.id}
                column={column}
                savedIds={savedIds}
                isFirst={index <= 1}
                isLast={index === board.columns.length - 1}
                isDashboard={column.id === "dashboard"}
                onToggleSave={toggleSave}
                onEdit={() => setEditing(column)}
                onAction={columnAction}
                onReport={report}
              />
            ))}
            <button className="board-add" onClick={() => setCreating(true)}><Plus /><span>Add column</span></button>
          </div>

        </div>
      ) : <div className="spinner-page">Loading GitHub activity…</div>}

      {creating || editing ? (
        <ColumnDialog
          column={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => load(false)}
        />
      ) : null}
    </div>
  );
}

const QUICK_FILTERS: Array<{ label: string; type: ActivityType | null }> = [
  { label: "All", type: null },
  { label: "PR", type: "pullRequest" },
  { label: "Issue", type: "issue" },
  { label: "Discuss", type: "discussion" },
  { label: "Release", type: "release" },
];

const DASHBOARD_FILTERS: Array<{ label: string; type: ActivityType | null }> = [
  { label: "All", type: null },
  { label: "Push", type: "commit" },
  { label: "PR", type: "pullRequest" },
  { label: "Issue", type: "issue" },
  { label: "Star", type: "star" },
];

function Column({ column, savedIds, isFirst, isLast, isDashboard, onToggleSave, onEdit, onAction, onReport }: {
  column: BoardColumn;
  savedIds: Set<string>;
  isFirst: boolean;
  isLast: boolean;
  isDashboard: boolean;
  onToggleSave: (item: ActivityItem) => void;
  onEdit: () => void;
  onAction: (action: () => Promise<unknown>) => void;
  onReport: (err: unknown) => void;
}) {
  const activeQuickFilter = column.filters.types.length === 0
    ? "all"
    : column.filters.types.length === 1
      ? column.filters.types[0]
      : "mixed";

  const setQuickFilter = (type: ActivityType | null) => {
    const filters = { ...column.filters, types: type ? [type] : [] };
    onAction(() => api.updateColumn(column.id, column.title, filters));
  };
  const quickFilters = isDashboard ? DASHBOARD_FILTERS : QUICK_FILTERS;
  const ColumnIcon = isDashboard ? Home : Inbox;

  return (
    <section className={`column ${isDashboard ? "is-dashboard" : ""}`}>
      <header className="column-head">
        <ColumnIcon className="column-icon" />
        <div className="column-title">{column.title}{column.items.length > 0 ? <span className="column-badge">{column.items.length}</span> : null}</div>
        {!isDashboard ? <div className="column-actions">
          <Button variant="ghost" size="icon-xs" title="Edit filters" onClick={onEdit}><Search /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" title="Column menu"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}><Pencil />Edit column</DropdownMenuItem>
              <DropdownMenuItem disabled={isFirst} onSelect={() => onAction(() => api.moveColumn(column.id, -1))}><ArrowLeft />Move left</DropdownMenuItem>
              <DropdownMenuItem disabled={isLast} onSelect={() => onAction(() => api.moveColumn(column.id, 1))}><ArrowRight />Move right</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => { if (window.confirm(`Remove the “${column.title}” column?`)) onAction(() => api.removeColumn(column.id)); }}><Trash2 />Remove column</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div> : <span className="dashboard-caption">Your feed</span>}
      </header>
      <div className="column-filters">
        <Tabs className="w-full" value={activeQuickFilter} onValueChange={(value) => setQuickFilter(value === "all" ? null : value as ActivityType)}>
          <TabsList className="w-full" aria-label={`Filter ${column.title} feed`}>
            {quickFilters.map((filter) => (
              <TabsTrigger key={filter.label} value={filter.type ?? "all"}>{filter.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="column-body">
        {column.items.length === 0 ? <p className="column-empty">Nothing here.</p> : column.items.map((item) => (
          <ActivityCard
            key={item.id}
            item={item}
            saved={savedIds.has(item.id)}
            onToggleSave={() => onToggleSave(item)}
            onReport={onReport}
          />
        ))}
      </div>
    </section>
  );
}

function SavedColumn({ onToggleSave, onClose, onReport }: {
  onToggleSave: (item: ActivityItem) => Promise<void>;
  onClose: () => void;
  onReport: (err: unknown) => void;
}) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const reload = useCallback(() => { api.listSaved().then(setItems).catch(onReport); }, [onReport]);
  useEffect(reload, [reload]);
  return (
    <section className="column is-saved-column">
      <header className="column-head">
        <Bookmark className="column-icon" />
        <div className="column-title">Saved{items?.length ? <span className="column-badge">{items.length}</span> : null}</div>
        <div className="column-actions is-visible"><Button variant="ghost" size="icon-xs" title="Close" onClick={onClose}><X /></Button></div>
      </header>
      <div className="column-filters"><span className="saved-caption">Items kept for later</span></div>
      <div className="column-body">
        {items === null ? <p className="column-empty">Loading…</p> : items.length === 0 ? <p className="column-empty">Nothing saved yet.</p> : items.map((item) => (
          <ActivityCard
            key={item.id}
            item={item}
            saved
            onToggleSave={() => onToggleSave(item).then(reload).catch(onReport)}
            onReport={onReport}
          />
        ))}
      </div>
    </section>
  );
}
