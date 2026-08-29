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
  const [repository, setRepository] = useState(column?.filters.repositories[0] ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const slug = normalizeRepository(repository);
    if (!slug) {
      setError("Enter a repository as owner/repository or paste its GitHub URL.");
      return;
    }

    setBusy(true);
    setError(null);
    const filters = column?.filters ?? emptyFilters();
    const nextFilters = { ...filters, repositories: [slug] };
    const title = slug.split("/")[1];
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
          <DialogTitle>{column ? "Edit repository column" : "Add repository column"}</DialogTitle>
          <DialogDescription>
            Paste a GitHub repository URL or enter its owner/repository name.
          </DialogDescription>
        </DialogHeader>

        <div className="repository-input-wrap">
          <Link2 aria-hidden="true" />
          <Input
            autoFocus
            aria-label="GitHub repository"
            value={repository}
            placeholder="https://github.com/voidzero-dev/vite-plus"
            onChange={(event) => setRepository(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </div>
        <p className="repository-example">Examples: <code>dayflow-js/calendar</code> or a complete GitHub URL.</p>
        {error ? <div className="repository-dialog-error">{error}</div> : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={submit} disabled={busy || !repository.trim()}>
            {busy ? "Saving…" : column ? "Save" : "Add column"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function normalizeRepository(input: string): string | null {
  let value = input.trim().replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!value) return null;

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
