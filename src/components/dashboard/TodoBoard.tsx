import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Coffee,
  GitBranch,
  ListTodo,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
} from "lucide-react";

import { useDevHub } from "../../hooks/useDevHub";
import { api } from "../../lib/api";
import { cn } from "../../lib/utils";

import type {
  RepositoryIssueGroup,
  TodoBoard as TodoBoardData,
  TodoItem,
  TodoStepInput,
} from "../../lib/types";
import { PageHeader } from "../common/PageHeader";
import { Button } from "../ui/button";
import { BoardDrawer, IssueDrawer } from "./todo/BoardDrawer";
import { BoardOverflowNote, IssueFolder, IssueFolderPreview, IssueNote } from "./todo/IssueCard";
import { TodoNote, TodoStage } from "./todo/TodoCard";
import { RepositoryDialog, TodoDialog } from "./todo/TodoDialogs";
import type { BoardCard } from "./todo/types";
import { MAX_BOARD_ROWS, NOTE_COLORS } from "./todo/types";
import { useGridColumns } from "./todo/utils";
import { useI18n } from "../../lib/i18n";

export function TodoBoard({ projectRepositories, onNavigate, onReport }: {
  projectRepositories: string[];
  onNavigate: (page: string) => void;
  onReport: (error: unknown) => void;
}) {
  const { caffeinated, toggleCaffeinate } = useDevHub();
  const { t } = useI18n();
  const [board, setBoard] = useState<TodoBoardData | null>(null);

  const [loading, setLoading] = useState(false);
  const [showTodoDialog, setShowTodoDialog] = useState(false);
  const [openTodoId, setOpenTodoId] = useState<string | null>(null);
  const [showRepositoryDialog, setShowRepositoryDialog] = useState(false);
  const [previewRepository, setPreviewRepository] = useState<string | null>(null);
  const [previewClosing, setPreviewClosing] = useState(false);
  const [drawerGroup, setDrawerGroup] = useState<RepositoryIssueGroup | null>(null);
  const [showBoardDrawer, setShowBoardDrawer] = useState(false);
  const previewCloseTimer = useRef<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const noteNodes = useRef(new Map<string, HTMLElement>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await api.todoBoard());
    } catch (error) {
      onReport(error);
    } finally {
      setLoading(false);
    }
  }, [onReport]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => {
    if (previewCloseTimer.current !== null) window.clearTimeout(previewCloseTimer.current);
  }, []);

  const cards = useMemo(() => {
    if (!board) return [];
    const todos = [...board.todos].sort((a, b) => Number(a.completed) - Number(b.completed));
    const issueCards = board.issueGroups.flatMap<BoardCard>((group) => group.totalCount > 6
      ? [{ kind: "folder" as const, group }]
      : group.issues.map((item) => ({ kind: "issue" as const, item })));
    return [
      ...todos.map((item) => ({ kind: "todo" as const, item })),
      ...issueCards,
    ] satisfies BoardCard[];
  }, [board]);

  // The grid is `auto-fill`, so only the browser knows how many columns fit.
  const columns = useGridColumns(gridRef, cards.length > 0);
  const capacity = columns > 0 ? columns * MAX_BOARD_ROWS : 0;
  const overflowing = capacity > 0 && cards.length > capacity;
  // The overflow card takes the last slot, so one more card has to step aside.
  const visibleCards = overflowing ? cards.slice(0, capacity - 1) : cards;
  const hiddenCount = cards.length - visibleCards.length;

  const previewGroup = previewRepository
    ? board?.issueGroups.find((item) => item.repository === previewRepository) ?? null
    : null;
  const openTodo = openTodoId
    ? board?.todos.find((item) => item.id === openTodoId) ?? null
    : null;
  const openTodoColor = useMemo(() => {
    const index = cards.findIndex((card) => card.kind === "todo" && card.item.id === openTodoId);
    return NOTE_COLORS[(index < 0 ? 0 : index) % NOTE_COLORS.length];
  }, [cards, openTodoId]);

  const openFolderPreview = (repository: string) => {
    if (previewCloseTimer.current !== null) window.clearTimeout(previewCloseTimer.current);
    setPreviewClosing(false);
    setPreviewRepository(repository);
  };

  const closeFolderPreview = () => {
    if (!previewRepository || previewClosing) return;
    setPreviewClosing(true);
    previewCloseTimer.current = window.setTimeout(() => {
      setPreviewRepository(null);
      setPreviewClosing(false);
      previewCloseTimer.current = null;
    }, 360);
  };

  const replaceTodo = (updated: TodoItem) => setBoard((current) => current ? {
    ...current,
    todos: current.todos.map((todo) => todo.id === updated.id ? updated : todo),
  } : current);

  const toggleTodo = async (item: TodoItem) => {
    try {
      replaceTodo(await api.setTodoCompleted(item.id, !item.completed));
    } catch (error) {
      onReport(error);
    }
  };

  const toggleStep = async (item: TodoItem, stepId: string, done: boolean) => {
    try {
      replaceTodo(await api.setTodoStep(item.id, stepId, done));
    } catch (error) {
      onReport(error);
    }
  };

  const saveTodo = async (item: TodoItem, title: string, steps: TodoStepInput[]) => {
    replaceTodo(await api.updateTodo(item.id, title, steps));
  };

  const removeTodo = async (item: TodoItem) => {
    try {
      await api.deleteTodo(item.id);
      setOpenTodoId((current) => current === item.id ? null : current);
      setBoard((current) => current ? {
        ...current,
        todos: current.todos.filter((todo) => todo.id !== item.id),
      } : current);
    } catch (error) {
      onReport(error);
    }
  };

  const registerNote = (id: string) => (node: HTMLElement | null) => {
    if (node) noteNodes.current.set(id, node);
    else noteNodes.current.delete(id);
  };

  const stageOverlay = Boolean(previewGroup) || Boolean(openTodo);

  return (
    <section className="todo-board-section section">
      <PageHeader
        className="todo-board-heading"
        title={t("Todo board")}
        subtitle={(
          <>
            {board?.repositories.length
              ? t("{repos} watched repositories · {todos} open todos", {
                repos: board.repositories.length,
                todos: board.todos.filter((todo) => !todo.completed).length,
              })
              : t("Pin your own tasks beside the latest GitHub issues.")}
          </>
        )}
        actions={<div className="todo-board-actions">
          <Button variant="outline" size="sm" onClick={() => setShowRepositoryDialog(true)}><Settings2 />{t("Repositories")}</Button>
          <Button
            variant={caffeinated ? "default" : "outline"}
            size="icon"
            className={cn(
              "size-8 rounded-[min(var(--radius-md),12px)] transition-colors",
              caffeinated && "bg-amber-600 hover:bg-amber-700 text-white border-amber-600 shadow-xs dark:bg-amber-600 dark:hover:bg-amber-500",
            )}
            onClick={() => void toggleCaffeinate()}
            title={caffeinated ? t("caffeinate -i is running (macOS sleep prevented) · Click to stop") : t("Run caffeinate -i (prevent macOS sleep)")}
            aria-label={caffeinated ? t("Stop caffeinate -i") : t("Run caffeinate -i")}
            aria-pressed={caffeinated}
          >
            <Coffee className={cn("size-4", caffeinated && "stroke-[2.5]")} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />{t("Refresh")}</Button>
          <Button size="sm" onClick={() => setShowTodoDialog(true)}><Plus />{t("New todo")}</Button>
        </div>}

      />

      <div className={`todo-pinboard ${stageOverlay ? "is-folder-preview" : ""}`}>
        <div className="todo-pinboard-label"><ListTodo /> {t("Focus board")}</div>
        {board?.issueError ? (
          <div className="todo-board-notice">
            <GitBranch />
            <span>{board.issueError === "GitHub authentication required."
              ? t("Sign in again to load repository issues.")
              : t("Repository issues could not be loaded.")}</span>
            <button className="link-button" onClick={() => onNavigate("activity")}>
              {board.issueError === "GitHub authentication required." ? t("Sign in") : t("Open GitHub")}
            </button>
          </div>
        ) : null}

        <div className="todo-board-base" aria-hidden={stageOverlay}>
          {!board || loading && cards.length === 0 ? (
            <div className="todo-board-loading" role="status">
              <LoaderCircle className="todo-board-spinner ui-spinner" aria-hidden="true" />
              <span>{t("Loading board…")}</span>
            </div>
          ) : cards.length === 0 ? (
            <button className="todo-board-empty" onClick={() => setShowTodoDialog(true)}>
              <Plus />
              <strong>{t("Pin your first todo")}</strong>
              <span>{t("or configure a repository to bring in its latest issues")}</span>
            </button>
          ) : (
            <div className="todo-note-grid" ref={gridRef}>
              {visibleCards.map((card, index) => card.kind === "todo" ? (
                <TodoNote
                  key={`todo-${card.item.id}`}
                  item={card.item}
                  color={NOTE_COLORS[index % NOTE_COLORS.length]}
                  registerRef={registerNote(card.item.id)}
                  onOpen={() => setOpenTodoId(card.item.id)}
                  onRemove={() => void removeTodo(card.item)}
                />
              ) : card.kind === "issue" ? (
                <IssueNote
                  key={card.item.id}
                  item={card.item}
                  color={NOTE_COLORS[index % NOTE_COLORS.length]}
                  onOpen={() => openUrl(card.item.url).catch(onReport)}
                />
              ) : (
                <IssueFolder
                  key={`folder-${card.group.repository}`}
                  group={card.group}
                  expanded={previewRepository === card.group.repository}
                  onToggle={() => openFolderPreview(card.group.repository)}
                />
              ))}
              {overflowing ? (
                <BoardOverflowNote
                  hidden={hiddenCount}
                  total={cards.length}
                  onOpen={() => setShowBoardDrawer(true)}
                />
              ) : null}
            </div>
          )}
        </div>

        {previewGroup ? (
          <IssueFolderPreview
            group={previewGroup}
            closing={previewClosing}
            onClose={closeFolderPreview}
            onOpenDrawer={() => setDrawerGroup(previewGroup)}
            onOpenIssue={(item) => openUrl(item.url).catch(onReport)}
          />
        ) : null}

        {openTodo ? (
          <TodoStage
            key={openTodo.id}
            item={openTodo}
            color={openTodoColor}
            getOrigin={() => noteNodes.current.get(openTodo.id)?.getBoundingClientRect() ?? null}
            onClose={() => setOpenTodoId(null)}
            onSave={(title, steps) => saveTodo(openTodo, title, steps)}
            onToggle={() => void toggleTodo(openTodo)}
            onToggleStep={(stepId, done) => void toggleStep(openTodo, stepId, done)}
            onDelete={() => void removeTodo(openTodo)}
          />
        ) : null}
      </div>

      {showTodoDialog ? (
        <TodoDialog
          onClose={() => setShowTodoDialog(false)}
          onSaved={(item) => {
            setBoard((current) => current ? { ...current, todos: [item, ...current.todos] } : current);
            setShowTodoDialog(false);
          }}
        />
      ) : null}

      {showRepositoryDialog ? (
        <RepositoryDialog
          current={board?.repositories ?? []}
          suggestions={projectRepositories}
          onClose={() => setShowRepositoryDialog(false)}
          onSaved={async () => { setShowRepositoryDialog(false); await load(); }}
        />
      ) : null}

      {showBoardDrawer && board ? (
        <BoardDrawer
          cards={cards}
          onClose={() => setShowBoardDrawer(false)}
          onOpenTodo={(item) => { setShowBoardDrawer(false); setOpenTodoId(item.id); }}
          onRemoveTodo={(item) => void removeTodo(item)}
          onOpenIssue={(item) => openUrl(item.url).catch(onReport)}
          onOpenFolder={(group) => { setShowBoardDrawer(false); setDrawerGroup(group); }}
        />
      ) : null}

      {drawerGroup ? (
        <IssueDrawer group={drawerGroup} onClose={() => setDrawerGroup(null)} onReport={onReport} />
      ) : null}
    </section>
  );
}
