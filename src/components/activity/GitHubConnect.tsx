import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { api, errorMessage, onGitHubAuth } from "../../lib/api";
import type { DeviceLogin, GitHubStatus, Settings } from "../../lib/types";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const NEW_GITHUB_APP = "https://github.com/settings/apps/new";
const NEW_OAUTH_APP = "https://github.com/settings/applications/new";

export function GitHubConnect({
  onReport,
  onConnected,
}: {
  onReport: (err: unknown) => void;
  onConnected: () => void;
}) {
  const [showHelp, setShowHelp] = useState(false);
  const [showOwnApp, setShowOwnApp] = useState(false);
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [login, setLogin] = useState<DeviceLogin | null>(null);
  const [pat, setPat] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [current, settings] = await Promise.all([api.githubStatus(), api.getSettings()]);
      setStatus(current);
      setClientId(settings.github_client_id ?? "");
    } catch (err) {
      onReport(err);
    }
  }, [onReport]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onGitHubAuth((outcome) => {
      setLogin(null);
      setBusy(false);
      switch (outcome.status) {
        case "authorized":
          setError(null);
          onConnected();
          break;
        case "denied":
          setError("Authorization was declined.");
          break;
        case "expired":
          setError("The code expired. Try again.");
          break;
        case "cancelled":
          break;
        case "failed":
          setError(outcome.message);
          break;
      }
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [refresh, onConnected]);

  const saveClientId = async (value: string) => {
    setClientId(value);
    try {
      const settings: Settings = await api.getSettings();
      await api.updateSettings({ ...settings, github_client_id: value.trim() || null });
      refresh();
    } catch (err) {
      onReport(err);
    }
  };

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const started = await api.githubStartLogin();
      setLogin(started);
      await navigator.clipboard.writeText(started.userCode).catch(() => {});
      await openUrl(started.verificationUri);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const cancel = async () => {
    await api.githubCancelLogin().catch(() => {});
    setLogin(null);
    setBusy(false);
  };

  const savePat = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.setGithubToken(pat);
      setPat("");
      setShowPat(false);
      onConnected();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  return (
    <section className="connect-panel">
      <div className="connect-head">
        <h3>Connect GitHub</h3>
        <p>
          Pull requests, issues, discussions and releases from your projects' repositories, in
          one timeline.
        </p>
      </div>

      {login ? (
        <div className="device-login">
          <p>Enter this code on GitHub — it is already on your clipboard.</p>
          <div className="device-code">{login.userCode}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Button
              size="sm"
              onClick={() => openUrl(login.verificationUri).catch(onReport)}
            >
              Reopen GitHub ↗
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
            <span className="hint">Waiting for authorization…</span>
          </div>
        </div>
      ) : (
        <>
          {status.clientIdSource === "bundled" && !showOwnApp ? (
            <p className="hint" style={{ fontFamily: "var(--sans)", margin: "0 0 10px" }}>
              Sign in to read activity from your projects' repositories.{" "}
              <button className="link-button" onClick={() => setShowOwnApp(true)}>
                Use my own GitHub App
              </button>
            </p>
          ) : (
            <div className="field">
              <label htmlFor="client-id">Client ID (GitHub App or OAuth App)</label>
              <Input
                id="client-id"
                data-slot="input"
                type="text"
                placeholder="Iv23li…"
                value={clientId}
                onChange={(event) => saveClientId(event.target.value)}
              />
              <span className="hint">
                Register a free GitHub App with read-only repository permissions.{" "}
                <button className="link-button" onClick={() => setShowHelp((v) => !v)}>
                  {showHelp ? "Hide setup instructions" : "How to create one"}
                </button>
              </span>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
            <Button onClick={signIn} disabled={busy}>
              {busy ? "Opening GitHub…" : "Sign in with GitHub"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setShowPat((v) => !v)}
              style={{ color: "var(--text-faint)" }}
            >
              {showPat ? "Hide personal access token" : "Or use a personal access token"}
            </Button>
          </div>

          {showPat ? (
            <div className="field" style={{ marginTop: 14 }}>
              <label htmlFor="pat-input">Personal Access Token (classic or fine-grained)</label>
              <div style={{ display: "flex", gap: 8 }}>
                <Input
                  id="pat-input"
                  data-slot="input"
                  type="password"
                  placeholder="ghp_… or github_pat_…"
                  value={pat}
                  onChange={(event) => setPat(event.target.value)}
                />
                <Button onClick={savePat} disabled={busy || !pat.trim()}>
                  Save token
                </Button>
              </div>
              <span className="hint">
                Needs <code>repo</code> scope (or fine-grained Read-only access to Issues, Pull
                requests, Discussions and Contents).
              </span>
            </div>
          ) : null}

          {showHelp ? <RegistrationHelp onReport={onReport} /> : null}
        </>
      )}

      {error ? <p style={{ color: "var(--danger)", margin: "10px 0 0" }}>{error}</p> : null}

    </section>
  );
}

function RegistrationHelp({ onReport }: { onReport: (err: unknown) => void }) {
  const open = (url: string) => openUrl(url).catch(onReport);

  return (
    <div className="setup-help">
      <div className="setup-option">
        <h4>
          GitHub App <span className="tag service">recommended</span>
        </h4>
        <p>Read-only access to just what the feed shows. Tokens last 8 hours and refresh here.</p>
        <ol>
          <li>
            <button className="link-button" onClick={() => open(NEW_GITHUB_APP)}>
              Open the registration form ↗
            </button>{" "}
            (Settings → Developer settings → GitHub Apps → New GitHub App)
          </li>
          <li>
            <strong>Name</strong>: anything unique across GitHub, e.g. <code>DevHub — yourname</code>.
            <br />
            <strong>Homepage URL</strong>: required, any URL will do.
            <br />
            <strong>Callback URL</strong>: leave blank — the device flow never uses it.
          </li>
          <li>
            Tick <strong>Enable Device Flow</strong>. Without it, signing in fails with
            <code>device_flow_disabled</code>.
          </li>
          <li>
            Under <strong>Webhook</strong>, untick <strong>Active</strong>. DevHub only reads.
          </li>
          <li>
            <strong>Repository permissions</strong>, all <strong>Read-only</strong>:
            <br />
            <code>Contents</code> (releases), <code>Issues</code>, <code>Pull requests</code>,{" "}
            <code>Discussions</code>. <code>Metadata</code> is added for you.
          </li>
          <li>
            Create the app, then — this is the step that is easy to miss —{" "}
            <strong>Install App</strong> in the left sidebar and choose which repositories it can
            see. Without installing it, the token is valid but sees nothing.
          </li>
          <li>
            Copy the <strong>Client ID</strong> from the app's General page (starts with{" "}
            <code>Iv23li</code>) and paste it above.
          </li>
        </ol>
      </div>

      <div className="setup-option">
        <h4>OAuth App</h4>
        <p>Quicker to register and the token never expires, but the scope is all-or-nothing.</p>
        <ol>
          <li>
            <button className="link-button" onClick={() => open(NEW_OAUTH_APP)}>
              Open the registration form ↗
            </button>
          </li>
          <li>
            Fill in a name and homepage URL. <strong>Authorization callback URL</strong> is a
            required field but unused — <code>http://localhost</code> is fine.
          </li>
          <li>
            Register, then on the app's page tick <strong>Enable Device Flow</strong> and update.
          </li>
          <li>
            Copy the <strong>Client ID</strong> (starts with <code>Ov23li</code>).
          </li>
        </ol>
        <p className="setup-caveat">
          Signing in will ask for the <code>repo</code> scope, which covers private repositories
          in full. GitHub's OAuth scopes have no read-only variant — that is the trade, and the
          reason the GitHub App is the better option.
        </p>
      </div>
    </div>
  );
}
