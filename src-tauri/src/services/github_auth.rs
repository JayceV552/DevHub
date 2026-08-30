use std::sync::Mutex;
use std::time::Duration;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::services::Credential;

const OAUTH_SCOPES: &str = "repo read:discussion";

const BUNDLED_CLIENT_ID: &str = "Iv23li0lwj90ucrllH19";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ClientIdSource {
    User,
    Bundled,
}

pub fn resolve_client_id(configured: Option<&str>) -> Option<(String, ClientIdSource)> {
    let clean = |value: &str| {
        let trimmed = value.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    };

    if let Some(id) = configured.and_then(clean) {
        return Some((id, ClientIdSource::User));
    }
    option_env!("DEVHUB_GITHUB_CLIENT_ID")
        .and_then(clean)
        .or_else(|| clean(BUNDLED_CLIENT_ID))
        .map(|id| (id, ClientIdSource::Bundled))
}

pub fn has_bundled_client_id() -> bool {
    resolve_client_id(None).is_some()
}

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

pub struct DeviceFlow {
    http: reqwest::Client,
    pending: Mutex<Option<PendingLogin>>,
}

#[derive(Clone)]
struct PendingLogin {
    device_code: String,
    interval: u64,
    generation: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogin {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum LoginOutcome {
    Authorized,
    Denied,
    Expired,
    Cancelled,
    Failed { message: String },
}

impl DeviceFlow {
    pub fn new(http: reqwest::Client) -> Self {
        Self {
            http,
            pending: Mutex::new(None),
        }
    }

    pub async fn start(&self, client_id: &str) -> Result<DeviceLogin> {
        let response = self
            .http
            .post(DEVICE_CODE_URL)
            .header("Accept", "application/json")
            .form(&[("client_id", client_id), ("scope", OAUTH_SCOPES)])
            .send()
            .await
            .map_err(|err| Error::GitHub(err.to_string()))?;

        let body: DeviceCodeResponse = response
            .json()
            .await
            .map_err(|err| Error::GitHub(format!("unexpected response: {err}")))?;

        if let Some(error) = body.error {
            return Err(Error::GitHub(describe(&error)));
        }
        let (device_code, user_code, verification_uri) =
            match (body.device_code, body.user_code, body.verification_uri) {
                (Some(d), Some(u), Some(v)) => (d, u, v),
                _ => return Err(Error::GitHub("incomplete device code response".into())),
            };

        let generation = {
            let mut pending = self.pending.lock().unwrap();
            let generation = pending.as_ref().map_or(0, |p| p.generation) + 1;
            *pending = Some(PendingLogin {
                device_code,
                interval: body.interval.unwrap_or(5).max(1),
                generation,
            });
            generation
        };
        let _ = generation;

        Ok(DeviceLogin {
            user_code,
            verification_uri,
            expires_in: body.expires_in.unwrap_or(900),
        })
    }

    pub async fn wait(&self, client_id: &str) -> Result<Credential> {
        let Some(login) = self.pending.lock().unwrap().clone() else {
            return Err(Error::Other("no login in progress".into()));
        };
        let generation = login.generation;
        let mut interval = Duration::from_secs(login.interval);

        loop {
            tokio::time::sleep(interval).await;

            let still_current = self
                .pending
                .lock()
                .unwrap()
                .as_ref()
                .is_some_and(|p| p.generation == generation);
            if !still_current {
                return Err(Error::Other("login cancelled".into()));
            }

            let body = self.redeem(client_id, &login.device_code).await?;

            match body.error.as_deref() {
                Some("authorization_pending") => continue,
                Some("slow_down") => {
                    interval += Duration::from_secs(5);
                    continue;
                }
                Some(other) => {
                    self.clear();
                    return Err(Error::GitHub(describe(other)));
                }
                None => {}
            }

            let Some(access_token) = body.access_token else {
                self.clear();
                return Err(Error::GitHub("no access token in response".into()));
            };

            self.clear();
            return Ok(Credential::OAuth {
                access_token,
                refresh_token: body.refresh_token,
                expires_at: body
                    .expires_in
                    .map(|seconds| Utc::now() + chrono::Duration::seconds(seconds as i64)),
            });
        }
    }

    pub async fn refresh(&self, client_id: &str, refresh_token: &str) -> Result<Credential> {
        let response = self
            .http
            .post(ACCESS_TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id),
                ("grant_type", "refresh_token"),
                ("refresh_token", refresh_token),
            ])
            .send()
            .await
            .map_err(|err| Error::GitHub(err.to_string()))?;

        let body: AccessTokenResponse = response
            .json()
            .await
            .map_err(|err| Error::GitHub(format!("unexpected response: {err}")))?;

        if let Some(error) = body.error {
            return match error.as_str() {
                "incorrect_client_credentials" | "bad_refresh_token" | "expired_token" => {
                    Err(Error::GitHubUnauthorized)
                }
                _ => Err(Error::GitHub(describe(&error))),
            };
        }
        let access_token = body
            .access_token
            .ok_or_else(|| Error::GitHub("no access token in refresh response".into()))?;

        Ok(Credential::OAuth {
            access_token,
            refresh_token: body.refresh_token,
            expires_at: body
                .expires_in
                .map(|seconds| Utc::now() + chrono::Duration::seconds(seconds as i64)),
        })
    }

