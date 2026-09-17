import type {
  ActivityItem,
  RepositoryIssueGroup,
  TodoItem,
} from "../../../lib/types";

export const NOTE_COLORS = ["cream", "blue", "green", "rose", "yellow"] as const;
/** The board never grows past three rows; the rest lives in the drawer. */
export const MAX_BOARD_ROWS = 3;
/** Checklist rows a note shows before it collapses the tail into "+n more". */
export const NOTE_STEP_PREVIEW = 3;

export type NoteColor = typeof NOTE_COLORS[number];

export type BoardCard =
  | { kind: "todo"; item: TodoItem }
  | { kind: "issue"; item: ActivityItem }
  | { kind: "folder"; group: RepositoryIssueGroup };

/** A checklist row being edited: `id` is absent until Rust has minted one. */
export type StepDraft = { key: string; id?: string; text: string; done: boolean };
