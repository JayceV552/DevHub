import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Book,
  Check,
  CircleDot,
  ExternalLink,
  FolderOpen,
  GitBranch,
  LayoutGrid,
  LibraryBig,
  ListTodo,
  LoaderCircle,
  MessageCircle,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";

import { api, errorMessage } from "../../lib/api";
import type {
  ActivityItem,
  RepositoryIssueGroup,
  TodoBoard as TodoBoardData,
  TodoItem,
  TodoStep,
  TodoStepInput,
} from "../../lib/types";
import { PageHeader } from "../common/PageHeader";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

const NOTE_COLORS = ["cream", "blue", "green", "rose", "yellow"] as const;
/** The board never grows past three rows; the rest lives in the drawer. */
const MAX_BOARD_ROWS = 3;
/** Checklist rows a note shows before it collapses the tail into "+n more". */
const NOTE_STEP_PREVIEW = 3;

type NoteColor = typeof NOTE_COLORS[number];
type BoardCard =
  | { kind: "todo"; item: TodoItem }
  | { kind: "issue"; item: ActivityItem }
  | { kind: "folder"; group: RepositoryIssueGroup };

/** A checklist row being edited: `id` is absent until Rust has minted one. */
type StepDraft = { key: string; id?: string; text: string; done: boolean };

export function TodoBoard({ projectRepositories, onNavigate, onReport }: {
  projectRepositories: string[];
  onNavigate: (page: string) => void;
  onReport: (error: unknown) => void;
}) {
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
        title="Todo board"
        subtitle={(
          <>
            {board?.repositories.length
              ? `${board.repositories.length} watched repositor${board.repositories.length === 1 ? "y" : "ies"} · ${board.todos.filter((todo) => !todo.completed).length} open todos`
              : "Pin your own tasks beside the latest GitHub issues."}
          </>
        )}
        actions={<div className="todo-board-actions">
          <Button variant="outline" size="sm" onClick={() => setShowRepositoryDialog(true)}><Settings2 />Repositories</Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""} />Refresh</Button>
          <Button size="sm" onClick={() => setShowTodoDialog(true)}><Plus />New todo</Button>
        </div>}
      />

      <div className={`todo-pinboard ${stageOverlay ? "is-folder-preview" : ""}`}>
        <div className="todo-pinboard-label"><ListTodo /> Focus board</div>
        {board?.issueError ? (
          <div className="todo-board-notice">
            <GitBranch />
            <span>{board.issueError === "GitHub authentication required."
              ? "Sign in again to load repository issues."
              : "Repository issues could not be loaded."}</span>
            <button className="link-button" onClick={() => onNavigate("activity")}>
              {board.issueError === "GitHub authentication required." ? "Sign in" : "Open GitHub"}
            </button>
          </div>
        ) : null}

        <div className="todo-board-base" aria-hidden={stageOverlay}>
          {!board || loading && cards.length === 0 ? (
            <div className="todo-board-loading" role="status">
              <LoaderCircle className="todo-board-spinner ui-spinner" aria-hidden="true" />
              <span>Loading board…</span>
            </div>
          ) : cards.length === 0 ? (
            <button className="todo-board-empty" onClick={() => setShowTodoDialog(true)}>
              <Plus />
              <strong>Pin your first todo</strong>
              <span>or configure a repository to bring in its latest issues</span>
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

/** Reads the column count the grid actually resolved to, and follows resizes. */
function useGridColumns(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [columns, setColumns] = useState(0);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !enabled) {
      setColumns(0);
      return;
    }
    const measure = () => {
      const template = window.getComputedStyle(node).gridTemplateColumns;
      setColumns(template === "none" ? 1 : template.split(" ").filter(Boolean).length);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, ref]);

  return columns;
}

