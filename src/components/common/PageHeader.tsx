import { useCallback, type MouseEvent as ReactMouseEvent, type MouseEventHandler, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useDevHub } from "../../hooks/useDevHub";
import { cn } from "../../lib/utils";

const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "label",
  "[role='button']",
  "[contenteditable='true']",
  "[data-window-drag='false']",
].join(",");

function isInteractiveTarget(event: ReactMouseEvent<HTMLElement>): boolean {
  return event.target instanceof Element && Boolean(event.target.closest(INTERACTIVE_SELECTOR));
}

export function useWindowDragHandle(): {
  onMouseDown: MouseEventHandler<HTMLElement>;
  onDoubleClick: MouseEventHandler<HTMLElement>;
} {
  const { report } = useDevHub();

  const onMouseDown = useCallback<MouseEventHandler<HTMLElement>>((event) => {
    if (event.button !== 0 || event.detail !== 1 || isInteractiveTarget(event)) return;
    event.preventDefault();
    void getCurrentWindow().startDragging().catch(report);
  }, [report]);

  const onDoubleClick = useCallback<MouseEventHandler<HTMLElement>>((event) => {
    if (event.button !== 0 || isInteractiveTarget(event)) return;
    event.preventDefault();
    void getCurrentWindow().toggleMaximize().catch(report);
  }, [report]);

  return { onMouseDown, onDoubleClick };
}

export function PageHeader({ title, subtitle, actions, className }: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const windowDragHandle = useWindowDragHandle();

  return (
    <header className={cn("page-header", className)} {...windowDragHandle}>
      <div className="page-heading">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}
