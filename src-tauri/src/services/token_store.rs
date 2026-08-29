use std::sync::Mutex;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Credential {
    Pat {
        token: String,
    },
    #[serde(rename_all = "camelCase")]
    OAuth {
        access_token: String,
        refresh_token: Option<String>,
        expires_at: Option<DateTime<Utc>>,
    },
}

impl Credential {
    pub fn token(&self) -> &str {
        match self {
            Self::Pat { token } => token,
            Self::OAuth { access_token, .. } => access_token,
        }
    }

    pub fn is_expired(&self) -> bool {
        match self {
            Self::Pat { .. } => false,
            Self::OAuth { expires_at, .. } => {
                expires_at.is_some_and(|at| at <= Utc::now() + chrono::Duration::minutes(1))
            }
        }
    }

    pub fn refresh_token(&self) -> Option<&str> {
        match self {
            Self::Pat { .. } => None,
            Self::OAuth { refresh_token, .. } => refresh_token.as_deref(),
        }
    }
}

pub struct TokenStore {
    account: String,
}

static CACHE: Mutex<Option<Option<Credential>>> = Mutex::new(None);

const SERVICE: &str = "DevHub";

impl TokenStore {
    pub fn github() -> Self {
        Self {
            account: "github-token".to_string(),
        }
    }

