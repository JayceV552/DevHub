import { AppWindow } from "lucide-react";
import { useState, type MouseEvent } from "react";

import { api } from "../../lib/api";
import type { NotchDictionary } from "../../lib/notchI18n";
import type { StatusBarApp } from "../../lib/types";

interface AppsPanelProps {
  apps: StatusBarApp[];
  t: NotchDictionary;
  onRemoved: (pid: number) => void;
  onRefresh: () => void;
}

export function AppsPanel({ apps, t, onRemoved, onRefresh }: AppsPanelProps) {
  const [flashPid, setFlashPid] = useState<number | null>(null);

  const activate = (app: StatusBarApp) => {
    setFlashPid(app.pid);
    window.setTimeout(() => setFlashPid(null), 450);
    api.activateApp(app.pid).catch(() => {});
  };

  const quit = (pid: number, force: boolean) => {
    onRemoved(pid);
    api.quitApp(pid, force)
      .catch(() => {})
      .finally(() => window.setTimeout(onRefresh, 400));
  };

  // Right-click opens the app's own menu bar menu (or a native fallback menu)
  // — a real system menu, so it is never clipped by the popup.
  const openMenu = (e: MouseEvent, app: StatusBarApp) => {
    e.preventDefault();
    e.stopPropagation();
    api.showAppContextMenu(app.pid, [app.name, t.bringToFront, t.showInFinder, t.quitApp, t.forceQuit])
      .then((action) => {
        if (action === "activate") activate(app);
        else if (action === "quit") quit(app.pid, false);
        else if (action === "force-quit") quit(app.pid, true);
      })
      .catch(() => {});
  };

  if (apps.length === 0) {
    return <div className="notch-empty">{t.noApps}</div>;
  }

  return (
    <div className="notch-apps notch-scroll">
      <div className="notch-app-grid">
        {apps.map((app) => (
          <button
            key={app.pid}
            type="button"
            className={`notch-app ${flashPid === app.pid ? "is-flash" : ""}`}
            title={app.name}
            onClick={() => activate(app)}
            onContextMenu={(e) => openMenu(e, app)}
          >
            {app.iconBase64 ? (
              <img src={app.iconBase64} alt="" draggable={false} />
            ) : (
              <span className="notch-app-fallback">
                <AppWindow strokeWidth={1.5} />
              </span>
            )}
            <span className="notch-app-name">{app.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