function TodoNote({ item, color, registerRef, onOpen, onRemove }: {
  item: TodoItem;
  color: NoteColor;
  registerRef: (node: HTMLElement | null) => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const done = item.steps.filter((step) => step.done).length;
  return (
    <article ref={registerRef} className={`todo-note todo-task-note is-${color} ${item.completed ? "is-completed" : ""}`}>
      <span className="todo-note-tape" />
      <button className="todo-note-surface" onClick={onOpen} aria-label={`Open ${item.title}`} />
      <header>
        <div>
          <strong className="todo-note-title">{item.title}</strong>
          <span>
            {formatRelative(item.createdAt)}
            {item.steps.length ? ` · ${done}/${item.steps.length}` : ""}
          </span>
        </div>
        <div className="todo-note-actions">
          <button className="todo-note-remove" onClick={onRemove} aria-label={`Delete ${item.title}`}><Trash2 /></button>
        </div>
      </header>
      {item.steps.length ? (
        <ul className="todo-note-steps">
          {item.steps.slice(0, NOTE_STEP_PREVIEW).map((step) => (
            <li key={step.id} className={step.done ? "is-done" : ""}>
              <span>{step.done ? <Check /> : null}</span>
              <p>{step.text}</p>
            </li>
          ))}
          {item.steps.length > NOTE_STEP_PREVIEW ? (
            <li className="todo-note-step-more">+{item.steps.length - NOTE_STEP_PREVIEW} more</li>
          ) : null}
        </ul>
      ) : null}
    </article>
  );
}

function TodoStage({ item, color, getOrigin, onClose, onSave, onToggle, onToggleStep, onDelete }: {
  item: TodoItem;
  color: NoteColor;
  getOrigin: () => DOMRect | null;
  onClose: () => void;
  onSave: (title: string, steps: TodoStepInput[]) => Promise<void>;
  onToggle: () => void;
  onToggleStep: (stepId: string, done: boolean) => void;
  onDelete: () => void;
}) {
  const stageRef = useRef<HTMLElement>(null);
  const animationRef = useRef<Animation | null>(null);
  const closingRef = useRef(false);
  const [title, setTitle] = useState(item.title);
  const [steps, setSteps] = useState<StepDraft[]>(() => toDrafts(item.steps));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Grows the card out of the note that was clicked, and shrinks it back in.
  const flip = useCallback((reverse: boolean) => {
    const node = stageRef.current;
    if (!node) return null;
    const origin = getOrigin();
    const stage = node.getBoundingClientRect();
    const frames: Keyframe[] = origin
      ? [
          { opacity: 0.2, clipPath: `inset(${insetFrom(origin, stage)} round 24px)` },
          { opacity: 1, clipPath: "inset(0px round 16px)" },
        ]
      : [{ opacity: 0 }, { opacity: 1 }];
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return node.animate(frames, {
      duration: reduced ? 1 : reverse ? 280 : 420,
      easing: reverse ? "cubic-bezier(0.4, 0, 0.7, 1)" : "cubic-bezier(0.22, 0.82, 0.22, 1)",
      direction: reverse ? "reverse" : "normal",
      fill: "both",
    });
  }, [getOrigin]);

  useLayoutEffect(() => {
    const animation = flip(false);
    animationRef.current = animation;
    return () => { animation?.cancel(); };
    // Only ever runs for the note this stage was opened from.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    animationRef.current?.cancel();
    const animation = flip(true);
    animationRef.current = animation;
    if (!animation) {
      onClose();
      return;
    }
    animation.onfinish = () => onClose();
  }, [flip, onClose]);

  // Closing commits the draft, so nothing typed here is ever lost silently.
  const commit = useCallback(async () => {
    if (busy || closingRef.current) return;
    const nextTitle = title.trim() || item.title;
    const payload = steps
      .map((step) => ({ id: step.id, text: step.text.trim(), done: step.done }))
      .filter((step) => step.text.length > 0);
    if (!isDirty(item, nextTitle, payload)) {
      close();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(nextTitle, payload);
      close();
    } catch (err) {
      // A failed save keeps the stage open with the draft intact.
      setError(errorMessage(err));
      setBusy(false);
    }
  }, [busy, close, item, onSave, steps, title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") void commit(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commit]);

  const doneCount = steps.filter((step) => step.done).length;

  const toggleStep = (index: number) => {
    const step = steps[index];
    const done = !step.done;
    setSteps(steps.map((entry, position) => position === index ? { ...entry, done } : entry));
    // Saved rows tick straight through to disk; unsaved ones ride along on save.
    if (step.id) onToggleStep(step.id, done);
  };

  return (
    <section
      ref={stageRef}
      className={`todo-task-stage is-${color}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${item.title}`}
    >
      <header className="todo-task-stage-header">
        <button
          className="todo-note-check"
          onClick={onToggle}
          aria-label={item.completed ? "Mark todo incomplete" : "Complete todo"}
        >
          {item.completed ? <Check /> : null}
        </button>
        <div className="todo-task-stage-heading">
          <input
            className="todo-task-stage-title"
            value={title}
            placeholder="Untitled todo"
            aria-label="Todo title"
            onChange={(event) => setTitle(event.target.value)}
          />
          <small>
            pinned {formatRelative(item.createdAt)}
            {steps.length ? ` · ${doneCount} of ${steps.length} done` : ""}
          </small>
        </div>
        <div className="todo-task-stage-actions">
          <button onClick={onDelete} aria-label={`Delete ${item.title}`}><Trash2 /></button>
          <button onClick={() => void commit()} aria-label="Close todo"><X /></button>
        </div>
      </header>

      <div className="todo-task-stage-body">
        <StepRows steps={steps} setSteps={setSteps} onToggle={toggleStep} />
      </div>

      <footer className="todo-task-stage-footer">
        {error ? <span className="todo-task-stage-error">{error}</span> : <span>{steps.length ? `${doneCount} of ${steps.length} done` : "No checklist yet"}</span>}
        <Button size="sm" onClick={() => void commit()} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
      </footer>
    </section>
  );
}

function StepRows({ steps, setSteps, onToggle }: {
  steps: StepDraft[];
  setSteps: (next: StepDraft[]) => void;
  onToggle: (index: number) => void;
}) {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setSteps([...steps, { key: newKey(), text, done: false }]);
    setDraft("");
  };

  return (
    <div className="todo-step-list">
      {steps.map((step, index) => (
        <div key={step.key} className={`todo-step-row ${step.done ? "is-done" : ""}`}>
          <button
            className="todo-step-check"
            onClick={() => onToggle(index)}
            aria-label={step.done ? `Reopen ${step.text}` : `Complete ${step.text}`}
          >
            {step.done ? <Check /> : null}
          </button>
          <input
            value={step.text}
            aria-label="Checklist item"
            onChange={(event) => setSteps(steps.map((entry, position) => position === index
              ? { ...entry, text: event.target.value }
              : entry))}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              setSteps([
                ...steps.slice(0, index + 1),
                { key: newKey(), text: "", done: false },
                ...steps.slice(index + 1),
              ]);
            }}
          />
          <button
            className="todo-step-remove"
            onClick={() => setSteps(steps.filter((_, position) => position !== index))}
            aria-label={`Remove ${step.text}`}
          >
            <X />
          </button>
        </div>
      ))}
      <div className="todo-step-row is-draft">
        <span className="todo-step-check"><Plus /></span>
        <input
          value={draft}
          placeholder="Add a checklist item"
          aria-label="New checklist item"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitDraft(); } }}
          onBlur={commitDraft}
        />
      </div>
    </div>
  );
}

