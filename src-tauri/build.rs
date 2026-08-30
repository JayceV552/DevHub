fn main() {
    println!("cargo:rerun-if-env-changed=APPLE_SIGNING_IDENTITY");
    println!("cargo:rerun-if-env-changed=DEVHUB_STABLE_SIGNING");
    let stable_signing = std::env::var("DEVHUB_STABLE_SIGNING")
        .is_ok_and(|value| !value.trim().is_empty() && value != "0")
        || std::env::var("APPLE_SIGNING_IDENTITY")
            .is_ok_and(|value| !value.trim().is_empty() && value != "-");
    if stable_signing {
        println!("cargo:rustc-env=DEVHUB_STABLE_SIGNING=1");
    }
    tauri_build::build()
}
