import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";

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
        if (!scan) onClose();
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
  }, [onClose, scan]);

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
      <DialogContent className="add-project-dialog sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add project</DialogTitle>
          <DialogDescription>
            {scan
              ? "Review what DevHub found. Uncheck anything you don't want."
              : "Pick a folder — DevHub reads its scripts and git remote."}
          </DialogDescription>
        </DialogHeader>

        <div className="dialog-body">
          {error ? <div className="dialog-error">{error}</div> : null}

          {!scan ? (
            <Button onClick={() => void pickFolder()} disabled={busy}>
              {busy ? "Scanning…" : "Choose another folder…"}
            </Button>
          ) : (
            <>
              <div className="add-project-source">
                <div className="add-project-source-icon"><FolderOpen /></div>
                <div>
                  <strong>{scan.name}</strong>
                  <span>{scan.path}</span>
                </div>
                <Button variant="ghost" size="xs" onClick={() => void pickFolder()} disabled={busy}>
                  Change folder
                </Button>
              </div>

              <div className="add-project-fields">
                <div className="field">
                  <label htmlFor="project-name">Project name</label>
                  <Input id="project-name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="project-group">Workspace group <span className="label-optional">Optional</span></label>
                  <Input
                    id="project-group"
                    type="text"
                    value={group}
                    onChange={(e) => setGroup(e.target.value)}
                    placeholder="e.g. DayFlow"
                  />
                </div>
                <div className="field add-project-repository">
                  <label htmlFor="project-repo">GitHub repository <span className="label-optional">Optional</span></label>
                  <Input
                    id="project-repo"
                    type="text"
                    value={repository}
                    onChange={(e) => setRepository(e.target.value)}
                    placeholder="owner/repository"
                  />
                  {scan.branch ? <span className="hint">Current branch: {scan.branch}</span> : null}
                </div>
              </div>

              <section className="add-project-commands">
                <div className="add-project-section-head">
                  <div>
                    <strong>Commands</strong>
                    <span>
                      {selected.size} of {Object.keys(scan.commands).length} selected
                      {scan.detectedFrom.length > 0 ? ` · ${scan.detectedFrom.join(", ")}` : ""}
                    </span>
                  </div>
                  {Object.keys(scan.commands).length > 0 ? (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => setSelected(selected.size === Object.keys(scan.commands).length
                        ? new Set()
                        : new Set(Object.keys(scan.commands)))}
                    >
                      {selected.size === Object.keys(scan.commands).length ? "Clear all" : "Select all"}
                    </button>
                  ) : null}
                </div>
                {Object.keys(scan.commands).length === 0 ? (
                  <div className="add-project-empty">
                    Nothing detected. You can add commands by hand in config.toml.
                  </div>
                ) : (
                  <div className="add-project-command-list">
                    {Object.entries(scan.commands).map(([commandId, spec]) => (
                      <label className="add-project-command" key={commandId}>
                        <Checkbox
                          checked={selected.has(commandId)}
                          onCheckedChange={() => toggle(commandId)}
                        />
                        <span>
                          <strong>{commandId}</strong>
                          <code>{spec.program} {spec.args.join(" ")}</code>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
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
