import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { errorMessage } from "../../../lib/api";
import type { TodoItem, TodoStepInput } from "../../../lib/types";
import { Button } from "../../ui/button";
import { StepRows } from "./StepRows";
import type { NoteColor, StepDraft } from "./types";
import { NOTE_STEP_PREVIEW } from "./types";
import { formatRelative, insetFrom, isDirty, toDrafts } from "./utils";

export function TodoNote({ item, color, registerRef, onOpen, onRemove }: {
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

export function TodoStage({ item, color, getOrigin, onClose, onSave, onToggle, onToggleStep, onDelete }: {
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
