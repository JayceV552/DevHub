import { useState } from "react";
import { Link2 } from "lucide-react";

import { api, errorMessage } from "../../lib/api";
import type { ActivityColumn } from "../../lib/types";
import { emptyFilters } from "../../lib/types";
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

export function ColumnDialog({ column, onClose, onSaved }: {
  column: ActivityColumn | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialValue = column?.filters.users?.[0]
    ? `https://github.com/${column.filters.users[0]}`
    : column?.filters.repositories[0]
      ? `https://github.com/${column.filters.repositories[0]}`
      : "";
  const [targetInput, setTargetInput] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const target = normalizeGitHubTarget(targetInput);
    if (!target) {
      setError("Enter a GitHub profile URL or a repository as owner/repository.");
      return;
    }

    setBusy(true);
    setError(null);
    const filters = column?.filters ?? emptyFilters();
    const nextFilters = {
      ...filters,
      repositories: target.kind === "repository" ? [target.value] : [],
      users: target.kind === "user" ? [target.value] : [],
    };
    const title = target.kind === "repository" ? target.value.split("/")[1] : `${target.value} activity`;
    try {
      if (column) await api.updateColumn(column.id, title, nextFilters);
      else await api.addColumn(title, nextFilters);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="repository-dialog sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{column ? "Edit activity column" : "Add activity column"}</DialogTitle>
          <DialogDescription>
            Follow a repository, or paste a user's GitHub homepage to see their public activity.
          </DialogDescription>
        </DialogHeader>

        <div className="repository-input-wrap">
          <Link2 aria-hidden="true" />
          <Input
            autoFocus
            aria-label="GitHub repository or user profile"
            value={targetInput}
            placeholder="https://github.com/JayceV552/DevHub"
            onChange={(event) => setTargetInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <p className="repository-example">Examples: <code>dayflow-js/calendar</code> or <code>https://github.com/JayceV552</code>.</p>
        {error ? <div className="repository-dialog-error">{error}</div> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !targetInput.trim()}>
            {busy ? "Saving…" : column ? "Save" : "Add column"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type GitHubTarget = { kind: "repository" | "user"; value: string };

function normalizeGitHubTarget(input: string): GitHubTarget | null {
  let value = input.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!value) return null;

  if (/^(https?:\/\/)?(www\.)?github\.com\//i.test(value)) {
    try {
      const url = new URL(value.includes("://") ? value : `https://${value}`);
      if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) return null;
      value = url.pathname.replace(/^\/+|\/+$/g, "");
    } catch {
      return null;
    }
  }

  value = value.replace(/^@/, "");
  const parts = value.split("/");
  if (parts.length === 1 && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(parts[0])) {
    return { kind: "user", value: parts[0] };
  }
  if (
    parts.length === 2
    && parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))
  ) {
    return { kind: "repository", value: `${parts[0]}/${parts[1]}` };
  }
  return null;
}
