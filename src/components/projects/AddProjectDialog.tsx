import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import { api, errorMessage } from "../../lib/api";
import type { CommandSpec, ProjectScan } from "../../lib/types";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

export function AddProjectDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [scan, setScan] = useState<ProjectScan | null>(null);
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [repository, setRepository] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pickerStarted = useRef(false);

  const pickFolder = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await open({ directory: true, multiple: false, title: "Select project folder" });
      if (typeof picked !== "string") {
        onClose();
        return;
      }

      const result = await api.scanProject(picked);
      setScan(result);
      setName(result.name);
      setRepository(result.repository ?? "");
      setSelected(new Set(Object.keys(result.commands)));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [onClose]);

  useEffect(() => {
    if (pickerStarted.current) return;
    pickerStarted.current = true;
    void pickFolder();
  }, [pickFolder]);

  const toggle = (commandId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      next.has(commandId) ? next.delete(commandId) : next.add(commandId);
      return next;
    });
  };

  const submit = async () => {
    if (!scan) return;
    setBusy(true);
    setError(null);
    try {
      const commands: Record<string, CommandSpec> = {};
      for (const [commandId, spec] of Object.entries(scan.commands)) {
        if (selected.has(commandId)) commands[commandId] = spec;
      }
      await api.addProject({
        name: name.trim() || scan.name,
        path: scan.path,
        repository: repository.trim() || null,
        group: group.trim() || null,
        commands,
      });
      onAdded();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!scan && busy && !error) return null;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>
            {scan
              ? "Review what DevHub found. Uncheck anything you don't want."
              : "Pick a folder — DevHub reads its scripts and git remote."}
          </DialogDescription>
        </DialogHeader>

        <div className="dialog-body">
          {error ? <div style={{ color: "var(--danger)" }}>{error}</div> : null}

          {!scan ? (
            <Button onClick={() => void pickFolder()} disabled={busy}>
              {busy ? "Scanning…" : "Choose another folder…"}
            </Button>
          ) : (
            <>
              <div className="field">
                <label htmlFor="project-name">Name</label>
                <Input id="project-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
                <span className="hint">{scan.path}</span>
              </div>

              <div className="field">
                <label htmlFor="project-repo">GitHub repository</label>
                <Input
                  id="project-repo"
                  type="text"
                  value={repository}
                  onChange={(e) => setRepository(e.target.value)}
                  placeholder="owner/repo"
                />
                {scan.branch ? <span className="hint">on branch {scan.branch}</span> : null}
              </div>

              <div className="field">
                <label htmlFor="project-group">Workspace group</label>
                <Input
                  id="project-group"
                  type="text"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  placeholder="Optional — e.g. DayFlow"
                />
                <span className="hint">Projects in a group can be started together.</span>
              </div>

              <div className="field">
                <label>
                  Detected commands
                  {scan.detectedFrom.length > 0 ? ` — from ${scan.detectedFrom.join(", ")}` : ""}
                </label>
                {Object.keys(scan.commands).length === 0 ? (
                  <span className="hint">
                    Nothing detected. You can add commands by hand in config.toml.
                  </span>
                ) : (
                  <div className="check-list">
                    {Object.entries(scan.commands).map(([commandId, spec]) => (
                      <label className="check-row" key={commandId}>
                        <Checkbox
                          checked={selected.has(commandId)}
                          onCheckedChange={() => toggle(commandId)}
                        />
                        <span className="name">{commandId}</span>
                        <span className={`tag ${spec.kind}`}>{spec.kind}</span>
                        <span className="cmd">
                          {spec.program} {spec.args.join(" ")}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!scan || busy}>
            {busy ? "Adding…" : "Add project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
