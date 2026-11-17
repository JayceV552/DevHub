import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, onSettingsChanged } from "../api";
import { ZH } from "./zh";

/**
 * Gettext-style i18n: the English source string *is* the key. Untranslated
 * strings fall back to English, so adding UI text never breaks rendering.
 *
 *   t("Projects")                       → "项目"
 *   t("{count} running", { count: 3 })  → "3 个运行中"
 */
export type Language = "zh" | "en";
export type TranslateVars = Record<string, string | number>;
export type Translate = (source: string, vars?: TranslateVars) => string;

const DICTIONARIES: Record<Language, Record<string, string>> = { zh: ZH, en: {} };

let currentLanguage: Language = "zh";

function interpolate(text: string, vars?: TranslateVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

function translateTo(language: Language, source: string, vars?: TranslateVars): string {
  return interpolate(DICTIONARIES[language][source] ?? source, vars);
}

/** For non-component helpers. Components should prefer `useI18n().t`. */
export const translate: Translate = (source, vars) => translateTo(currentLanguage, source, vars);

export function resolveLanguage(value: unknown): Language | null {
  return value === "zh" || value === "en" ? value : null;
}

interface I18nValue {
  language: Language;
  locale: string;
  t: Translate;
  /** Apply immediately (e.g. right after saving settings). */
  setLanguage: (language: Language) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(currentLanguage);

  const setLanguage = useCallback((next: Language) => {
    currentLanguage = next;
    setLanguageState(next);
  }, []);

  useEffect(() => {
    api.getSettings()
      .then((s) => {
        const lang = resolveLanguage(s?.language);
        if (lang) setLanguage(lang);
      })
      .catch(() => {});

    let unlisten: (() => void) | null = null;
    let disposed = false;
    onSettingsChanged((s) => {
      const lang = resolveLanguage(s?.language);
      if (lang) setLanguage(lang);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [setLanguage]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);

  const value = useMemo<I18nValue>(
    () => ({
      language,
      locale: language === "zh" ? "zh-CN" : "en-US",
      t: (source, vars) => translateTo(language, source, vars),
      setLanguage,
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
