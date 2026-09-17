import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  CircleDot,
  ExternalLink,
  FolderOpen,
  LibraryBig,
  ListTodo,
  LoaderCircle,
  MessageCircle,
  X,
} from "lucide-react";
import { api } from "../../../lib/api";
import type { ActivityItem, RepositoryIssueGroup, TodoItem } from "../../../lib/types";
import { Button } from "../../ui/button";
import type { BoardCard } from "./types";
import { NOTE_COLORS } from "./types";
import { TodoNote } from "./TodoCard";
import { formatRelative, noop } from "./utils";

/** Locks the page behind a bottom drawer and wires Escape to close it. */
export function useDrawerChrome(onClose: () => void) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);
}

export function BoardDrawer({ cards, onClose, onOpenTodo, onRemoveTodo, onOpenIssue, onOpenFolder }: {
  cards: BoardCard[];
  onClose: () => void;
  onOpenTodo: (item: TodoItem) => void;
  onRemoveTodo: (item: TodoItem) => void;
  onOpenIssue: (item: ActivityItem) => void;
  onOpenFolder: (group: RepositoryIssueGroup) => void;
}) {
  useDrawerChrome(onClose);

  const todos = cards.flatMap((card) => card.kind === "todo" ? [card.item] : []);
  const issues = cards.flatMap((card) => card.kind === "issue" ? [card.item] : []);
  const folders = cards.flatMap((card) => card.kind === "folder" ? [card.group] : []);
  const openTodos = todos.filter((item) => !item.completed).length;

  return (
    <div className="issue-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="issue-drawer board-drawer" role="dialog" aria-modal="true" aria-label="Every item on the focus board">
        <header className="issue-drawer-header">
          <div className="issue-drawer-handle" />
          <div className="issue-drawer-heading">
            <span className="issue-drawer-folder"><ListTodo /></span>
            <div>
              <h2>Focus board</h2>
              <p>{todos.length} todos · {openTodos} still open · {issues.length + folders.length} repository cards</p>
            </div>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close board drawer"><X /></Button>
        </header>
        <div className="issue-drawer-body">
          <div className="board-drawer-content">
            {todos.length ? (
              <section className="board-drawer-section">
                <h3>Todos</h3>
                {/* Same notes as the board, so the drawer is the board unclipped. */}
                <div className="todo-note-grid board-drawer-notes">
                  {todos.map((item, index) => (
                    <TodoNote
                      key={item.id}
                      item={item}
                      color={NOTE_COLORS[index % NOTE_COLORS.length]}
                      registerRef={noop}
                      onOpen={() => onOpenTodo(item)}
                      onRemove={() => onRemoveTodo(item)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {folders.length || issues.length ? (
              <section className="board-drawer-section">
                <h3>Repository issues</h3>
                <div className="issue-drawer-list">
                  {folders.map((group) => (
                    <button key={group.repository} className="issue-drawer-row" onClick={() => onOpenFolder(group)}>
                      <span className="issue-drawer-state"><FolderOpen /></span>
                      <span className="issue-drawer-content">
                        <strong>{group.repository}</strong>
                        <span><em>{group.totalCount.toLocaleString()} open issues</em></span>
                      </span>
                      <LibraryBig className="issue-drawer-external" />
                    </button>
                  ))}
                  {issues.map((item) => (
                    <button key={item.id} className="issue-drawer-row" onClick={() => onOpenIssue(item)}>
                      <span className="issue-drawer-state"><CircleDot /></span>
                      <span className="issue-drawer-content">
                        <strong>{item.title}</strong>
                        <span>
                          <em>{item.repository} #{item.number}</em>
                          <span>{formatRelative(item.timestamp)}</span>
                        </span>
                      </span>
                      <ExternalLink className="issue-drawer-external" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export function IssueDrawer({ group, onClose, onReport }: {
  group: RepositoryIssueGroup;
  onClose: () => void;
  onReport: (error: unknown) => void;
}) {
  const [issues, setIssues] = useState(group.issues);
  const [cursor, setCursor] = useState(group.endCursor);
  const [hasNextPage, setHasNextPage] = useState(group.hasNextPage);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useDrawerChrome(onClose);

  const loadMore = useCallback(async () => {
    if (!hasNextPage || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await api.todoRepositoryIssues(group.repository, cursor);
      setIssues((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...page.issues.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.endCursor);
      setHasNextPage(page.hasNextPage);
    } catch (error) {
      onReport(error);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [cursor, group.repository, hasNextPage, onReport]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 320) void loadMore();
  };

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const body = bodyRef.current;
      if (body && hasNextPage && !loading && body.scrollHeight - body.clientHeight < 320) {
        void loadMore();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasNextPage, issues.length, loadMore, loading]);

  return (
    <div className="issue-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="issue-drawer" role="dialog" aria-modal="true" aria-label={`${group.repository} open issues`}>
        <header className="issue-drawer-header">
          <div className="issue-drawer-handle" />
          <div className="issue-drawer-heading">
            <span className="issue-drawer-folder"><FolderOpen /></span>
            <div><h2>{group.repository}</h2><p>{group.totalCount.toLocaleString()} open issues · newest activity first</p></div>
          </div>
          <Button variant="outline" size="sm" onClick={() => openUrl(`https://github.com/${group.repository}/issues`).catch(onReport)}><ExternalLink />GitHub</Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close issue drawer"><X /></Button>
        </header>
        <div ref={bodyRef} className="issue-drawer-body" onScroll={handleScroll}>
          <div className="issue-drawer-list">
            {issues.map((item) => (
              <button key={item.id} className="issue-drawer-row" onClick={() => openUrl(item.url).catch(onReport)}>
                <span className="issue-drawer-state"><CircleDot /></span>
                <span className="issue-drawer-content">
                  <strong>{item.title}</strong>
                  <span>
                    <em>#{item.number}</em>
                    <span>{formatRelative(item.timestamp)}</span>
                    {item.actor ? <span>by {item.actor}</span> : null}
                    {item.labels?.slice(0, 3).map((label) => <i key={label.name}>{label.name}</i>)}
                  </span>
                </span>
                {item.commentCount ? <span className="issue-drawer-comments"><MessageCircle />{item.commentCount}</span> : null}
                <ExternalLink className="issue-drawer-external" />
              </button>
            ))}
          </div>
          {hasNextPage ? (
            <button className="issue-drawer-load" onClick={() => void loadMore()} disabled={loading}>
              <LoaderCircle className={loading ? "animate-spin" : ""} />
              {loading ? "Loading more issues…" : "Load more issues"}
            </button>
          ) : <div className="issue-drawer-end">All {issues.length.toLocaleString()} issues loaded</div>}
        </div>
      </section>
    </div>
  );
}
