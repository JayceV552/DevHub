use std::collections::HashMap;

use crate::models::{ActivityItem, ActivityState, ActivityType};
use super::graphql::{
    build_issue_page_query, build_issue_query, build_query, collect_issue_groups, collect_items,
};
use super::types::{IssueGraphQlResponse, Repository, RestEvent};
use super::{event_item, RepoRef};

fn public_event(kind: &str, payload: serde_json::Value) -> RestEvent {
    serde_json::from_value(serde_json::json!({
        "id": format!("event-{kind}"),
        "type": kind,
        "actor": { "login": "JayceV552", "avatar_url": "https://avatars.example/jayce" },
        "repo": { "name": "JayceV552/DevHub" },
        "payload": payload,
        "created_at": "2026-08-30T10:00:00Z"
    }))
    .expect("valid public event")
}

fn repo(owner: &str, name: &str) -> RepoRef {
    RepoRef {
        owner: owner.into(),
        name: name.into(),
        project_name: Some("DayFlow".into()),
    }
}

#[test]
fn parses_well_formed_slugs_and_rejects_the_rest() {
    let parsed = RepoRef::parse("dayflow-js/calendar", None).expect("valid slug");
    assert_eq!(parsed.owner, "dayflow-js");
    assert_eq!(parsed.name, "calendar");

    for bad in ["", "calendar", "/calendar", "dayflow-js/", "a/b/c"] {
        assert!(
            RepoRef::parse(bad, None).is_none(),
            "`{bad}` should not parse"
        );
    }
}

#[test]
fn public_user_events_include_stars_and_repositories_becoming_public() {
    let star = event_item(public_event(
        "WatchEvent",
        serde_json::json!({ "action": "started" }),
    ))
    .expect("star event");
    assert_eq!(star.activity_type, ActivityType::Star);
    assert_eq!(star.title, "DevHub");
    assert_eq!(star.action.as_deref(), Some("starred this repository"));

    let published =
        event_item(public_event("PublicEvent", serde_json::json!({}))).expect("public event");
    assert_eq!(published.activity_type, ActivityType::Publish);
    assert_eq!(published.title, "DevHub");
    assert_eq!(
        published.action.as_deref(),
        Some("made this repository public")
    );
}

