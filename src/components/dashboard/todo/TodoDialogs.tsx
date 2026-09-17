import { useState } from "react";
import { GitBranch, Plus, X } from "lucide-react";
import { api, errorMessage } from "../../../lib/api";
import type { TodoItem } from "../../../lib/types";
import { Button } from "../../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
import { Input } from "../../ui/input";
import { StepRows } from "./StepRows";
import type { StepDraft } from "./types";
import { normalizeRepository } from "./utils";

export function TodoDialog({ onClose, onSaved }: {
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

export function RepositoryDialog({ current, suggestions, onClose, onSaved }: {
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
