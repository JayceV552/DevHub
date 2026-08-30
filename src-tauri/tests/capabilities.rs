use serde_json::Value;

fn opener_scope() -> Vec<glob::Pattern> {
    let raw = std::fs::read_to_string("capabilities/default.json").expect("capability file");
    let json: Value = serde_json::from_str(&raw).expect("valid JSON");

    json["permissions"]
        .as_array()
        .expect("permissions array")
        .iter()
        .filter(|entry| entry["identifier"] == "opener:allow-open-url")
        .flat_map(|entry| entry["allow"].as_array().cloned().unwrap_or_default())
        .map(|allow| {
            let pattern = allow["url"].as_str().expect("scope entry needs a url");
            glob::Pattern::new(pattern).expect("valid glob")
        })
        .collect()
}

fn is_allowed(scope: &[glob::Pattern], url: &str) -> bool {
    scope.iter().any(|pattern| pattern.matches(url))
}

#[test]
fn every_url_devhub_opens_is_in_scope() {
    let scope = opener_scope();
    assert!(
        !scope.is_empty(),
        "opener:allow-open-url has no scope, so every open fails"
    );

    let urls = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:1420",
        "https://github.com/dayflow-js/calendar",
        "http://192.168.1.14:5173/",
        "https://vitejs.dev/guide/",
    ];

    for url in urls {
        assert!(
            is_allowed(&scope, url),
            "`{url}` would be refused at runtime"
        );
    }
}

#[test]
fn non_web_schemes_stay_out_of_scope() {
    let scope = opener_scope();

    for url in [
        "file:///etc/passwd",
        "mailto:someone@example.com",
        "tel:+1234567890",
        "javascript:alert(1)",
        "devhub://internal",
    ] {
        assert!(!is_allowed(&scope, url), "`{url}` should not be openable");
    }
}

#[test]
fn the_folder_picker_is_permitted() {
    let raw = std::fs::read_to_string("capabilities/default.json").expect("capability file");
    let json: Value = serde_json::from_str(&raw).expect("valid JSON");
    let permissions = json["permissions"].as_array().expect("permissions array");

    assert!(
        permissions
            .iter()
            .any(|p| p.as_str() == Some("dialog:allow-open")),
        "the add-project flow cannot open a folder picker without dialog:allow-open",
    );
}

#[test]
fn double_clicking_the_sidebar_can_toggle_window_maximize() {
    let raw = std::fs::read_to_string("capabilities/default.json").expect("capability file");
    let json: Value = serde_json::from_str(&raw).expect("valid JSON");
    let permissions = json["permissions"].as_array().expect("permissions array");

    assert!(
        permissions
            .iter()
            .any(|permission| permission.as_str() == Some("core:window:allow-toggle-maximize")),
        "the sidebar double-click cannot maximize the window without window permission",
    );
}

#[test]
fn page_and_sidebar_headers_can_start_window_dragging() {
    let raw = std::fs::read_to_string("capabilities/default.json").expect("capability file");
    let json: Value = serde_json::from_str(&raw).expect("valid JSON");
    let permissions = json["permissions"].as_array().expect("permissions array");

    assert!(
        permissions
            .iter()
            .any(|permission| permission.as_str() == Some("core:window:allow-start-dragging")),
        "page and sidebar headers cannot drag the window without window permission",
    );
}
