import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Clipboard, FileText, FolderSearch, Languages, Layers, Network, Palette, Sparkles, TerminalSquare } from "lucide-react";

import { PageHeader } from "../components/common/PageHeader";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useDevHub } from "../hooks/useDevHub";
import { useTheme } from "../hooks/useTheme";
import { api } from "../lib/api";
import type { Settings as AppSettings, Theme } from "../lib/types";
import { resolveLanguage, useI18n } from "../lib/i18n";

const THEMES: Array<{ id: Theme; label: string }> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const LANGUAGES: Array<{ id: "zh" | "en"; label: string }> = [
  { id: "zh", label: "简体中文" },
  { id: "en", label: "English" },
];

export function SettingsPage() {
  const { t, setLanguage } = useI18n();
  const { report, refreshPorts } = useDevHub();
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [configPath, setConfigPath] = useState("");
  const [searchPath, setSearchPath] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [clipboardCap, setClipboardCap] = useState("");

  useEffect(() => {
    Promise.all([api.getSettings(), api.getConfigPath(), api.getResolvedPath()])
      .then(([loaded, path, resolved]) => {
        setSettings(loaded);
        setConfigPath(path);
        setSearchPath(resolved);
        setClipboardCap(String(loaded.clipboard_storage_cap_mb));
      })
      .catch(report);
  }, [report]);

  const save = async (next: AppSettings) => {
    const merged = { ...next, theme };
    setSettings(merged);
    // Apply instantly; the settings-changed event also reaches the notch window.
    const lang = resolveLanguage(merged.language);
    if (lang) setLanguage(lang);
    try {
      await api.updateSettings(merged);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1600);
      await refreshPorts();
    } catch (err) {
      report(err);
    }
  };

  const saveClipboardCap = () => {
    const cap = Math.min(4096, Math.max(1, Number(clipboardCap) || settings?.clipboard_storage_cap_mb || 256));
    setClipboardCap(String(cap));
    if (settings && cap !== settings.clipboard_storage_cap_mb) {
      void save({ ...settings, clipboard_storage_cap_mb: cap });
    }
  };

  if (!settings) return <div className="spinner-page">{t("Loading settings…")}</div>;

  return (
    <div className="settings-page">
      <PageHeader
        className="settings-header"
        title={t("Settings")}
        subtitle={t("Application preferences and local runtime configuration.")}
        actions={<div className={`settings-save-state ${saved ? "is-visible" : ""}`}><CheckCircle2 />{t("Saved")}</div>}
      />

      <div className="settings-grid">
        <SettingsCard icon={Palette} title="Appearance" description="Choose how DevHub looks on this Mac.">
          <Tabs className="settings-theme-tabs" value={theme} onValueChange={(value) => setTheme(value as Theme)}>
            <TabsList aria-label={t("Application theme")}>
              {THEMES.map((option) => <TabsTrigger key={option.id} value={option.id}>{t(option.label)}</TabsTrigger>)}
            </TabsList>
          </Tabs>
          <p className="settings-hint">{t("System follows the macOS appearance automatically.")}</p>
        </SettingsCard>

        <SettingsCard icon={Languages} title="Language" description="Display language for DevHub and the notch.">
          <Tabs
            className="settings-theme-tabs"
            value={settings.language || "zh"}
            onValueChange={(value) => void save({ ...settings, language: value as "zh" | "en" })}
          >
            <TabsList aria-label={t("Application language")}>
              {LANGUAGES.map((option) => (
                <TabsTrigger key={option.id} value={option.id}>{option.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <p className="settings-hint">{t("Changes apply immediately to the app and the notch.")}</p>
        </SettingsCard>

        <SettingsCard icon={Layers} title="Notch" description="A live island around the camera notch: music, calendar and menu bar apps.">
          <label className="settings-check-row">
            <Checkbox
              checked={settings.enable_notch !== false}
              onCheckedChange={(checked) => {
                const nextVal = checked === true;
                void save({ ...settings, enable_notch: nextVal });
                void api.toggleNotchWindow(nextVal);
              }}
            />
            <span>
              <strong>{t("Enable the notch island")}</strong>
              <small>{t("Hover the notch to expand it.")}</small>
            </span>
          </label>
          <div className="mt-3 flex items-center justify-between pt-2 border-t border-[var(--border)]">
            <p className="settings-hint text-xs">
              {t("Shows now playing, your calendar, and menu bar apps hidden behind the notch.")}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void api.toggleNotchWindow(true);
                void api.setNotchWindowState(true);
              }}
            >
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              {t("Open notch")}
            </Button>
          </div>
        </SettingsCard>

        <SettingsCard icon={Clipboard} title="Clipboard" description="Control how much local clipboard history is retained.">
          <SettingRow label="Storage cap" hint="Oldest copies are removed first when this limit is reached.">
            <div className="settings-number-input">
              <Input
                id="clipboard-cap"
                type="number"
                min={1}
                max={4096}
                step={16}
                value={clipboardCap}
                onChange={(event) => setClipboardCap(event.target.value)}
                onBlur={saveClipboardCap}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
              />
              <span>MB</span>
            </div>
          </SettingRow>
        </SettingsCard>

        <SettingsCard icon={TerminalSquare} title="Terminal" description="Defaults applied to newly started processes.">
          <SettingRow label="Scrollback" hint="Maximum terminal output retained per process.">
            <div className="settings-number-input">
              <Input
                id="buffer"
                type="number"
                min={100}
                max={100000}
                step={500}
                value={settings.output_buffer_lines}
                onChange={(event) => void save({ ...settings, output_buffer_lines: Number(event.target.value) || 1000 })}
              />
              <span>{t("lines")}</span>
            </div>
          </SettingRow>
          <SettingRow label="Stop grace period" hint="Time before DevHub force-stops an unresponsive process.">
            <div className="settings-number-input">
              <Input
                id="grace"
                type="number"
                min={0}
                max={60}
                value={settings.stop_grace_seconds}
                onChange={(event) => void save({ ...settings, stop_grace_seconds: Number(event.target.value) || 0 })}
              />
              <span>{t("seconds")}</span>
            </div>
          </SettingRow>
        </SettingsCard>

        <SettingsCard icon={Network} title="Ports" description="Reduce noise from operating-system services.">
          <label className="settings-check-row">
            <Checkbox
              checked={settings.hide_system_ports}
              onCheckedChange={(checked) => void save({ ...settings, hide_system_ports: checked === true })}
            />
            <span><strong>{t("Hide system ports")}</strong><small>{t("Exclude listening ports below 1024.")}</small></span>
          </label>
        </SettingsCard>

        <SettingsCard className="is-wide" icon={FileText} title="Configuration file" description="DevHub stores these settings locally in config.toml.">
          <code className="settings-config-path">{configPath}</code>
        </SettingsCard>

        <SettingsCard className="is-wide" icon={FolderSearch} title="Command PATH" description="Directories searched for npm, pnpm, cargo and other development tools.">
          <ol className="settings-path-list">
            {searchPath.map((directory, index) => <li key={directory}><span>{index + 1}</span><code>{directory}</code></li>)}
          </ol>
        </SettingsCard>
      </div>
    </div>
  );
}

function SettingsCard({ icon: Icon, title, description, className = "", children }: {
  icon: typeof Palette;
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className={`settings-card ${className}`}>
      <header><span className="settings-card-icon"><Icon /></span><div><h2>{t(title)}</h2><p>{t(description)}</p></div></header>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}

function SettingRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  const { t } = useI18n();
  return <div className="settings-row"><div><strong>{t(label)}</strong><small>{t(hint)}</small></div>{children}</div>;
}
