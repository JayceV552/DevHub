import { useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";

import { api, errorMessage } from "../../lib/api";
import type { CommandSpec, ProjectView } from "../../lib/types";
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

interface CommandDraft {
  key: string;
  name: string;
  program: string;
  args: string;
  kind: CommandSpec["kind"];
  autoKind: boolean;
  env?: Record<string, string>;
  cwd?: string | null;
}

export function EditProjectDialog({ project, onClose, onSaved }: {
  project: ProjectView;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(project.name);
  const [repository, setRepository] = useState(project.repository ?? "");
  const [group, setGroup] = useState(project.group ?? "");
  const [commands, setCommands] = useState<CommandDraft[]>(() =>
    Object.entries(project.commands).map(([commandName, spec]) => draftFrom(commandName, spec)),
  );
  const [busy, setBusy] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchCommand = (key: string, patch: Partial<CommandDraft>) => {
    setCommands((current) => current.map((command) => command.key === key ? { ...command, ...patch } : command));
  };

  const detect = async () => {
    setDetecting(true);
    setError(null);
    try {
      const found = await api.detectNewCommands(project.id);
      setCommands((current) => {
        const names = new Set(current.map((command) => command.name));
        return [
          ...current,
          ...Object.entries(found)
            .filter(([commandName]) => !names.has(commandName))
            .map(([commandName, spec]) => draftFrom(commandName, spec)),
        ];
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDetecting(false);
    }
  };

  const submit = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Project name is required.");
      return;
    }

    const nextCommands: Record<string, CommandSpec> = {};
    try {
      for (const command of commands) {
        const commandName = command.name.trim();
        const program = command.program.trim();
        if (!commandName || !program) throw new Error("Every script needs a name and program.");
        if (nextCommands[commandName]) throw new Error(`Script name “${commandName}” is duplicated.`);
        nextCommands[commandName] = {
          program,
          args: parseArguments(command.args),
          kind: command.kind,
          env: command.env,
          cwd: command.cwd,
        };
      }
    } catch (err) {
      setError(errorMessage(err));
      return;
    }

    setBusy(true);
    try {
      await api.updateProject({
        id: project.id,
        name: trimmedName,
        repository: repository.trim() || null,
        group: group.trim() || null,
        commands: nextCommands,
      });
      await onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="project-editor-dialog sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Change project details and add, remove, or edit runnable scripts.</DialogDescription>
        </DialogHeader>

        <div className="dialog-body">
          {error ? <div className="dialog-error">{error}</div> : null}

          <div className="project-editor-fields">
            <div className="field">
              <label htmlFor="edit-project-name">Name</label>
              <Input id="edit-project-name" type="text" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="edit-project-group">Workspace group</label>
              <Input id="edit-project-group" type="text" value={group} placeholder="Optional" onChange={(event) => setGroup(event.target.value)} />
            </div>
          </div>

          <div className="field">
            <label htmlFor="edit-project-repository">GitHub repository</label>
            <Input id="edit-project-repository" type="text" value={repository} placeholder="owner/repository" onChange={(event) => setRepository(event.target.value)} />
            <span className="hint">{project.path}</span>
          </div>

          <div className="project-editor-heading">
            <div>
              <strong>Run scripts</strong>
              <span>{commands.length} configured</span>
            </div>
            <Button variant="outline" size="xs" onClick={() => void detect()} disabled={detecting}>
              <RefreshCw className={detecting ? "animate-spin" : ""} />
              Detect new
            </Button>
            <Button variant="outline" size="xs" onClick={() => setCommands((current) => [...current, emptyDraft()])}>
              <Plus />Add script
            </Button>
          </div>

          <div className="command-editor-list">
            {commands.length === 0 ? (
              <div className="command-editor-empty">No scripts configured. Add one to run it from the project card.</div>
            ) : commands.map((command) => (
              <div className="command-editor-row" key={command.key}>
                <div className="field command-name-field">
                  <label>Script name</label>
                  <Input
                    type="text"
                    value={command.name}
                    placeholder="dev"
                    onChange={(event) => {
                      const nextName = event.target.value;
                      patchCommand(command.key, {
                        name: nextName,
                        ...(command.autoKind ? { kind: guessCommandKind(nextName) } : {}),
                      });
                    }}
                  />
                </div>
                <div className="field command-program-field">
                  <label>Program</label>
                  <Input type="text" value={command.program} placeholder="pnpm" onChange={(event) => patchCommand(command.key, { program: event.target.value })} />
                </div>
                <div className="field command-args-field">
                  <label>Arguments</label>
                  <Input type="text" value={command.args} placeholder="dev --host" onChange={(event) => patchCommand(command.key, { args: event.target.value })} />
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="command-remove"
                  aria-label={`Remove ${command.name || "script"}`}
                  onClick={() => setCommands((current) => current.filter((item) => item.key !== command.key))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function draftFrom(name: string, spec: CommandSpec): CommandDraft {
  return {
    key: crypto.randomUUID(),
    name,
    program: spec.program,
    args: spec.args.map(formatArgument).join(" "),
    kind: spec.kind,
    autoKind: false,
    env: spec.env,
    cwd: spec.cwd,
  };
}

function emptyDraft(): CommandDraft {
  return { key: crypto.randomUUID(), name: "", program: "", args: "", kind: "task", autoKind: true };
}

function guessCommandKind(name: string): CommandSpec["kind"] {
  return ["dev", "start", "serve", "watch", "preview", "storybook", "server"]
    .some((hint) => name.toLowerCase().includes(hint)) ? "service" : "task";
}

function formatArgument(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function parseArguments(input: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  const push = () => {
    if (current.length > 0) args.push(current);
    current = "";
  };

  for (const character of input.trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (/\s/.test(character)) {
      push();
    } else {
      current += character;
    }
  }

  if (escaped) current += "\\";
  if (quote) throw new Error("An argument has an unmatched quote.");
  push();
  return args;
}
