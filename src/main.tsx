import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { NotchOverlay } from "./components/notch/NotchOverlay";
import { TooltipProvider } from "./components/ui/tooltip";
import { ThemeProvider } from "./hooks/useTheme";
import "./styles.css";
import { I18nProvider } from "./lib/i18n";

const isNotchWindow =
  window.location.search.includes("window=notch") ||
  window.location.pathname.includes("notch");

if (isNotchWindow) {
  document.documentElement.classList.add("is-notch-window");
  document.body.classList.add("is-notch-window");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={350}>
        {isNotchWindow ? (
          <NotchOverlay />
        ) : (
          <I18nProvider>
            <App />
          </I18nProvider>
        )}
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
