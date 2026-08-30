import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Home,
  Inbox,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  Users,
  X,
} from "lucide-react";

import { ActivityCard } from "../components/activity/ActivityCard";
import { ColumnDialog } from "../components/activity/ColumnDialog";
import { GitHubConnect } from "../components/activity/GitHubConnect";
import { PageHeader } from "../components/common/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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
  const [authRequired, setAuthRequired] = useState(false);
  const [editing, setEditing] = useState<ActivityColumn | null>(null);
  const [creating, setCreating] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);
  const [dragTargetColumnId, setDragTargetColumnId] = useState<string | null>(null);

  const load = useCallback(async (force: boolean, showGlobalLoading = true) => {
    if (showGlobalLoading) setLoading(true);
    setError(null);
    try {
      const current = await api.githubStatus();
      setStatus(current);
      if (!current.connected) {
        setBoard(null);
        setAuthRequired(false);
        return;
      }
      const nextBoard = await api.activityBoard(force);
      setBoard(nextBoard);
      setAuthRequired(false);
    } catch (err) {
      const message = errorMessage(err);
      if (message === "GitHub authentication required.") {
        setAuthRequired(true);
        setBoard(null);
      } else {
        setError(message);
      }
    } finally {
      if (showGlobalLoading) setLoading(false);
    }
  }, []);

  useEffect(() => { load(false); }, [load]);

  const savedIds = useMemo(() => new Set(board?.saved ?? []), [board]);
  // Read through a ref so toggleSave keeps a stable identity: it is handed to
  // every memoised ActivityCard, and a new closure per board update would undo
  // the memoisation.
  const savedIdsRef = useRef(savedIds);
  savedIdsRef.current = savedIds;
  const toggleSave = useCallback(async (item: ActivityItem) => {
    try {
      const wasSaved = savedIdsRef.current.has(item.id);
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
  }, [report, load]);

  const columnAction = async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action();
      await load(false, false);
    } catch (err) {
      report(err);
    }
  };

  const moveColumn = async (sourceId: string, targetId: string) => {
    if (!board) return;
    const from = board.columns.findIndex((item) => item.id === sourceId);
    const to = board.columns.findIndex((item) => item.id === targetId);
    if (from < 1 || to < 1 || from === to) return;

    setBoard((current) => {
      if (!current) return current;
      const columns = [...current.columns];
      const currentFrom = columns.findIndex((item) => item.id === sourceId);
      const currentTo = columns.findIndex((item) => item.id === targetId);
      if (currentFrom < 1 || currentTo < 1 || currentFrom === currentTo) return current;
      const [moved] = columns.splice(currentFrom, 1);
      columns.splice(currentTo, 0, moved);
      return { ...current, columns };
    });

    try {
      await api.moveColumn(sourceId, to - from);
    } catch (err) {
      report(err);
      await load(false, false);
    }
  };

  if (status === null) return <ActivityPageLoading />;

  if (!status.connected || authRequired) {
    return (
      <>
        <PageHeader title="GitHub Activity" subtitle={authRequired ? "Your session has expired" : "Not connected"} />
        <GitHubConnect
          reconnect={authRequired}
          onReport={report}
          onConnected={() => { setAuthRequired(false); void load(true); }}
        />
      </>
    );
  }

  return (
    <div className="activity-board-page">
      <PageHeader
        className="activity-board-header"
        title="GitHub Activity"
        actions={<div className="page-actions">
          <Button variant={showSaved ? "default" : "outline"} size="sm" onClick={() => setShowSaved((value) => !value)}><Bookmark />Saved</Button>
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}><Plus />Column</Button>
          <Button variant="outline" size="sm" onClick={() => load(true)} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />{loading ? "Refreshing" : "Refresh"}</Button>
          <Button variant="ghost" size="sm" onClick={() => columnAction(async () => { await api.clearGithubToken(); setBoard(null); })}>Disconnect</Button>
        </div>}
      />

      {error ? <div className="activity-error">{error}</div> : null}

      {board ? (
        <div className="activity-stage">
          <div className={`board ${draggedColumnId ? "is-column-dragging" : ""}`}>
            {showSaved ? <SavedColumn onToggleSave={toggleSave} onClose={() => setShowSaved(false)} onReport={report} /> : null}
            {board?.columns.map((column) => (
              <Column
                key={column.id}
                column={column}
                savedIds={savedIds}
                isDashboard={column.id === "dashboard"}
                onToggleSave={toggleSave}
                onEdit={() => setEditing(column)}
                onAction={columnAction}
                draggedColumnId={draggedColumnId}
                dragTargetColumnId={dragTargetColumnId}
                onDragStart={setDraggedColumnId}
                onDragMove={setDragTargetColumnId}
                onDragEnd={() => { setDraggedColumnId(null); setDragTargetColumnId(null); }}
                onMove={(sourceId, targetId) => void moveColumn(sourceId, targetId)}
                onReport={report}
              />
            ))}
            <button className="board-add" onClick={() => setCreating(true)}><Plus /><span>Add column</span></button>
          </div>

        </div>
      ) : <ActivityPageLoading />}

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