function BoardOverflowNote({ hidden, total, onOpen }: {
  hidden: number;
  total: number;
  onOpen: () => void;
}) {
  return (
    <button className="todo-note todo-overflow-note" onClick={onOpen}>
      <span className="todo-note-tape" />
      <span className="todo-overflow-count">+{hidden}</span>
      <strong>View all</strong>
      <small>{total} items on this board</small>
      <span className="todo-overflow-icon"><LayoutGrid /></span>
    </button>
  );
}

function IssueNote({ item, color, onOpen }: {
  item: ActivityItem;
  color: NoteColor;
  onOpen: () => void;
}) {
  return (
    <article className={`todo-note todo-issue-note is-${color}`}>
      <span className="todo-note-tape" />
      <header>
        <span className="todo-issue-icon"><CircleDot /></span>
        <div>
          <strong>{item.repository}</strong>
          <span>#{item.number} · {formatRelative(item.timestamp)}</span>
        </div>
        <button className="todo-note-open" onClick={onOpen} aria-label={`Open ${item.title} on GitHub`}><ExternalLink /></button>
      </header>
      <button className="todo-issue-title" onClick={onOpen}>{item.title}</button>
      <footer>
        {item.actorAvatar ? <img src={item.actorAvatar} alt="" /> : null}
        <span>{item.actor ?? "GitHub"}</span>
        {item.labels?.slice(0, 2).map((label) => <em key={label.name}>{label.name}</em>)}
      </footer>
    </article>
  );
}