#[test]
fn the_query_asks_for_every_kind_under_one_alias_per_repo() {
    let query = build_query(&[repo("dayflow-js", "calendar"), repo("dayflow-js", "pro")]);

    for alias in ["r0: repository", "r1: repository"] {
        assert!(query.contains(alias), "missing alias in:\n{query}");
    }
    for field in [
        "pullRequests(",
        "openIssues: issues(",
        "closedIssues: issues(",
        "discussions(",
        "history(",
        "releases(",
    ] {
        assert!(query.contains(field), "missing {field} in:\n{query}");
    }
    assert!(query.contains(r#"owner: "dayflow-js""#));
    assert!(query.contains(r#"name: "calendar""#));
}

#[test]
fn the_todo_query_only_requests_latest_open_issues() {
    let query = build_issue_query(&[repo("dayflow-js", "calendar"), repo("dayflow-js", "pro")]);

    assert!(query.contains("r0: repository"));
    assert!(query.contains("r1: repository"));
    assert!(query.contains("states: OPEN"));
    assert!(query.contains("field: UPDATED_AT, direction: DESC"));
    assert!(!query.contains("pullRequests("));
    assert!(!query.contains("discussions("));
    assert!(!query.contains("releases("));
    assert!(query.contains("totalCount"));
    assert!(query.contains("pageInfo"));
}

#[test]
fn issue_page_cursors_cannot_break_out_of_the_query() {
    let query = build_issue_page_query(
        &repo("shadcn-ui", "ui"),
        Some("cursor\", states: CLOSED) { id } #"),
    );
    assert!(query.contains("first: 30"));
    assert!(query.contains(r#"after: "cursor\""#));
    assert!(!query.contains(r#"after: "cursor", states: CLOSED"#));
}

#[test]
fn issue_groups_keep_the_total_and_pagination_cursor() {
    let body: IssueGraphQlResponse = serde_json::from_value(serde_json::json!({
        "data": {
            "r0": {
                "nameWithOwner": "shadcn-ui/ui",
                "issues": {
                    "totalCount": 912,
                    "pageInfo": { "endCursor": "next-page", "hasNextPage": true },
                    "nodes": [{
                        "number": 123,
                        "title": "A popular issue",
                        "bodyText": null,
                        "url": "https://github.com/shadcn-ui/ui/issues/123",
                        "state": "OPEN",
                        "updatedAt": "2026-08-30T10:00:00Z",
                        "labels": { "nodes": [] },
                        "comments": { "totalCount": 2 },
                        "author": null
                    }]
                }
            }
        }
    }))
    .expect("valid response");
    let groups = collect_issue_groups(body.data.unwrap(), &[repo("shadcn-ui", "ui")]);
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].total_count, 912);
    assert_eq!(groups[0].end_cursor.as_deref(), Some("next-page"));
    assert!(groups[0].has_next_page);
    assert_eq!(groups[0].issues[0].number, Some(123));
}

/// A repository name is user-supplied config. It must be encoded, not
/// pasted, or a quote in it would break out of the GraphQL string.
#[test]
fn repository_names_cannot_break_out_of_the_query() {
    let query = build_query(&[repo("evil\", name: \"x\") { id } #", "y")]);
    assert!(
        !query.contains(r#"owner: "evil", name:"#),
        "injection succeeded:\n{query}"
    );
    assert!(
        query.contains(r#"\""#),
        "the quote should have been escaped"
    );
}

fn sample_response() -> HashMap<String, Option<Repository>> {
    let json = serde_json::json!({
        "r0": {
            "nameWithOwner": "dayflow-js/calendar",
            "defaultBranchRef": { "target": { "history": { "nodes": [
                { "oid": "abc123", "messageHeadline": "Update calendar feed", "url": "https://github.com/x/commit/abc123",
                  "committedDate": "2026-08-28T12:00:00Z",
                  "author": { "user": { "login": "jayce", "avatarUrl": "https://avatars.githubusercontent.com/u/1" } } }
            ] } } },
            "pullRequests": { "nodes": [
                { "number": 281, "title": "Improve event rendering", "url": "https://github.com/x/281",
                  "state": "MERGED", "createdAt": "2026-08-20T10:00:00Z", "updatedAt": "2026-08-25T10:00:00Z",
                  "mergedAt": "2026-08-25T09:00:00Z", "comments": {"totalCount": 4},
                  "author": {"login": "alice", "avatarUrl": "https://a"} },
                { "number": 282, "title": "WIP", "url": "https://github.com/x/282",
                  "state": "OPEN", "createdAt": "2026-08-26T10:00:00Z", "updatedAt": "2026-08-26T10:00:00Z",
                  "mergedAt": null, "comments": {"totalCount": 0}, "author": null }
            ]},
            "openIssues": { "nodes": [
                { "number": 279, "title": "Drag broken on Safari", "url": "https://github.com/x/279",
                  "state": "OPEN", "createdAt": "2026-08-27T10:00:00Z", "updatedAt": "2026-08-27T12:00:00Z",
                  "comments": {"totalCount": 2}, "author": {"login": "bob", "avatarUrl": null} }
            ]},
            "closedIssues": { "nodes": [
                { "number": 278, "title": "Old rendering bug", "url": "https://github.com/x/278",
                  "state": "CLOSED", "createdAt": "2026-08-21T10:00:00Z", "updatedAt": "2026-08-22T12:00:00Z",
                  "comments": {"totalCount": 1}, "author": {"login": "dana", "avatarUrl": null} }
            ]},
            "discussions": { "nodes": [
                { "number": 63, "title": "Custom recurring events?", "url": "https://github.com/x/63",
                  "createdAt": "2026-08-24T10:00:00Z", "updatedAt": "2026-08-28T10:00:00Z",
                  "comments": {"totalCount": 3}, "author": {"login": "carol", "avatarUrl": null} }
            ]},
            "releases": { "nodes": [
                { "name": "v1.8.2", "tagName": "v1.8.2", "url": "https://github.com/x/r",
                  "publishedAt": "2026-08-23T10:00:00Z", "author": {"login": "alice", "avatarUrl": null} },
                { "name": null, "tagName": "v1.9.0-draft", "url": "https://github.com/x/d",
                  "publishedAt": null, "author": null }
            ]}
        }
    });
    serde_json::from_value(json).expect("fixture should deserialize")
}

#[test]
fn every_kind_becomes_an_activity_item() {
    let items = collect_items(sample_response(), &[repo("dayflow-js", "calendar")]);

    // 1 commit + 2 PRs + 2 issues + 1 discussion + 1 published release. The draft
    // release has no publish date and has not happened yet.
    assert_eq!(items.len(), 7, "got {items:#?}");

    let commit = items
        .iter()
        .find(|i| i.activity_type == ActivityType::Commit)
        .expect("commit");
    assert_eq!(commit.actor.as_deref(), Some("jayce"));
    assert!(
        commit
            .actor_avatar
            .as_deref()
            .is_some_and(|url| url.contains("avatars.githubusercontent.com"))
    );

    let merged = items
        .iter()
        .find(|i| i.number == Some(281))
        .expect("PR 281");
    assert_eq!(merged.activity_type, ActivityType::PullRequest);
    assert_eq!(merged.state, ActivityState::Merged);
    // A merged PR is timestamped by its merge, not its last edit.
    assert_eq!(merged.timestamp.to_rfc3339(), "2026-08-25T09:00:00+00:00");
    assert_eq!(merged.actor.as_deref(), Some("alice"));
    assert_eq!(merged.project_name.as_deref(), Some("DayFlow"));

    let open = items
        .iter()
        .find(|i| i.number == Some(282))
        .expect("PR 282");
    assert_eq!(open.state, ActivityState::Open);
    // A deleted account comes back as a null author; it must not be fatal.
    assert_eq!(open.actor, None);

    let closed_issue = items
        .iter()
        .find(|item| item.number == Some(278))
        .expect("closed issue 278");
    assert_eq!(closed_issue.activity_type, ActivityType::Issue);
    assert_eq!(closed_issue.state, ActivityState::Closed);

    let release = items
        .iter()
        .find(|i| i.activity_type == ActivityType::Release)
        .expect("release");
    assert_eq!(release.title, "v1.8.2");
    assert!(
        !items.iter().any(|i| i.title.contains("draft")),
        "a draft release should not be in the feed",
    );

    let discussion = items
        .iter()
        .find(|i| i.activity_type == ActivityType::Discussion)
        .expect("discussion");
    assert_eq!(discussion.comment_count, Some(3));
}

/// The feed's whole purpose is one timeline across kinds and repos.
#[test]
fn items_are_merged_into_one_timeline() {
    let mut items = collect_items(sample_response(), &[repo("dayflow-js", "calendar")]);
    items.sort_by_key(|item| std::cmp::Reverse(item.timestamp));

    let order: Vec<&str> = items
        .iter()
        .map(|i| match i.activity_type {
            ActivityType::Commit => "commit",
            ActivityType::PullRequest => "pr",
            ActivityType::Issue => "issue",
            ActivityType::Discussion => "discussion",
            ActivityType::Release => "release",
            ActivityType::Star => "star",
            ActivityType::Fork => "fork",
            ActivityType::Publish => "publish",
        })
        .collect();

    assert_eq!(
        order,
        [
            "commit",
            "discussion",
            "issue",
            "pr",
            "pr",
            "release",
            "issue"
        ]
    );
}

/// A repo the token cannot see comes back as `null` rather than an error.
/// The rest of the feed still has to work.
#[test]
fn an_inaccessible_repository_is_skipped_not_fatal() {
    let mut data = sample_response();
    data.insert("r1".to_string(), None);

    let items = collect_items(
        data,
        &[repo("dayflow-js", "calendar"), repo("private", "repo")],
    );
    assert_eq!(items.len(), 7, "the visible repo's items should survive");
}

#[test]
fn ids_are_stable_across_fetches() {
    let first = collect_items(sample_response(), &[repo("dayflow-js", "calendar")]);
    let second = collect_items(sample_response(), &[repo("dayflow-js", "calendar")]);

    let ids = |items: &[ActivityItem]| -> Vec<String> {
        items.iter().map(|i| i.id.clone()).collect()
    };
    assert_eq!(ids(&first), ids(&second));
    assert!(first.iter().any(|i| i.id == "dayflow-js/calendar#pr281"));
}
