import { useEffect, useState } from "react";

import type { MusicStatus } from "../../lib/types";

export function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Position extrapolated from the last sample, so progress moves without polling. */
export function livePosition(music: MusicStatus | null, now: number): number {
  if (!music) return 0;
  const elapsed = music.isPlaying ? Math.max(0, now - music.sampledAt) / 1000 : 0;
  const pos = music.position + elapsed;
  return music.duration > 0 ? Math.min(pos, music.duration) : pos;
}

/** A clock that only ticks while `active` — idle notch means zero timers. */
export function useNow(active: boolean, intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs]);
  return now;
}

const colorCache = new Map<string, string>();

/**
 * Average colour of the artwork, lifted so it reads on black. Returns an
 * "r, g, b" triple for use in rgb()/rgba(). Sampled once per artwork on an
 * 8×8 canvas and cached.
 */
export function useArtworkColor(src: string | null | undefined): string | null {
  const [color, setColor] = useState<string | null>(() => (src ? colorCache.get(src) ?? null : null));

  useEffect(() => {
    if (!src) {
      setColor(null);
      return;
    }
    const cached = colorCache.get(src);
    if (cached) {
      setColor(cached);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 8;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 8, 8);
      const data = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, b = 0, weight = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [pr, pg, pb] = [data[i], data[i + 1], data[i + 2]];
        // Favour saturated pixels so the tint isn't a muddy grey.
        const w = 0.2 + (Math.max(pr, pg, pb) - Math.min(pr, pg, pb)) / 255;
        r += pr * w; g += pg * w; b += pb * w; weight += w;
      }
      const value = liftColor(r / weight, g / weight, b / weight);
      colorCache.set(src, value);
      setColor(value);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return color;
}

function liftColor(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b, 1);
  // Scale up so the brightest channel lands around 230.
  const k = Math.max(1, 230 / max);
  const c = (v: number) => Math.round(Math.min(255, v * k));
  return `${c(r)}, ${c(g)}, ${c(b)}`;
}

// ---------------------------------------------------------------------------
// Calendar helpers

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const LUNAR_DAYS = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
];

let lunarFormatter: Intl.DateTimeFormat | null | undefined;

/** Chinese lunar date, e.g. "十月初九". Null if the engine lacks the calendar. */
export function lunarDate(date: Date): string | null {
  if (lunarFormatter === undefined) {
    try {
      lunarFormatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { month: "long", day: "numeric" });
    } catch {
      lunarFormatter = null;
    }
  }
  if (!lunarFormatter) return null;
  const parts = lunarFormatter.formatToParts(date);
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const rawDay = parts.find((p) => p.type === "day")?.value ?? "";
  const n = Number.parseInt(rawDay, 10);
  const day = Number.isFinite(n) && n >= 1 && n <= 30 ? LUNAR_DAYS[n - 1] : rawDay;
  return month && day ? `${month}${day}` : null;
}
