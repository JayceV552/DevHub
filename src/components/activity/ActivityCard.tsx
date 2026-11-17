import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Bookmark,
  CircleDot,
  GitCommitHorizontal,
  GitFork,
  GitPullRequest,
  Globe2,
  MessageCircle,
  MessagesSquare,
  Package,
  Star,
} from "lucide-react";
import { memo } from "react";
import type { CSSProperties } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { ActivityItem } from "../../lib/types";
import { translate, useI18n } from "../../lib/i18n";

export function verb(item: ActivityItem): string {
  if (item.activityType === "star") return translate("starred this repository");
  if (item.activityType === "fork") return translate("forked this repository");
  if (item.activityType === "commit") return translate("pushed a commit");
  if (item.activityType === "release") return translate("published a release");
  if (item.activityType === "publish") return translate("made this repository public");
  if (item.activityType === "pullRequest") return translate("{state} a pull request", { state: translate(item.state) });
  if (item.activityType === "issue") return translate("{state} an issue", { state: translate(item.state) });
  return translate("updated a discussion");
}

export function relativeTime(date: Date): string {
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return translate("now");
  if (seconds < 3600) return translate("{n}m", { n: Math.floor(seconds / 60) });
  if (seconds < 86_400) return translate("{n}h", { n: Math.floor(seconds / 3600) });
  if (seconds < 604_800) return translate("{n}d", { n: Math.floor(seconds / 86_400) });
  return translate("{n}w", { n: Math.floor(seconds / 604_800) });
}

// Memoised: a single save toggle re-renders the whole board, and every column
// re-renders on each keystroke in its search box. Both props below are stable
// identities, so the ~20 cards per column stay untouched.
export const ActivityCard = memo(function ActivityCard({ item, saved, onToggleSave, onReport }: {
  item: ActivityItem;
  saved: boolean;
  onToggleSave: (item: ActivityItem) => void;
  onReport: (err: unknown) => void;
}) {
  const { t } = useI18n();
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
          <img src={item.actorAvatar} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
        ) : <span className="activity-actor-fallback" />}
        <span><strong>{item.actor ?? "GitHub"}</strong> {item.action ?? verb(item)}</span>
        <time>{relativeTime(new Date(item.timestamp))}</time>
      </div>

      <div className="activity-feed-target">
        <div className="activity-repository-avatar" aria-hidden="true">
          <TypeIcon />
          <img src={repositoryAvatar} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
          <span><TypeIcon /></span>
        </div>

        <div className="activity-feed-content">
          <h3>{item.title}</h3>
          <div className="activity-feed-repository">
            <span>{owner}/{repository}</span>
            {item.number !== null ? <span className="mono">#{item.number}</span> : null}
          </div>
          <div className="activity-card-meta">
            {item.activityType !== "commit" ? <Badge variant="secondary" className={`activity-state-badge ${item.state}`}>{item.state}</Badge> : null}
            {item.labels?.slice(0, 2).map((label) => (
              <span
                className="activity-mini-label"
                key={label.name}
                style={labelStyle(label.color)}
              >
                {label.name}
              </span>
            ))}
            {item.commentCount ? <span className="activity-comments"><MessageCircle /> {item.commentCount}</span> : null}
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
                onToggleSave(item);
              }}
              aria-label={saved ? t("Remove from saved") : t("Save for later")}
              aria-pressed={saved}
            >
              <Bookmark fill={saved ? "currentColor" : "none"} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{saved ? t("Remove from saved") : t("Save for later")}</TooltipContent>
        </Tooltip>
      </div>
    </article>
  );
});

function activityIcon(item: ActivityItem) {
  if (item.activityType === "commit") return GitCommitHorizontal;
  if (item.activityType === "pullRequest") return GitPullRequest;
  if (item.activityType === "issue") return CircleDot;
  if (item.activityType === "discussion") return MessagesSquare;
  if (item.activityType === "star") return Star;
  if (item.activityType === "fork") return GitFork;
  if (item.activityType === "publish") return Globe2;
  return Package;
}

function safeLabelColor(color: string): string {
  return /^#?[0-9a-f]{6}$/i.test(color) ? `#${color.replace(/^#/, "")}` : "#6e7681";
}

function labelStyle(color: string): CSSProperties {
  const background = safeLabelColor(color);
  const value = background.slice(1);
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  const foreground = (red * 299 + green * 587 + blue * 114) / 1000 > 155 ? "#111827" : "#ffffff";
  return { "--label-color": background, "--label-text": foreground } as CSSProperties;
}