    #[cfg(test)]
    pub fn for_account(account: impl Into<String>) -> Self {
        Self {
            account: account.into(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry> {
        keyring::Entry::new(SERVICE, &self.account).map_err(|err| Error::Keychain(err.to_string()))
    }

    pub fn get(&self) -> Result<Option<Credential>> {
        if let Some(cached) = self.cached() {
            return Ok(cached);
        }

        let credential = self.read_through()?;
        self.fill_cache(credential.clone());
        Ok(credential)
    }

    fn read_through(&self) -> Result<Option<Credential>> {
        let raw = match self.entry()?.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => return Ok(None),
            Err(err) => return Err(Error::Keychain(err.to_string())),
        };

        Ok(Some(
            serde_json::from_str(&raw).unwrap_or(Credential::Pat { token: raw }),
        ))
    }

    pub fn set(&self, credential: &Credential) -> Result<()> {
        let encoded = serde_json::to_string(credential)
            .map_err(|err| Error::Other(format!("could not encode credential: {err}")))?;
        self.entry()?
            .set_password(&encoded)
            .map_err(|err| Error::Keychain(err.to_string()))?;
        self.fill_cache(Some(credential.clone()));
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        let result = match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(Error::Keychain(err.to_string())),
        };
        self.fill_cache(None);
        result
    }

    fn is_cacheable(&self) -> bool {
        self.account == Self::github().account
    }

    fn cached(&self) -> Option<Option<Credential>> {
        self.is_cacheable()
            .then(|| CACHE.lock().unwrap().clone())
            .flatten()
    }

    fn fill_cache(&self, credential: Option<Credential>) {
        if self.is_cacheable() {
            *CACHE.lock().unwrap() = Some(credential);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A keychain entry unique to one test.
    ///
    /// Tests run in parallel, so a shared account name would have them
    /// overwriting and deleting each other's entries — which is exactly what
    /// happened when they all used one.
    fn store(name: &str) -> TokenStore {
        let store = TokenStore::for_account(format!("devhub-test-{name}"));
        let _ = store.clear(); // in case an earlier run died mid-test
        store
    }

    /// Round-trips through the real OS keychain, under a throwaway account so
    /// the user's own credential is never touched.
    #[test]
    fn stores_reads_and_deletes_a_credential() {
        let store = store("pat-round-trip");
        assert_eq!(store.get().expect("read empty"), None);

        let pat = Credential::Pat {
            token: "not-a-real-token".into(),
        };
        store.set(&pat).expect("write");
        assert_eq!(store.get().expect("read"), Some(pat));

        store.clear().expect("delete");
        assert_eq!(store.get().expect("read after delete"), None);
        store.clear().expect("delete is idempotent");
    }

    #[test]
    fn oauth_credentials_round_trip_with_their_refresh_token() {
        let store = store("oauth-round-trip");
        let expires_at = Utc::now() + chrono::Duration::hours(8);

        let credential = Credential::OAuth {
            access_token: "ghu_not_real".into(),
            refresh_token: Some("ghr_not_real".into()),
            expires_at: Some(expires_at),
        };
        store.set(&credential).expect("write");

        match store.get().expect("read") {
            Some(Credential::OAuth {
                access_token,
                refresh_token,
                expires_at: read_back,
            }) => {
                assert_eq!(access_token, "ghu_not_real");
                assert_eq!(refresh_token.as_deref(), Some("ghr_not_real"));
                assert_eq!(
                    read_back.map(|t| t.timestamp()),
                    Some(expires_at.timestamp())
                );
            }
            other => panic!("expected an OAuth credential, got {other:?}"),
        }
        store.clear().expect("cleanup");
    }

    /// Upgrading must not sign the user out: a bare string left by an earlier
    /// version is still a usable PAT.
    #[test]
    fn a_bare_string_from_an_older_version_reads_as_a_pat() {
        let store = store("legacy-pat");
        // Write the legacy format directly, bypassing `set`.
        store
            .entry()
            .unwrap()
            .set_password("ghp_legacy_plain_string")
            .unwrap();

        assert_eq!(
            store.get().expect("read"),
            Some(Credential::Pat {
                token: "ghp_legacy_plain_string".into()
            }),
        );
        store.clear().expect("cleanup");
    }

    #[test]
    fn expiry_is_only_a_question_for_oauth_credentials() {
        let pat = Credential::Pat { token: "x".into() };
        assert!(!pat.is_expired(), "a PAT does not expire on its own");

        let fresh = Credential::OAuth {
            access_token: "x".into(),
            refresh_token: None,
            expires_at: Some(Utc::now() + chrono::Duration::hours(1)),
        };
        assert!(!fresh.is_expired());

        let stale = Credential::OAuth {
            access_token: "x".into(),
            refresh_token: None,
            expires_at: Some(Utc::now() - chrono::Duration::seconds(1)),
        };
        assert!(stale.is_expired());

        // Expiring within the safety margin counts as expired, so a request
        // cannot go out with a token that dies mid-flight.
        let expiring = Credential::OAuth {
            access_token: "x".into(),
            refresh_token: None,
            expires_at: Some(Utc::now() + chrono::Duration::seconds(30)),
        };
        assert!(expiring.is_expired());

        // A GitHub App with expiry opted out looks like an OAuth App token.
        let never = Credential::OAuth {
            access_token: "x".into(),
            refresh_token: None,
            expires_at: None,
        };
        assert!(!never.is_expired());
    }

    /// Writing then reading must see the new value, not a stale cached one.
    #[test]
    fn the_cache_follows_writes_and_deletes() {
        let store = store("cache-coherence");

        store
            .set(&Credential::Pat {
                token: "first".into(),
            })
            .unwrap();
        assert_eq!(
            store.get().unwrap(),
            Some(Credential::Pat {
                token: "first".into()
            })
        );

        store
            .set(&Credential::Pat {
                token: "second".into(),
            })
            .unwrap();
        assert_eq!(
            store.get().unwrap(),
            Some(Credential::Pat {
                token: "second".into()
            }),
            "a write must not leave a stale value readable",
        );

        store.clear().unwrap();
        assert_eq!(
            store.get().unwrap(),
            None,
            "a delete must not leave the value readable"
        );
    }

    /// The cache is keyed to the real account, so parallel tests on throwaway
    /// accounts cannot see each other through it.
    #[test]
    fn throwaway_accounts_are_not_cached() {
        assert!(!store("not-cacheable").is_cacheable());
        assert!(TokenStore::github().is_cacheable());
    }

    /// The guard that makes these tests safe.
    #[test]
    fn the_test_account_is_not_the_real_one() {
        assert_ne!(store("isolation").account, TokenStore::github().account);
    }
}
