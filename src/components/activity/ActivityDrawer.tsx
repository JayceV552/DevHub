import { useEffect, type CSSProperties } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bookmark,
  ChevronDown,
  ChevronUp,
  CircleDot,
  ExternalLink,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  MessagesSquare,
  Package,
  Star,
  X,
} from "lucide-react";

import type { ActivityItem } from "../../lib/types";
import { relativeTime, verb } from "./ActivityCard";
import { Button } from "../ui/button";

export function ActivityDrawer({ item, saved, onToggleSave, onClose, onPrevious, onNext, onReport }: {
  item: ActivityItem;
  saved: boolean;
  onToggleSave: () => void;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onReport: (err: unknown) => void;
}) {
  const TypeIcon = item.activityType === "commit"
    ? GitCommitHorizontal
    : item.activityType === "pullRequest"
      ? GitPullRequest
    : item.activityType === "issue"
      ? CircleDot
      : item.activityType === "discussion"
        ? MessagesSquare
        : item.activityType === "star"
          ? Star
          : item.activityType === "fork"
            ? GitFork
            : Package;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key.toLowerCase() === "j" && onNext) onNext();
      if (event.key.toLowerCase() === "k" && onPrevious) onPrevious();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNext, onPrevious]);

  return (
    <>
      <button className="activity-drawer-scrim" aria-label="Close activity details" onClick={onClose} />
      <aside className="activity-drawer is-open" aria-label="Activity details">
        <header className="drawer-head">
          <span className={`activity-type-icon activity-avatar ${item.state}`}>
            <TypeIcon />
            {item.actorAvatar ? <img src={item.actorAvatar} alt="" referrerPolicy="no-referrer" onError={(event) => event.currentTarget.remove()} /> : null}
          </span>
          <span className="repo">{item.repository}</span>
          {item.number !== null ? <span className="num">#{item.number}</span> : null}
          <div className="actions">
            <Button variant="ghost" size="icon-xs" aria-label={saved ? "Remove from saved" : "Save for later"} onClick={onToggleSave}>
              <Bookmark fill={saved ? "currentColor" : "none"} />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label="Open on GitHub" onClick={() => openUrl(item.url).catch(onReport)}><ExternalLink /></Button>
            <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={onClose}><X /></Button>
          </div>
        </header>

        <div className="drawer-body">
          <section>
            <h2 className="drawer-title">{item.title}</h2>
            <div className="drawer-meta">
              <span className={`activity-state-badge ${item.state}`}>{verb(item)}</span>
              {item.actor ? <span>by <strong>{item.actor}</strong></span> : null}
              <span>{relativeTime(new Date(item.timestamp))} ago</span>
              {item.commentCount ? <span>{item.commentCount} comments</span> : null}
            </div>
          </section>

          {item.labels?.length ? (
            <div className="drawer-labels">
              {item.labels.map((label) => <span key={label.name} style={{ "--label-color": `#${label.color}` } as CSSProperties}>{label.name}</span>)}
            </div>
          ) : null}

          {item.body ? (
            <section className="drawer-description">
              <div className="drawer-section-label">Description</div>
              <p>{item.body}</p>
            </section>
          ) : null}

          {item.additions != null || item.deletions != null || item.changedFiles != null || item.reviewDecision ? (
            <section className="drawer-stats">
              {item.changedFiles != null ? <div><span>Changed files</span><strong>{item.changedFiles}</strong></div> : null}
              {item.additions != null ? <div className="additions"><span>Additions</span><strong>+{item.additions}</strong></div> : null}
              {item.deletions != null ? <div className="deletions"><span>Deletions</span><strong>−{item.deletions}</strong></div> : null}
              {item.reviewDecision ? <div><span>Review</span><strong>{item.reviewDecision.toLowerCase().replace(/_/g, " ")}</strong></div> : null}
            </section>
          ) : null}

          <div className="drawer-actions">
            <Button size="sm" onClick={() => openUrl(item.url).catch(onReport)}>Open on GitHub<ExternalLink /></Button>
          </div>
        </div>

        <footer className="drawer-foot">
          <Button variant="ghost" size="xs" disabled={!onPrevious} onClick={onPrevious}><ChevronUp />Previous</Button>
          <Button variant="ghost" size="xs" disabled={!onNext} onClick={onNext}><ChevronDown />Next</Button>
          <span className="spacer" />
          <span><kbd>j</kbd> <kbd>k</kbd> navigate</span>
          <span><kbd>esc</kbd> close</span>
        </footer>
      </aside>
    </>
  );
}