function IssueFolder({ group, expanded, onToggle }: {
  group: RepositoryIssueGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`todo-issue-folder ${expanded ? "is-expanded" : ""}`}>
      <button
        className="todo-folder-main"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={`Preview ${group.totalCount} issues from ${group.repository}`}
      >
        <span className="todo-folder-art" aria-hidden="true">
          <svg viewBox="0 0 300 250" preserveAspectRatio="none" focusable="false">
            <path
              className="todo-folder-back"
              d="M22 0h78c12 0 20 3 29 9l17 12c7 5 14 7 25 7h107c12 0 22 10 22 22v100H0V22C0 10 10 0 22 0Z"
            />
            <rect className="todo-folder-front" x="0" y="40" width="300" height="210" rx="26" />
          </svg>
        </span>
        <span className="todo-folder-glyph" aria-hidden="true">
          <svg viewBox="0 0 96 96" focusable="false">
            <circle className="todo-folder-glyph-disc" cx="48" cy="48" r="34" />
            <path className="todo-folder-glyph-arrow" d="M48 62V34m0 0-12 12m12-12 12 12" />
          </svg>
        </span>
        <span className="todo-folder-copy">
          <small>{group.totalCount.toLocaleString()} Items</small>
          <strong>{group.repository}</strong>
        </span>
        <span className="todo-folder-library" aria-hidden="true"><Book /></span>
      </button>
    </article>
  );
}