function ActivityPageLoading() {
  return (
    <div className="activity-page-loading" role="status" aria-live="polite">
      <LoaderCircle className="ui-spinner" aria-hidden="true" />
      <span>Loading GitHub activity…</span>
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

function Column({ column, savedIds, isDashboard, onToggleSave, onEdit, onAction, draggedColumnId, dragTargetColumnId, onDragStart, onDragMove, onDragEnd, onMove, onReport }: {
  column: BoardColumn;
  savedIds: Set<string>;
  isDashboard: boolean;
  onToggleSave: (item: ActivityItem) => void;
  onEdit: () => void;
  onAction: (action: () => Promise<unknown>) => Promise<void>;
  draggedColumnId: string | null;
  dragTargetColumnId: string | null;
  onDragStart: (columnId: string) => void;
  onDragMove: (columnId: string | null) => void;
  onDragEnd: () => void;
  onMove: (sourceId: string, targetId: string) => void;
  onReport: (err: unknown) => void;
}) {
  const [pendingFilter, setPendingFilter] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dashboardActor, setDashboardActor] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const pointerDrag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    targetId: string | null;
  } | null>(null);

  const configuredQuickFilter = column.filters.types.length === 0
    ? "all"
    : column.filters.types.length === 1
      ? column.filters.types[0]
      : "mixed";
  const activeQuickFilter = pendingFilter ?? configuredQuickFilter;

  const setQuickFilter = async (type: ActivityType | null) => {
    const value = type ?? "all";
    if (value === activeQuickFilter && column.filters.states.length === 0) return;
    setPendingFilter(value);
    const filters = {
      ...column.filters,
      types: type ? [type] : [],
      // Quick tabs filter by activity kind only. Issue includes both open and
      // closed issues; state-specific filtering belongs in explicit filters.
      states: [],
    };
    try {
      await onAction(() => api.updateColumn(column.id, column.title, filters));
    } finally {
      setPendingFilter(null);
    }
  };
  const isUserColumn = (column.filters.users?.length ?? 0) > 0;
  const quickFilters = isDashboard || isUserColumn ? DASHBOARD_FILTERS : QUICK_FILTERS;
  const ColumnIcon = isDashboard ? Home : isUserColumn ? UserRound : Inbox;

  const people = useMemo(() => {
    const seen = new Map<string, { login: string; avatar: string | null }>();
    for (const item of column.items) {
      if (!item.actor) continue;
      const key = item.actor.toLowerCase();
      const existing = seen.get(key);
      if (!existing || (!existing.avatar && item.actorAvatar)) {
        seen.set(key, { login: item.actor, avatar: item.actorAvatar });
      }
    }
    return [...seen.values()].slice(0, 20);
  }, [column.items]);

  useEffect(() => {
    if (dashboardActor && !people.some((person) => person.login.toLowerCase() === dashboardActor.toLowerCase())) {
      setDashboardActor(null);
    }
  }, [dashboardActor, people]);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
    else searchInputRef.current?.blur();
  }, [searchOpen]);

  const visibleItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return column.items.filter((item) => {
      if (dashboardActor && item.actor?.toLowerCase() !== dashboardActor.toLowerCase()) return false;
      if (!query) return true;
      const text = [
        item.title,
        item.repository,
        item.actor,
        item.action,
        ...(item.labels?.map((label) => label.name) ?? []),
      ].filter(Boolean).join(" ").toLowerCase();
      return text.includes(query);
    });
  }, [column.items, dashboardActor, searchQuery]);

  return (
    <section
      data-column-id={column.id}
      className={`column ${isDashboard ? "is-dashboard" : ""} ${isUserColumn ? "is-user" : ""} ${dragTargetColumnId === column.id ? "is-drag-over" : ""} ${draggedColumnId === column.id ? "is-dragging" : ""}`}
    >
      <header
        className={`column-head ${!isDashboard ? "is-draggable" : ""}`}
        title={!isDashboard ? "Drag header to reorder column" : undefined}
        onPointerDown={(event) => {
          if (isDashboard || event.button !== 0 || (event.target as HTMLElement).closest("button, input, [role='menuitem']")) return;
          event.preventDefault();
          pointerDrag.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            active: false,
            targetId: null,
          };
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            // Some embedded WebViews can reject capture while a native gesture
            // is being negotiated. Header-local pointer events still work.
          }
        }}
        onPointerMove={(event) => {
          const drag = pointerDrag.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
          event.preventDefault();
          if (!drag.active) {
            drag.active = true;
            onDragStart(column.id);
          }
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(".column[data-column-id]");
          const targetId = target?.dataset.columnId;
          const nextTarget = targetId && targetId !== "dashboard" && targetId !== column.id ? targetId : null;
          if (nextTarget !== drag.targetId) {
            drag.targetId = nextTarget;
            onDragMove(nextTarget);
          }
        }}
        onPointerUp={(event) => {
          const drag = pointerDrag.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          try {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          } catch {
            // Capture may already have been released by the WebView.
          }
          if (drag.active && drag.targetId) onMove(column.id, drag.targetId);
          pointerDrag.current = null;
          onDragEnd();
        }}
        onPointerCancel={() => { pointerDrag.current = null; onDragEnd(); }}
      >
        <ColumnIcon className="column-icon" />
        <div className="column-title">{column.title}</div>
        {!isDashboard ? <div className="column-actions">
          <Button variant="ghost" size="icon-xs" title="Search column" aria-pressed={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search /></Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-xs" title="Column menu"><MoreHorizontal /></Button></DropdownMenuTrigger>
            <DropdownMenuContent className="column-menu-content" align="end">
              <DropdownMenuItem onSelect={onEdit}><Pencil />Edit column</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => { if (window.confirm(`Remove the “${column.title}” column?`)) onAction(() => api.removeColumn(column.id)); }}><Trash2 />Remove column</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div> : <div className="dashboard-head-actions"><span className="dashboard-caption">Your feed</span><Button variant="ghost" size="icon-xs" title="Search column" aria-pressed={searchOpen} onClick={() => setSearchOpen((value) => !value)}><Search /></Button></div>}
      </header>

      <div className={`column-search ${searchOpen ? "is-open" : ""}`} aria-hidden={!searchOpen}>
          <Search aria-hidden="true" />
          <Input
            ref={searchInputRef}
            tabIndex={searchOpen ? 0 : -1}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search this column…"
            aria-label={`Search ${column.title}`}
          />
          <Button variant="ghost" size="icon-xs" tabIndex={searchOpen ? 0 : -1} aria-label="Close search" onClick={() => { setSearchQuery(""); setSearchOpen(false); }}><X /></Button>
        </div>

      {isDashboard && people.length > 0 ? (
        <div className="dashboard-people" aria-label="Filter Dashboard by user">
          <button className={!dashboardActor ? "is-active" : ""} onClick={() => setDashboardActor(null)}>
            <span className="dashboard-person-all"><Users /></span>
            <span>All</span>
          </button>
          {people.map((person) => (
            <button
              key={person.login}
              className={dashboardActor?.toLowerCase() === person.login.toLowerCase() ? "is-active" : ""}
              onClick={() => setDashboardActor(person.login)}
            >
              {person.avatar ? <img src={person.avatar} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="dashboard-person-fallback"><UserRound /></span>}
              <span>{person.login}</span>
            </button>
          ))}
        </div>
      ) : null}

      {!isDashboard ? <div className="column-filters">
        <Tabs className="w-full" value={activeQuickFilter} onValueChange={(value) => void setQuickFilter(value === "all" ? null : value as ActivityType)}>
          <TabsList className="w-full activity-tabs-list" aria-label={`Filter ${column.title} feed`}>
            {quickFilters.map((filter) => (
              <TabsTrigger disabled={pendingFilter !== null} key={filter.label} value={filter.type ?? "all"}>
                {filter.label}
                {pendingFilter === (filter.type ?? "all") ? <LoaderCircle className="column-tab-spinner ui-spinner" aria-hidden="true" /> : null}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {pendingFilter !== null ? <span className="sr-only" role="status">Loading {column.title}</span> : null}
      </div> : null}
      <div className="column-body">
        <IncrementalActivityList
          items={visibleItems}
          emptyMessage={searchQuery || dashboardActor ? "No matching activity." : "Nothing here."}
          savedIds={savedIds}
          onToggleSave={onToggleSave}
          onReport={onReport}
        />
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
  const toggleSave = useCallback((item: ActivityItem) => {
    void onToggleSave(item).then(reload).catch(onReport);
  }, [onToggleSave, reload, onReport]);
  return (
    <section className="column is-saved-column">
      <header className="column-head">
        <Bookmark className="column-icon" />
        <div className="column-title">Saved</div>
        <div className="column-actions is-visible"><Button variant="ghost" size="icon-xs" title="Close" onClick={onClose}><X /></Button></div>
      </header>
      <div className="column-filters"><span className="saved-caption">Items kept for later</span></div>
      <div className="column-body">
        {items === null ? <p className="column-empty">Loading…</p> : (
          <IncrementalActivityList
            items={items}
            emptyMessage="Nothing saved yet."
            savedIds={new Set(items.map((item) => item.id))}
            onToggleSave={toggleSave}
            onReport={onReport}
          />
        )}
      </div>
    </section>
  );
}

const ACTIVITY_PAGE_SIZE = 20;

function IncrementalActivityList({ items, emptyMessage, savedIds, onToggleSave, onReport }: {
  items: ActivityItem[];
  emptyMessage: string;
  savedIds: Set<string>;
  onToggleSave: (item: ActivityItem) => void;
  onReport: (err: unknown) => void;
}) {
  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE);
  const loadMoreRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setLimit(ACTIVITY_PAGE_SIZE), [items]);

  const hasMore = limit < items.length;
  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !hasMore || typeof IntersectionObserver === "undefined") return;
    const root = target.closest(".column-body");
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setLimit((current) => Math.min(current + ACTIVITY_PAGE_SIZE, items.length));
    }, { root, rootMargin: "180px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, items.length, limit]);

  if (items.length === 0) return <p className="column-empty">{emptyMessage}</p>;

  return (
    <>
      {items.slice(0, limit).map((item) => (
        <ActivityCard
          key={item.id}
          item={item}
          saved={savedIds.has(item.id)}
          onToggleSave={onToggleSave}
          onReport={onReport}
        />
      ))}
      {hasMore ? (
        <button
          ref={loadMoreRef}
          type="button"
          className="column-load-more"
          onClick={() => setLimit((current) => Math.min(current + ACTIVITY_PAGE_SIZE, items.length))}
        >
          Load more
        </button>
      ) : null}
    </>
  );
}
