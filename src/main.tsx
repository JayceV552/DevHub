import React from "react";
import ReactDOM from "react-dom/client";

import App from "./App";
import { TooltipProvider } from "./components/ui/tooltip";
import { ThemeProvider } from "./hooks/useTheme";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={350}>
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