function IssueFolderPreview({ group, closing, onClose, onOpenDrawer, onOpenIssue }: {
  group: RepositoryIssueGroup;
  closing: boolean;
  onClose: () => void;
  onOpenDrawer: () => void;
  onOpenIssue: (item: ActivityItem) => void;
}) {
  return (
    <section className={`todo-folder-stage ${closing ? "is-closing" : ""}`} aria-label={`Latest issues from ${group.repository}`}>
      <header className="todo-folder-stage-header">
        <div className="todo-folder-stage-heading">
          <span><FolderOpen /></span>
          <div>
            <strong>{group.repository}</strong>
            <small>{group.totalCount.toLocaleString()} open items · newest first</small>
          </div>
        </div>
        <div className="todo-folder-stage-actions">
          <button onClick={onOpenDrawer}><LibraryBig />View all</button>
          <button onClick={onClose} aria-label={`Close ${group.repository} preview`}><X /></button>
        </div>
      </header>
      <div className="todo-folder-preview-grid">
        {group.issues.slice(0, 6).map((item, index) => (
          <button
            key={item.id}
            className={`todo-folder-preview-note is-${NOTE_COLORS[(index + 1) % NOTE_COLORS.length]}`}
            style={{ "--preview-index": index } as React.CSSProperties}
            onClick={() => onOpenIssue(item)}
          >
            <span className="todo-note-tape" />
            <span className="todo-folder-preview-meta">
              <span className="todo-issue-icon"><CircleDot /></span>
              <span><strong>{group.repository}</strong><small>#{item.number} · {formatRelative(item.timestamp)}</small></span>
              <ExternalLink />
            </span>
            <strong>{item.title}</strong>
            <span className="todo-folder-preview-detail">
              <span>{item.actor ? `by ${item.actor}` : "GitHub"}</span>
              {item.commentCount ? <small><MessageCircle />{item.commentCount}</small> : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function BoardDrawer({ cards, onClose, onOpenTodo, onRemoveTodo, onOpenIssue, onOpenFolder }: {
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

function IssueDrawer({ group, onClose, onReport }: {
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

/** Locks the page behind a bottom drawer and wires Escape to close it. */
function useDrawerChrome(onClose: () => void) {
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

function TodoDialog({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: (item: TodoItem) => void;
}) {
  const [title, setTitle] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.addTodo(
        title,
        steps.map((step) => ({ text: step.text.trim(), done: step.done })).filter((step) => step.text),
      ));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="todo-dialog sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Pin a new todo</DialogTitle>
          <DialogDescription>Add a personal task to your Overview board.</DialogDescription>
        </DialogHeader>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="todo-title">Title</label>
            <Input id="todo-title" autoFocus value={title} placeholder="What needs to be done?" onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="field">
            <label>Checklist <span className="label-optional">Optional</span></label>
            <StepRows
              steps={steps}
              setSteps={setSteps}
              onToggle={(index) => setSteps(steps.map((step, position) => position === index
                ? { ...step, done: !step.done }
                : step))}
            />
          </div>
          {error ? <div className="dialog-error">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !title.trim()}>
            {busy ? "Saving…" : "Add todo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RepositoryDialog({ current, suggestions, onClose, onSaved }: {
  current: string[];
  suggestions: string[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [repositories, setRepositories] = useState(current);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const available = suggestions.filter((slug) => !repositories.includes(slug));

  const add = (value = input) => {
    const slug = normalizeRepository(value);
    if (!slug) {
      setError("Enter a repository as owner/repository or paste its GitHub URL.");
      return;
    }
    setRepositories((items) => items.includes(slug) ? items : [...items, slug]);
    setInput("");
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.setTodoRepositories(repositories);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="todo-repository-dialog sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Watched repositories</DialogTitle>
          <DialogDescription>Latest open issues from these repositories will appear on your Todo board.</DialogDescription>
        </DialogHeader>
        <div className="dialog-body">
          <div className="todo-repository-input">
            <Input
              autoFocus
              value={input}
              placeholder="owner/repository or GitHub URL"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}
            />
            <Button variant="outline" onClick={() => add()} disabled={!input.trim()}>Add</Button>
          </div>
          {repositories.length ? (
            <div className="todo-repository-list">
              {repositories.map((slug) => (
                <div key={slug}><GitBranch /><span>{slug}</span><button onClick={() => setRepositories((items) => items.filter((item) => item !== slug))} aria-label={`Stop watching ${slug}`}><X /></button></div>
              ))}
            </div>
          ) : <div className="todo-repository-empty">No repositories watched yet.</div>}
          {available.length ? (
            <div className="todo-repository-suggestions">
              <span>From your projects</span>
              <div>{available.slice(0, 6).map((slug) => <button key={slug} onClick={() => add(slug)}><Plus />{slug}</button>)}</div>
            </div>
          ) : null}
          {error ? <div className="dialog-error">{error}</div> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? "Saving…" : "Save repositories"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Drawer notes are never the origin of the open animation, so they skip the registry. */
function noop() {}

function toDrafts(steps: TodoStep[]): StepDraft[] {
  return steps.map((step) => ({ key: step.id, id: step.id, text: step.text, done: step.done }));
}

function newKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `step-${Math.random().toString(36).slice(2)}`;
}

function isDirty(item: TodoItem, title: string, steps: TodoStepInput[]): boolean {
  if (title !== item.title) return true;
  if (steps.length !== item.steps.length) return true;
  return steps.some((step, index) => {
    const original = item.steps[index];
    return step.id !== original.id || step.text !== original.text || step.done !== original.done;
  });
}

/** Clip-path edges that make `stage` show exactly the area `origin` covers. */
function insetFrom(origin: DOMRect, stage: DOMRect): string {
  return [
    origin.top - stage.top,
    stage.right - origin.right,
    stage.bottom - origin.bottom,
    origin.left - stage.left,
  ].map((edge) => `${Math.round(Math.max(edge, 0))}px`).join(" ");
}

function normalizeRepository(input: string): string | null {
  let value = input.trim().replace(/\/+$/, "").replace(/\.git$/i, "");
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    if (["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
      value = url.pathname.replace(/^\/+|\/+$/g, "").split("/").slice(0, 2).join("/");
    }
  } catch {
    // owner/repository is handled below.
  }
  const match = value.match(/^([^\s/]+)\/([^\s/]+)$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

function formatRelative(value: string): string {
  const elapsed = Date.now() - Date.parse(value);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
