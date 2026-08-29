import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bookmark,
  CircleDot,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  MessageCircle,
  MessagesSquare,
  Package,
  Star,
} from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { ActivityItem } from "../../lib/types";

export function verb(item: ActivityItem): string {
  if (item.activityType === "star") return "starred this repository";
  if (item.activityType === "fork") return "forked this repository";
  if (item.activityType === "commit") return "pushed a commit";
  if (item.activityType === "release") return "published a release";
  if (item.activityType === "pullRequest") return `${item.state} a pull request`;
  if (item.activityType === "issue") return `${item.state} an issue`;
  return "updated a discussion";
}

export function relativeTime(date: Date): string {
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d`;
  return `${Math.floor(seconds / 604_800)}w`;
}

export function ActivityCard({ item, saved, onToggleSave, onReport }: {
  item: ActivityItem;
  saved: boolean;
  onToggleSave: () => void;
  onReport: (err: unknown) => void;
}) {
  const TypeIcon = activityIcon(item);
  const [owner, repository = item.repository] = item.repository.split("/");
  const repositoryAvatar = `https://github.com/${encodeURIComponent(owner)}.png?size=96`;
  const open = () => openUrl(item.url).catch(onReport);

  return (
    <article
      className="activity-card activity-feed-card"
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
    >
      <div className="activity-feed-actor">
        {item.actorAvatar ? (
          <img src={item.actorAvatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => event.currentTarget.remove()} />
        ) : <span className="activity-actor-fallback" />}
        <span><strong>{item.actor ?? "GitHub"}</strong> {item.action ?? verb(item)}</span>
        <time>{relativeTime(new Date(item.timestamp))}</time>
      </div>

      <div className="activity-feed-target">
        <div className="activity-repository-avatar" aria-hidden="true">
          <TypeIcon />
          <img src={repositoryAvatar} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(event) => event.currentTarget.remove()} />
          <span><TypeIcon /></span>
        </div>

        <div className="activity-feed-content">
          <h3>{item.title}</h3>
          <div className="activity-feed-repository">
            <span>{owner}/{repository}</span>
            {item.number !== null ? <span className="mono">#{item.number}</span> : null}
          </div>
          <div className="activity-card-meta">
            <Badge variant="secondary" className={`activity-state-badge ${item.state}`}>{item.state}</Badge>
            {item.commentCount ? <span className="activity-comments"><MessageCircle /> {item.commentCount}</span> : null}
            {item.labels?.slice(0, 2).map((label) => <span className="activity-mini-label" key={label.name}>{label.name}</span>)}
          </div>
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className={`save-toggle ${saved ? "is-saved" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleSave();
              }}
              aria-label={saved ? "Remove from saved" : "Save for later"}
              aria-pressed={saved}
            >
              <Bookmark fill={saved ? "currentColor" : "none"} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{saved ? "Remove from saved" : "Save for later"}</TooltipContent>
        </Tooltip>
      </div>
    </article>
  );
}

function activityIcon(item: ActivityItem) {
  if (item.activityType === "commit") return GitCommitHorizontal;
  if (item.activityType === "pullRequest") return GitPullRequest;
  if (item.activityType === "issue") return CircleDot;
  if (item.activityType === "discussion") return MessagesSquare;
  if (item.activityType === "star") return Star;
  if (item.activityType === "fork") return GitFork;
  return Package;
}
