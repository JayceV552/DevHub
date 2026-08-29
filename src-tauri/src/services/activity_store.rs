use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::models::{ActivityItem, ColumnFilters, SavedItem};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct SavedState {
    #[serde(default)]
    items: Vec<SavedItem>,
}

const MAX_SAVED: usize = 500;

pub struct ActivityStore {
    path: PathBuf,
    state: Mutex<SavedState>,
}

impl ActivityStore {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join("saved.json");
        let state = std::fs::read_to_string(&path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default();

        Self {
            path,
            state: Mutex::new(state),
        }
    }

    pub fn list(&self) -> Vec<SavedItem> {
        self.state.lock().unwrap().items.clone()
    }

    pub fn save(&self, item: ActivityItem) -> Result<()> {
        {
            let mut state = self.state.lock().unwrap();
            state.items.retain(|saved| saved.item.id != item.id);
            state.items.insert(
                0,
                SavedItem {
                    item,
                    saved_at: Utc::now(),
                },
            );
            state.items.truncate(MAX_SAVED);
        }
        self.persist()
    }

    pub fn unsave(&self, id: &str) -> Result<()> {
        self.state
            .lock()
            .unwrap()
            .items
            .retain(|saved| saved.item.id != id);
        self.persist()
    }

    fn persist(&self) -> Result<()> {
        let text = {
            let state = self.state.lock().unwrap();
            serde_json::to_string_pretty(&*state)
                .map_err(|err| Error::Other(format!("could not encode saved items: {err}")))?
        };
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, text)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }
}

pub fn default_columns(repositories: &[String]) -> Vec<crate::models::ActivityColumn> {
    use crate::models::ActivityColumn;

    let mut columns = vec![ActivityColumn {
        id: "dashboard".into(),
        title: "Dashboard".into(),
        filters: ColumnFilters::default(),
        read_through: None,
    }];

    for repo in repositories {
        columns.push(repository_column(repo));
    }

    columns
}

pub fn repository_column(repo: &str) -> crate::models::ActivityColumn {
    crate::models::ActivityColumn {
        id: format!("repo-{}", repo.replace('/', "-")),
        title: repo.rsplit('/').next().unwrap_or(repo).to_string(),
        filters: ColumnFilters {
            repositories: vec![repo.to_string()],
            ..Default::default()
        },
        read_through: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{ActivityState, ActivityType};

    fn item(id: &str) -> ActivityItem {
        ActivityItem {
            id: id.into(),
            repository: "a/b".into(),
            project_name: None,
            activity_type: ActivityType::Issue,
            state: ActivityState::Open,
            number: Some(1),
            title: "Title".into(),
            url: "https://example.test".into(),
            actor: None,
            actor_avatar: None,
            timestamp: Utc::now(),
            comment_count: None,
            body: None,
            labels: Vec::new(),
            additions: None,
            deletions: None,
            changed_files: None,
            review_decision: None,
            action: None,
        }
    }

    #[test]
    fn saving_reading_and_unsaving() {
        let dir = tempfile::tempdir().unwrap();
        let store = ActivityStore::load(dir.path());

        assert!(store.list().is_empty());

        store.save(item("x")).unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].item.id, "x");

        store.unsave("x").unwrap();
        assert!(store.list().is_empty());
    }

    /// Saving something twice must not duplicate it — the item is the same one
    /// the user already kept.
    #[test]
    fn saving_twice_moves_it_to_the_top_rather_than_duplicating() {
        let dir = tempfile::tempdir().unwrap();
        let store = ActivityStore::load(dir.path());

        store.save(item("a")).unwrap();
        store.save(item("b")).unwrap();
        store.save(item("a")).unwrap();

        let saved = store.list();
        assert_eq!(saved.len(), 2);
        assert_eq!(
            saved[0].item.id, "a",
            "re-saving should move it to the front"
        );
    }

    #[test]
    fn saved_items_survive_a_reload() {
        let dir = tempfile::tempdir().unwrap();
        ActivityStore::load(dir.path()).save(item("keep")).unwrap();

        let reloaded = ActivityStore::load(dir.path());
        assert_eq!(reloaded.list().len(), 1);
        // The whole item is stored, not just its id: a saved thing has to keep
        // working after it drops out of the API's recent window.
        assert_eq!(reloaded.list()[0].item.title, "Title");
        assert_eq!(reloaded.list()[0].item.url, "https://example.test");
    }

    #[test]
    fn a_corrupt_file_loads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("saved.json"), "{{{not json").unwrap();
        assert!(ActivityStore::load(dir.path()).list().is_empty());
    }

    #[test]
    fn default_columns_start_with_dashboard() {
        let columns = default_columns(&[]);
        let ids: Vec<&str> = columns.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["dashboard"]);
    }

    #[test]
    fn a_couple_of_repositories_get_their_own_columns() {
        let repos = vec!["dayflow-js/calendar".into(), "dayflow-js/pro".into()];
        let columns = default_columns(&repos);

        assert_eq!(columns.len(), 3);
        let calendar = columns
            .iter()
            .find(|c| c.title == "calendar")
            .expect("repo column");
        assert_eq!(calendar.filters.repositories, vec!["dayflow-js/calendar"]);

        assert_eq!(default_columns(&["only/one".into()]).len(), 2);
        let many: Vec<String> = (0..9).map(|n| format!("org/repo{n}")).collect();
        assert_eq!(default_columns(&many).len(), 10);
    }
}
