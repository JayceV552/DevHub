use devhub_lib::testing::{ActivityColumn, ActivityState, ActivityType, ColumnFilters, Config};

fn column() -> ActivityColumn {
    ActivityColumn {
        id: "pull-requests".into(),
        title: "Pull requests".into(),
        filters: ColumnFilters {
            repositories: vec!["dayflow-js/calendar".into()],
            users: vec!["jayce".into()],
            types: vec![ActivityType::PullRequest, ActivityType::Issue],
            states: vec![ActivityState::Open, ActivityState::Merged],
            query: Some("safari".into()),
            hide_bots: true,
        },
        read_through: Some(chrono::Utc::now()),
    }
}

#[test]
fn a_column_survives_being_written_to_and_read_from_toml() {
    let config = Config {
        columns: vec![column()],
        ..Default::default()
    };

    let text = toml::to_string_pretty(&config).expect("columns must be serializable to TOML");
    let parsed: Config = toml::from_str(&text).expect("and readable again");

    assert_eq!(parsed.columns.len(), 1);
    let read = &parsed.columns[0];
    assert_eq!(read.id, "pull-requests");
    assert_eq!(read.title, "Pull requests");
    assert_eq!(read.filters.repositories, vec!["dayflow-js/calendar"]);
    assert_eq!(read.filters.users, vec!["jayce"]);
    assert_eq!(
        read.filters.types,
        vec![ActivityType::PullRequest, ActivityType::Issue]
    );
    assert_eq!(
        read.filters.states,
        vec![ActivityState::Open, ActivityState::Merged]
    );
    assert_eq!(read.filters.query.as_deref(), Some("safari"));
    assert!(read.filters.hide_bots);
    assert!(
        read.read_through.is_some(),
        "the read marker must not be lost"
    );
}

#[test]
fn a_column_with_default_filters_round_trips() {
    let config = Config {
        columns: vec![ActivityColumn {
            id: "all".into(),
            title: "All activity".into(),
            filters: ColumnFilters::default(),
            read_through: None,
        }],
        ..Default::default()
    };

    let text = toml::to_string_pretty(&config).expect("serialize");
    let parsed: Config = toml::from_str(&text).expect("parse");
    assert_eq!(parsed.columns.len(), 1);
    assert!(parsed.columns[0].filters.repositories.is_empty());
    assert!(parsed.columns[0].read_through.is_none());
}

#[test]
fn a_whole_config_with_columns_round_trips() {
    let mut columns = devhub_lib::testing::default_columns();
    columns.push(devhub_lib::testing::repository_column("dayflow-js/calendar"));
    columns.push(devhub_lib::testing::repository_column("dayflow-js/pro"));

    let config = Config {
        columns,
        ..Default::default()
    };

    let text = toml::to_string_pretty(&config).expect("serialize");
    let parsed: Config = toml::from_str(&text).expect("parse");
    assert_eq!(parsed.columns.len(), config.columns.len());
    assert_eq!(parsed.columns[0].id, "dashboard");
}

#[test]
fn a_config_without_columns_still_loads() {
    let legacy = r#"
[settings]
theme = "dark"
output_buffer_lines = 5000
stop_grace_seconds = 5
hide_system_ports = true

[[projects]]
id = "dayflow"
name = "DayFlow"
path = "/tmp"
"#;
    let parsed: Config = toml::from_str(legacy).expect("legacy config must still parse");
    assert!(parsed.columns.is_empty());
    assert_eq!(parsed.projects.len(), 1);
}