    async fn redeem(&self, client_id: &str, device_code: &str) -> Result<AccessTokenResponse> {
        self.http
            .post(ACCESS_TOKEN_URL)
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id),
                ("device_code", device_code),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|err| Error::GitHub(err.to_string()))?
            .json()
            .await
            .map_err(|err| Error::GitHub(format!("unexpected response: {err}")))
    }

    pub fn cancel(&self) {
        self.clear();
    }

    fn clear(&self) {
        if let Some(pending) = self.pending.lock().unwrap().as_mut() {
            pending.generation += 1;
            pending.device_code.clear();
        }
    }

    pub fn is_pending(&self) -> bool {
        self.pending
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|p| !p.device_code.is_empty())
    }
}

pub fn describe(code: &str) -> String {
    match code {
        "device_flow_disabled" => {
            "Device flow is not enabled for this app. Turn on “Enable Device Flow” in the app's \
             settings on GitHub."
                .into()
        }
        "Not Found" | "not_found" | "incorrect_client_credentials" => {
            "GitHub does not recognise this client ID. Check it against your app's settings — and \
             note that a GitHub App and an OAuth App have different IDs."
                .into()
        }
        "access_denied" => "Authorization was declined.".into(),
        "expired_token" => "The code expired before it was entered. Try signing in again.".into(),
        "unsupported_grant_type" | "incorrect_device_code" => {
            format!("GitHub rejected the request ({code}). Try signing in again.")
        }
        other => format!("GitHub returned `{other}`."),
    }
}

