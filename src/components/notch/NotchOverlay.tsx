import { ArrowUpRight, Gauge, House, LayoutGrid, type LucideIcon } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";

import { api } from "../../lib/api";
import { NOTCH_I18N, type NotchDictionary } from "../../lib/notchI18n";
import { AppsPanel } from "./AppsPanel";
import { CalendarPanel } from "./CalendarPanel";
import { DevHubPanel } from "./DevHubPanel";
import { MusicPanel } from "./MusicPanel";
import { useArtworkColor } from "./notchUtils";
import {
  useNotchExpanded,
  useNotchLanguage,
  useNotchSize,
  useNowPlaying,
  useQuickStats,
  useStatusBarApps,
  type NotchTab,
} from "./useNotchData";

/** Expanded card size; must match kCardWidth/kCardHeight in notch_window.m. */
const CARD = { width: 580, height: 200, radius: 26 };

const TABS: Array<{ id: NotchTab; icon: LucideIcon; label: (t: NotchDictionary) => string }> = [
  { id: "home", icon: House, label: (t) => t.tabHome },
  { id: "apps", icon: LayoutGrid, label: (t) => t.tabApps },
  { id: "devhub", icon: Gauge, label: (t) => t.tabDevHub },
];

export function NotchOverlay() {
  const expanded = useNotchExpanded();
  const language = useNotchLanguage();
  const notch = useNotchSize();
  const [tab, setTab] = useState<NotchTab>("home");
  const t = NOTCH_I18N[language];

  const { music, control } = useNowPlaying();
  const accent = useArtworkColor(music?.artwork);
  const { apps, removeApp, refresh: refreshApps } = useStatusBarApps(expanded && tab === "apps");
  const { stats, refresh: refreshStats } = useQuickStats(expanded && tab === "devhub");

  // Collapsed "live activity": artwork on the left of the notch, equalizer on
  // the right — only while something is actually playing.
  const live = !expanded && Boolean(music?.isPlaying);
  const wing = notch.height + 6;

  useEffect(() => {
    api.setNotchLiveWing(music?.isPlaying ? wing : 0).catch(() => {});
  }, [music?.isPlaying, wing]);

  // Collapsed corners follow the hardware notch, with or without wings.
  const nativeRadius = notch.height / 3;
  const shape = expanded
    ? { w: CARD.width, h: CARD.height, r: CARD.radius }
    : live
      ? { w: notch.width + wing * 2, h: notch.height, r: nativeRadius }
      : { w: notch.width, h: notch.height, r: nativeRadius };

  const style = {
    "--nw": `${shape.w}px`,
    "--nh": `${shape.h}px`,
    "--nr": `${shape.r}px`,
    "--wing": `${wing}px`,
    ...(accent ? { "--notch-accent": accent } : {}),
  } as CSSProperties;

  return (
    <div className={`notch-root ${expanded ? "is-expanded" : ""} ${live ? "is-live" : ""}`} style={style}>
      <span className="notch-ear is-left" aria-hidden="true" />
      <span className="notch-ear is-right" aria-hidden="true" />

      <div className="notch-island">
        <LiveActivity artwork={music?.artwork} playing={Boolean(music?.isPlaying)} />

        <div className="notch-card" aria-hidden={!expanded}>
          <header className="notch-header">
            <nav className="notch-tabs">
              {TABS.map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  type="button"
                  title={label(t)}
                  aria-label={label(t)}
                  aria-pressed={tab === id}
                  className={tab === id ? "is-active" : ""}
                  onClick={() => setTab(id)}
                >
                  <Icon strokeWidth={2} />
                </button>
              ))}
            </nav>
            <button
              type="button"
              className="notch-icon-btn"
              title={t.openDevHub}
              aria-label={t.openDevHub}
              onClick={() => api.showDevHubMainWindow().catch(() => {})}
            >
              <ArrowUpRight strokeWidth={2} />
            </button>
          </header>

          <div className="notch-body" key={tab}>
            {tab === "home" && (
              <div className="notch-home">
                <MusicPanel music={music} active={expanded} t={t} onControl={control} />
                <CalendarPanel language={language} t={t} active={expanded} />
              </div>
            )}
            {tab === "apps" && <AppsPanel apps={apps} t={t} onRemoved={removeApp} onRefresh={refreshApps} />}
            {tab === "devhub" && <DevHubPanel stats={stats} t={t} onChanged={refreshStats} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveActivity({ artwork, playing }: { artwork?: string | null; playing: boolean }) {
  return (
    <div className="notch-live" aria-hidden="true">
      <div className="notch-live-art">{artwork && <img src={artwork} alt="" draggable={false} />}</div>
      <div className={`notch-eq ${playing ? "is-playing" : ""}`}>
        <span />
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}
