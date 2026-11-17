import { Music2 } from "lucide-react";

import type { NotchDictionary } from "../../lib/notchI18n";
import type { MusicStatus } from "../../lib/types";
import { formatTime, livePosition, useNow } from "./notchUtils";

interface MusicPanelProps {
  music: MusicStatus | null;
  active: boolean;
  t: NotchDictionary;
  onControl: (action: "toggle" | "next" | "previous") => void;
}

export function MusicPanel({ music, active, t, onControl }: MusicPanelProps) {
  const hasTrack = Boolean(music?.isRunning && (music.title || music.isPlaying));
  const now = useNow(active && Boolean(music?.isPlaying));
  const position = livePosition(music, now);
  const duration = music?.duration ?? 0;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  return (
    <div className="notch-music">
      <div className={`notch-artwork ${music?.isPlaying ? "is-playing" : ""}`}>
        {music?.artwork ? (
          <img src={music.artwork} alt="" draggable={false} />
        ) : (
          <div className="notch-artwork-empty">
            <Music2 strokeWidth={1.5} />
          </div>
        )}
        {music?.appIcon && <img className="notch-artwork-badge" src={music.appIcon} alt={music.player} draggable={false} />}
      </div>

      <div className="notch-music-body">
        <div className="notch-music-meta">
          <div className="notch-music-title" title={music?.title}>
            {hasTrack ? music?.title || t.unknownTrack : t.notPlaying}
          </div>
          <div className="notch-music-artist">{hasTrack ? music?.artist || music?.player : " "}</div>
        </div>

        <div className="notch-progress">
          <div className="notch-progress-track">
            <div className="notch-progress-fill" style={{ transform: `scaleX(${progress})` }} />
          </div>
          <div className="notch-progress-times">
            <span>{formatTime(position)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <div className="notch-controls">
          <button type="button" title={t.prevTrack} disabled={!hasTrack} onClick={() => onControl("previous")}>
            <TransportIcon kind="previous" />
          </button>
          <button
            type="button"
            className="is-primary"
            title={music?.isPlaying ? t.pause : t.play}
            disabled={!hasTrack}
            onClick={() => onControl("toggle")}
          >
            <TransportIcon kind={music?.isPlaying ? "pause" : "play"} />
          </button>
          <button type="button" title={t.nextTrack} disabled={!hasTrack} onClick={() => onControl("next")}>
            <TransportIcon kind="next" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Solid SF-style transport glyphs; lucide's outlined ones look thin on black. */
function TransportIcon({ kind }: { kind: "play" | "pause" | "previous" | "next" }) {
  const paths = {
    play: "M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z",
    pause: "M6 4h4v16H6zM14 4h4v16h-4z",
    previous: "M11.5 12 21 18V6zM2.5 12 12 18V6z",
    next: "M12.5 12 3 18V6zM21.5 12 12 18V6z",
  } as const;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[kind]} fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}
