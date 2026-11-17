import { useCallback, useEffect, useRef, useState } from "react";

import { api, onNotchExpand, onNotchMusic, onSettingsChanged } from "../../lib/api";
import { resolveNotchLanguage, type NotchLanguage } from "../../lib/notchI18n";
import type { MusicStatus, NotchQuickStats, StatusBarApp } from "../../lib/types";
import { livePosition } from "./notchUtils";

export type NotchTab = "home" | "apps" | "devhub";

declare global {
  interface Window {
    __DEVHUB_NOTCH_EXPAND?: (expanded: boolean) => void;
  }
}

/** Subscribe to a Tauri event inside an effect, handling the async unlisten. */
function useTauriEvent<T>(subscribe: (handler: (value: T) => void) => Promise<() => void>, handler: (value: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    subscribe((value) => handlerRef.current(value))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [subscribe]);
}

export function useNotchExpanded() {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    // The native layer calls this directly (fastest path) …
    window.__DEVHUB_NOTCH_EXPAND = setExpanded;
    return () => {
      window.__DEVHUB_NOTCH_EXPAND = undefined;
    };
  }, []);
  // … and also emits an event, as a fallback.
  useTauriEvent(onNotchExpand, setExpanded);
  return expanded;
}

export function useNotchLanguage(): NotchLanguage {
  const [language, setLanguage] = useState<NotchLanguage>("zh");
  useEffect(() => {
    api.getSettings()
      .then((s) => {
        const lang = resolveNotchLanguage(s?.language);
        if (lang) setLanguage(lang);
      })
      .catch(() => {});
  }, []);
  useTauriEvent(onSettingsChanged, (s) => {
    const lang = resolveNotchLanguage(s?.language);
    if (lang) setLanguage(lang);
  });
  return language;
}

export function useNotchSize() {
  const [size, setSize] = useState({ width: 185, height: 32 });
  useEffect(() => {
    api.getNotchInfo()
      .then((info) => {
        if (info && info.notchWidth > 0 && info.safeAreaTop > 0) {
          setSize({ width: info.notchWidth, height: info.safeAreaTop });
        }
      })
      .catch(() => {});
  }, []);
  return size;
}

/** Now-playing state pushed by the native stream; no polling from the webview. */
export function useNowPlaying() {
  const [music, setMusic] = useState<MusicStatus | null>(null);
  const reconcileRef = useRef<number | null>(null);

  useEffect(() => {
    api.getMusicStatus().then(setMusic).catch(() => {});
    return () => {
      if (reconcileRef.current) window.clearTimeout(reconcileRef.current);
    };
  }, []);
  useTauriEvent(onNotchMusic, setMusic);

  const control = useCallback((action: "toggle" | "next" | "previous") => {
    const now = Date.now();
    // Optimistic update; the stream confirms within ~1s.
    setMusic((prev) => {
      if (!prev) return prev;
      if (action === "toggle") {
        return { ...prev, isPlaying: !prev.isPlaying, position: livePosition(prev, now), sampledAt: now };
      }
      return { ...prev, position: 0, sampledAt: now };
    });
    api.controlMusic(action).catch(() => {});
    // The stream only emits on change, so if the command was ignored the
    // optimistic state would stick — re-read the cached truth shortly after.
    if (reconcileRef.current) window.clearTimeout(reconcileRef.current);
    reconcileRef.current = window.setTimeout(() => {
      api.getMusicStatus().then(setMusic).catch(() => {});
    }, 1500);
  }, []);

  return { music, control };
}

/** Polls `load` every `intervalMs` while `active`; does nothing otherwise. */
function usePolling<T>(active: boolean, load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(() => {
    loadRef.current().then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    if (!active) return;
    refresh();
    const id = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(id);
  }, [active, intervalMs, refresh]);

  return { data, setData, refresh };
}

export function useStatusBarApps(active: boolean) {
  const { data, setData, refresh } = usePolling(
    active,
    () => api.getStatusBarApps().then((r) => r.apps ?? []),
    5000,
  );
  const apps: StatusBarApp[] = data ?? [];
  const removeApp = useCallback(
    (pid: number) => setData((prev) => (prev ?? []).filter((a) => a.pid !== pid)),
    [setData],
  );
  return { apps, removeApp, refresh };
}

export function useQuickStats(active: boolean) {
  const { data, refresh } = usePolling<NotchQuickStats>(active, () => api.getNotchQuickStats(), 4000);
  return { stats: data, refresh };
}
