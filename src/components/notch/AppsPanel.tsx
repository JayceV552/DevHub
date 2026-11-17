import { AppWindow } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";

import { api } from "../../lib/api";
import type { NotchDictionary } from "../../lib/notchI18n";
import type { StatusBarApp } from "../../lib/types";

interface AppsPanelProps {
  apps: StatusBarApp[];
  t: NotchDictionary;
  onRemoved: (pid: number) => void;
  onRefresh: () => void;
}

interface MenuState {
  x: number;
  y: number;
  app: StatusBarApp;
}

const CARD_WIDTH = 580;
const CARD_HEIGHT = 200;
const MENU_WIDTH = 150;
const MENU_HEIGHT = 108;

export function AppsPanel({ apps, t, onRemoved, onRefresh }: AppsPanelProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [flashPid, setFlashPid] = useState<number | null>(null);

  // While the menu is open the notch must not auto-collapse.
  useEffect(() => {
    if (!menu) return;
    api.setNotchPinned(true).catch(() => {});
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      api.setNotchPinned(false).catch(() => {});
    };
  }, [menu]);

  const activate = (app: StatusBarApp) => {
    setFlashPid(app.pid);
    window.setTimeout(() => setFlashPid(null), 450);
    api.activateApp(app.pid).catch(() => {});
  };

  const quit = (pid: number, force: boolean) => {
    setMenu(null);
    onRemoved(pid);
    api.quitApp(pid, force)
      .catch(() => {})
      .finally(() => window.setTimeout(onRefresh, 400));
  };

  const openMenu = (e: MouseEvent, app: StatusBarApp) => {
    e.preventDefault();
    e.stopPropagation();
    // Menu is positioned inside the card; clamp so it never clips at the edges.
    const card = (e.currentTarget as HTMLElement).closest(".notch-card")?.getBoundingClientRect();
    const localX = e.clientX - (card?.left ?? 0);
    const localY = e.clientY - (card?.top ?? 0);
    const x = Math.max(8, Math.min(localX, CARD_WIDTH - MENU_WIDTH - 8));
    const y = localY + MENU_HEIGHT > CARD_HEIGHT - 8 ? Math.max(8, localY - MENU_HEIGHT) : localY;
    setMenu({ x, y, app });
  };

  if (apps.length === 0) {
    return <div className="notch-empty">{t.noApps}</div>;
  }

  const renderApp = (app: StatusBarApp) => (
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
  );

  return (
    <>
      <div className="notch-apps notch-scroll">
        <div className="notch-app-grid">{apps.map(renderApp)}</div>
      </div>

      {menu && (
        <div
          className="notch-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="notch-menu-title">{menu.app.name}</div>
          <button
            type="button"
            onClick={() => {
              activate(menu.app);
              setMenu(null);
            }}
          >
            {t.bringToFront}
          </button>
          <button type="button" onClick={() => quit(menu.app.pid, false)}>
            {t.quitApp}
          </button>
          <button type="button" className="is-danger" onClick={() => quit(menu.app.pid, true)}>
            {t.forceQuit}
          </button>
        </div>
      )}
    </>
  );
}
