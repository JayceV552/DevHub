import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "../components/ui/button";
import { api, errorMessage } from "../lib/api";
import type { Theme } from "../lib/types";

interface ThemeValue {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";

const systemPrefers = (): "light" | "dark" =>
  window.matchMedia(DARK_QUERY).matches ? "dark" : "light";

function apply(resolved: "light" | "dark") {
  document.documentElement.dataset.theme = resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">(systemPrefers);

  const resolved = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((settings) => {
        if (!cancelled) setThemeState(settings.theme);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent) =>
      setSystemTheme(event.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    apply(resolved);
    const timer = window.setTimeout(
      () => document.documentElement.classList.add("theme-ready"),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [resolved]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    api
      .getSettings()
      .then((settings) => api.updateSettings({ ...settings, theme: next }))
      .catch((err) => console.error("could not save theme:", errorMessage(err)));
  }, []);

  const toggle = useCallback(
    () => setTheme(resolved === "dark" ? "light" : "dark"),
    [resolved, setTheme],
  );

  const value = useMemo<ThemeValue>(
    () => ({ theme, resolved, setTheme, toggle }),
    [theme, resolved, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}

export function ThemeToggle() {
  const { resolved, toggle, theme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="theme-toggle"
      onClick={toggle}
      title={`${resolved === "dark" ? "Light" : "Dark"} theme${
        theme === "system" ? " (currently following the system)" : ""
      }`}
      aria-label="Toggle theme"
    >
      {resolved === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
