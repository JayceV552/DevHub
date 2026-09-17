import { useLayoutEffect, useState } from "react";
import type { TodoItem, TodoStep, TodoStepInput } from "../../../lib/types";
import type { StepDraft } from "./types";

/** Reads the column count the grid actually resolved to, and follows resizes. */
export function useGridColumns(ref: React.RefObject<HTMLDivElement | null>, enabled: boolean) {
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

/** Drawer notes are never the origin of the open animation, so they skip the registry. */
export function noop() {}

export function toDrafts(steps: TodoStep[]): StepDraft[] {
  return steps.map((step) => ({ key: step.id, id: step.id, text: step.text, done: step.done }));
}

export function newKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `step-${Math.random().toString(36).slice(2)}`;
}

export function isDirty(item: TodoItem, title: string, steps: TodoStepInput[]): boolean {
  if (title !== item.title) return true;
  if (steps.length !== item.steps.length) return true;
  return steps.some((step, index) => {
    const original = item.steps[index];
    return step.id !== original.id || step.text !== original.text || step.done !== original.done;
  });
}

/** Clip-path edges that make `stage` show exactly the area `origin` covers. */
export function insetFrom(origin: DOMRect, stage: DOMRect): string {
  return [
    origin.top - stage.top,
    stage.right - origin.right,
    stage.bottom - origin.bottom,
    origin.left - stage.left,
  ].map((edge) => `${Math.round(Math.max(edge, 0))}px`).join(" ");
}

export function normalizeRepository(input: string): string | null {
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

export function formatRelative(value: string): string {
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