// ── Response shapes ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct DeviceCodeResponse {
    device_code: Option<String>,
    user_code: Option<String>,
    verification_uri: Option<String>,
    expires_in: Option<u64>,
    interval: Option<u64>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct AccessTokenResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_user_configured_client_id_wins_over_the_bundled_one() {
        let (id, source) = resolve_client_id(Some("Iv23li_users_own")).expect("should resolve");
        assert_eq!(id, "Iv23li_users_own");
        assert_eq!(source, ClientIdSource::User);
    }

    #[test]
    fn a_blank_configured_id_falls_through_rather_than_blocking_sign_in() {
        // An empty or whitespace-only setting is what a cleared input box
        // leaves behind; it must not count as a configured value.
        for blank in [Some(""), Some("   "), None] {
            // With a bundled ID present, blanks fall through to it; without
            // one, there is simply nothing to sign in with. Either way the
            // blank must never be treated as a configured value.
            if let Some((_, source)) = resolve_client_id(blank) {
                assert_eq!(source, ClientIdSource::Bundled);
            }
        }
    }

    /// Documents the state of this build. The repository ships without an ID,
    /// so users register their own; a published build sets one and this flips.
    #[test]
    fn the_bundled_id_is_either_absent_or_usable() {
        match resolve_client_id(None) {
            None => assert!(
                BUNDLED_CLIENT_ID.trim().is_empty()
                    && option_env!("DEVHUB_GITHUB_CLIENT_ID").is_none_or(|id| id.trim().is_empty()),
                "nothing resolved, so neither source should hold a value",
            ),
            Some((id, source)) => {
                assert_eq!(source, ClientIdSource::Bundled);
                assert!(!id.trim().is_empty(), "a bundled ID must not be blank");
            }
        }
    }

    #[test]
    fn error_codes_become_actionable_messages() {
        // The two that actually happen during setup must say what to fix.
        assert!(describe("device_flow_disabled").contains("Enable Device Flow"));
        assert!(describe("incorrect_client_credentials").contains("client ID"));

        // What the live endpoint really returns for an unknown client ID —
        // verified against GitHub, and not the code the docs list.
        assert!(
            describe("Not Found").contains("client ID"),
            "an unknown client ID must not surface as a bare `Not Found`",
        );

        // Anything unrecognised still surfaces the raw code.
        assert!(describe("some_new_code").contains("some_new_code"));
    }

    /// The shape GitHub actually returns when the client ID is unknown: a JSON
    /// body with only an `error` field. Deserialization must survive every
    /// other field being absent.
    #[test]
    fn an_error_only_response_still_deserializes() {
        let body: DeviceCodeResponse =
            serde_json::from_str(r#"{"error": "Not Found"}"#).expect("should deserialize");
        assert_eq!(body.error.as_deref(), Some("Not Found"));
        assert!(body.device_code.is_none());
        assert!(body.user_code.is_none());

        let token: AccessTokenResponse =
            serde_json::from_str(r#"{"error": "authorization_pending"}"#)
                .expect("should deserialize");
        assert_eq!(token.error.as_deref(), Some("authorization_pending"));
        assert!(token.access_token.is_none());
    }

    /// An OAuth App returns no lifetime; a GitHub App returns one plus a
    /// refresh token. Both must parse.
    #[test]
    fn both_app_types_token_responses_parse() {
        let oauth_app: AccessTokenResponse = serde_json::from_str(
            r#"{"access_token":"gho_x","token_type":"bearer","scope":"repo"}"#,
        )
        .expect("oauth app response");
        assert_eq!(oauth_app.access_token.as_deref(), Some("gho_x"));
        assert!(
            oauth_app.expires_in.is_none(),
            "an OAuth App token does not expire"
        );
        assert!(oauth_app.refresh_token.is_none());

        let github_app: AccessTokenResponse = serde_json::from_str(
            r#"{"access_token":"ghu_x","expires_in":28800,"refresh_token":"ghr_x",
                "refresh_token_expires_in":15811200,"token_type":"bearer","scope":""}"#,
        )
        .expect("github app response");
        assert_eq!(github_app.expires_in, Some(28_800));
        assert_eq!(github_app.refresh_token.as_deref(), Some("ghr_x"));
    }

    #[test]
    fn an_oauth_app_token_never_expires_and_a_github_app_token_does() {
        // No `expires_in` in the response -> no expiry recorded.
        let oauth_app = Credential::OAuth {
            access_token: "x".into(),
            refresh_token: None,
            expires_at: None,
        };
        assert!(!oauth_app.is_expired());
        assert_eq!(oauth_app.refresh_token(), None);

        let github_app = Credential::OAuth {
            access_token: "x".into(),
            refresh_token: Some("r".into()),
            expires_at: Some(Utc::now() + chrono::Duration::hours(8)),
        };
        assert!(!github_app.is_expired());
        assert_eq!(github_app.refresh_token(), Some("r"));
    }
}
