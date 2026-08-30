use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivityType {
    Commit,
    PullRequest,
    Issue,
    Discussion,
    Release,
    Star,
    Fork,
    Publish,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActivityState {
    Open,
    Merged,
    Closed,
    Published,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityItem {
    pub id: String,
    pub repository: String,
    pub project_name: Option<String>,
    pub activity_type: ActivityType,
    pub state: ActivityState,
    pub number: Option<i64>,
    pub title: String,
    pub url: String,
    pub actor: Option<String>,
    pub actor_avatar: Option<String>,
    pub timestamp: DateTime<Utc>,
    pub comment_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<ActivityLabel>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub additions: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deletions: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub changed_files: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub review_decision: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityLabel {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityColumn {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub filters: ColumnFilters,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub read_through: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ColumnFilters {
    pub repositories: Vec<String>,
    pub users: Vec<String>,
    pub types: Vec<ActivityType>,
    pub states: Vec<ActivityState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    pub hide_bots: bool,
}

impl ColumnFilters {
    pub fn matches(&self, item: &ActivityItem) -> bool {
        if !self.repositories.is_empty() && !self.repositories.contains(&item.repository) {
            return false;
        }
        if !self.users.is_empty()
            && !item.actor.as_deref().is_some_and(|actor| {
                self.users
                    .iter()
                    .any(|user| user.eq_ignore_ascii_case(actor))
            })
        {
            return false;
        }
        if !self.types.is_empty() && !self.types.contains(&item.activity_type) {
            return false;
        }
        if !self.states.is_empty() && !self.states.contains(&item.state) {
            return false;
        }
        if self.hide_bots && item.actor.as_deref().is_some_and(is_bot) {
            return false;
        }
        match self
            .query
            .as_deref()
            .map(str::trim)
            .filter(|q| !q.is_empty())
        {
            Some(query) => item.title.to_lowercase().contains(&query.to_lowercase()),
            None => true,
        }
    }
}

fn is_bot(login: &str) -> bool {
    let lower = login.to_ascii_lowercase();
    lower.ends_with("[bot]") || lower.ends_with("-bot") || lower == "dependabot"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedItem {
    #[serde(flatten)]
    pub item: ActivityItem,
    pub saved_at: DateTime<Utc>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(
        repo: &str,
        kind: ActivityType,
        state: ActivityState,
        title: &str,
        actor: &str,
    ) -> ActivityItem {
        ActivityItem {
            id: format!("{repo}#{title}"),
            repository: repo.into(),
            project_name: None,
            activity_type: kind,
            state,
            number: Some(1),
            title: title.into(),
            url: "https://example.test".into(),
            actor: Some(actor.into()),
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

    fn sample() -> ActivityItem {
        item(
            "dayflow-js/calendar",
            ActivityType::PullRequest,
            ActivityState::Merged,
            "Improve event rendering",
            "alice",
        )
    }

    #[test]
    fn empty_filters_match_everything() {
        assert!(ColumnFilters::default().matches(&sample()));
    }

    #[test]
    fn each_filter_narrows_independently() {
        let it = sample();

        let by_repo = ColumnFilters {
            repositories: vec!["dayflow-js/calendar".into()],
            ..Default::default()
        };
        assert!(by_repo.matches(&it));

        let other_repo = ColumnFilters {
            repositories: vec!["dayflow-js/pro".into()],
            ..Default::default()
        };
        assert!(!other_repo.matches(&it));

        let by_user = ColumnFilters {
            users: vec!["ALICE".into()],
            ..Default::default()
        };
        assert!(by_user.matches(&it));

        let by_type = ColumnFilters {
            types: vec![ActivityType::Issue],
            ..Default::default()
        };
        assert!(!by_type.matches(&it));

        let by_state = ColumnFilters {
            states: vec![ActivityState::Merged],
            ..Default::default()
        };
        assert!(by_state.matches(&it));
    }

    #[test]
    fn the_text_query_is_case_insensitive_and_ignores_blanks() {
        let it = sample();

        let matching = ColumnFilters {
            query: Some("EVENT".into()),
            ..Default::default()
        };
        assert!(matching.matches(&it));

        let missing = ColumnFilters {
            query: Some("safari".into()),
            ..Default::default()
        };
        assert!(!missing.matches(&it));

        // A blank query is an empty search box, not a filter that excludes
        // everything.
        for blank in ["", "   "] {
            let filters = ColumnFilters {
                query: Some(blank.into()),
                ..Default::default()
            };
            assert!(
                filters.matches(&it),
                "`{blank}` should not filter anything out"
            );
        }
    }

    #[test]
    fn bot_authors_can_be_hidden() {
        let filters = ColumnFilters {
            hide_bots: true,
            ..Default::default()
        };

        assert!(filters.matches(&sample()), "a human should still show");
        for bot in [
            "dependabot[bot]",
            "renovate[bot]",
            "dependabot",
            "release-bot",
        ] {
            let it = item(
                "r/r",
                ActivityType::PullRequest,
                ActivityState::Open,
                "Bump deps",
                bot,
            );
            assert!(!filters.matches(&it), "`{bot}` should have been hidden");
        }
    }

    /// Filters combine with AND: matching one but not another excludes it.
    #[test]
    fn filters_combine_rather_than_alternate() {
        let it = sample();
        let filters = ColumnFilters {
            repositories: vec!["dayflow-js/calendar".into()],
            types: vec![ActivityType::Issue],
            ..Default::default()
        };
        assert!(
            !filters.matches(&it),
            "the repo matches but the type does not"
        );
    }
}
