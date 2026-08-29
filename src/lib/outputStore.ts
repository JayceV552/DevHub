import type { OutputLine } from "./types";

class OutputStore {
  private buffers = new Map<string, OutputLine[]>();
  private listeners = new Map<string, Set<() => void>>();
  private static readonly LIMIT = 5_000;
  private static readonly EMPTY: OutputLine[] = [];

  append(runId: string, lines: OutputLine[]): void {
    if (lines.length === 0) return;
    const current = this.buffers.get(runId) ?? OutputStore.EMPTY;
    const next = current.concat(lines);
    this.buffers.set(
      runId,
      next.length > OutputStore.LIMIT ? next.slice(next.length - OutputStore.LIMIT) : next,
    );
    this.emit(runId);
  }

  replace(runId: string, lines: OutputLine[]): void {
    this.buffers.set(runId, lines);
    this.emit(runId);
  }

  clear(runId: string): void {
    this.buffers.delete(runId);
    this.emit(runId);
  }

  get(runId: string): OutputLine[] {
    return this.buffers.get(runId) ?? OutputStore.EMPTY;
  }

  has(runId: string): boolean {
    return this.buffers.has(runId);
  }

  subscribe(runId: string, listener: () => void): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  private emit(runId: string): void {
    this.listeners.get(runId)?.forEach((listener) => listener());
  }
}

export const outputStore = new OutputStore();
