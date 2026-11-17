import {
  Book,
  CircleDot,
  ExternalLink,
  FolderOpen,
  LayoutGrid,
  LibraryBig,
  MessageCircle,
  X,
} from "lucide-react";
import type { ActivityItem, RepositoryIssueGroup } from "../../../lib/types";
import type { NoteColor } from "./types";
import { NOTE_COLORS } from "./types";
import { formatRelative } from "./utils";
import { useI18n } from "../../../lib/i18n";

export function BoardOverflowNote({ hidden, total, onOpen }: {
  hidden: number;
  total: number;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <button className="todo-note todo-overflow-note" onClick={onOpen}>
      <span className="todo-note-tape" />
      <span className="todo-overflow-count">+{hidden}</span>
      <strong>{t("View all")}</strong>
      <small>{t("{count} items on this board", { count: total })}</small>
      <span className="todo-overflow-icon"><LayoutGrid /></span>
    </button>
  );
}

export function IssueNote({ item, color, onOpen }: {
  item: ActivityItem;
  color: NoteColor;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  return (
    <article className={`todo-note todo-issue-note is-${color}`}>
      <span className="todo-note-tape" />
      <header>
        <span className="todo-issue-icon"><CircleDot /></span>
        <div>
          <strong>{item.repository}</strong>
          <span>#{item.number} · {formatRelative(item.timestamp)}</span>
        </div>
        <button className="todo-note-open" onClick={onOpen} aria-label={t("Open {title} on GitHub", { title: item.title })}><ExternalLink /></button>
      </header>
      <button className="todo-issue-title" onClick={onOpen}>{item.title}</button>
      <footer>
        {item.actorAvatar ? <img src={item.actorAvatar} alt="" /> : null}
        <span>{item.actor ?? "GitHub"}</span>
        {item.labels?.slice(0, 2).map((label) => <em key={label.name}>{label.name}</em>)}
      </footer>
    </article>
  );
}

export function IssueFolder({ group, expanded, onToggle }: {
  group: RepositoryIssueGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  return (
    <article className={`todo-issue-folder ${expanded ? "is-expanded" : ""}`}>
      <button
        className="todo-folder-main"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-label={t("Preview {count} issues from {repo}", { count: group.totalCount, repo: group.repository })}
      >
        <span className="todo-folder-art" aria-hidden="true">
          <svg viewBox="0 0 300 250" preserveAspectRatio="none" focusable="false">
            <path
              className="todo-folder-back"
              d="M22 0h78c12 0 20 3 29 9l17 12c7 5 14 7 25 7h107c12 0 22 10 22 22v100H0V22C0 10 10 0 22 0Z"
            />
            <rect className="todo-folder-front" x="0" y="40" width="300" height="210" rx="26" />
          </svg>
        </span>
        <span className="todo-folder-glyph" aria-hidden="true">
          <svg viewBox="0 0 96 96" focusable="false">
            <circle className="todo-folder-glyph-disc" cx="48" cy="48" r="34" />
            <path className="todo-folder-glyph-arrow" d="M48 62V34m0 0-12 12m12-12 12 12" />
          </svg>
        </span>
        <span className="todo-folder-copy">
          <small>{t("{count} items", { count: group.totalCount.toLocaleString() })}</small>
          <strong>{group.repository}</strong>
        </span>
        <span className="todo-folder-library" aria-hidden="true"><Book /></span>
      </button>
    </article>
  );
}

export function IssueFolderPreview({ group, closing, onClose, onOpenDrawer, onOpenIssue }: {
  group: RepositoryIssueGroup;
  closing: boolean;
  onClose: () => void;
  onOpenDrawer: () => void;
  onOpenIssue: (item: ActivityItem) => void;
}) {
  const { t } = useI18n();
  return (
    <section className={`todo-folder-stage ${closing ? "is-closing" : ""}`} aria-label={t("Latest issues from {repo}", { repo: group.repository })}>
      <header className="todo-folder-stage-header">
        <div className="todo-folder-stage-heading">
          <span><FolderOpen /></span>
          <div>
            <strong>{group.repository}</strong>
            <small>{t("{count} open items · newest first", { count: group.totalCount.toLocaleString() })}</small>
          </div>
        </div>
        <div className="todo-folder-stage-actions">
          <button onClick={onOpenDrawer}><LibraryBig />{t("View all")}</button>
          <button onClick={onClose} aria-label={t("Close {repo} preview", { repo: group.repository })}><X /></button>
        </div>
      </header>
      <div className="todo-folder-preview-grid">
        {group.issues.slice(0, 6).map((item, index) => (
          <button
            key={item.id}
            className={`todo-folder-preview-note is-${NOTE_COLORS[(index + 1) % NOTE_COLORS.length]}`}
            style={{ "--preview-index": index } as React.CSSProperties}
            onClick={() => onOpenIssue(item)}
          >
            <span className="todo-note-tape" />
            <span className="todo-folder-preview-meta">
              <span className="todo-issue-icon"><CircleDot /></span>
              <span><strong>{group.repository}</strong><small>#{item.number} · {formatRelative(item.timestamp)}</small></span>
              <ExternalLink />
            </span>
            <strong>{item.title}</strong>
            <span className="todo-folder-preview-detail">
              <span>{item.actor ? t("by {actor}", { actor: item.actor }) : "GitHub"}</span>
              {item.commentCount ? <small><MessageCircle />{item.commentCount}</small> : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
