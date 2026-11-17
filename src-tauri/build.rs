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

    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=native/notch_window.m");
        cc::Build::new()
            .file("native/notch_window.m")
            .flag("-fobjc-arc")
            .compile("notch_window");

        let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
        let swift_dir = manifest_dir.join("native").join("notch-helper");
        let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
        let target_bin = out_dir.join("devhub-notch-helper");

        println!("cargo:rerun-if-changed={}", swift_dir.display());
        let mut swift_sources: Vec<_> = std::fs::read_dir(&swift_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok().map(|e| e.path()))
                    .filter(|p| p.extension().is_some_and(|ext| ext == "swift"))
                    .collect()
            })
            .unwrap_or_default();
        swift_sources.sort();
        for src in &swift_sources {
            println!("cargo:rerun-if-changed={}", src.display());
        }

        let status = std::process::Command::new("swiftc")
            .arg("-O")
            .args(&swift_sources)
            .arg("-o")
            .arg(&target_bin)
            .status();

        if let Ok(s) = status
            && s.success()
        {
            // Code sign with com.apple prefix so MediaRemote framework grants full media info access
            let _ = std::process::Command::new("codesign")
                .arg("-f")
                .arg("-s")
                .arg("-")
                .arg("--identifier")
                .arg("com.apple.devhub-notch-helper")
                .arg(&target_bin)
                .status();

            let native_bin = manifest_dir.join("native").join("devhub-notch-helper");
            let _ = std::fs::copy(&target_bin, &native_bin);
            let _ = std::process::Command::new("codesign")
                .arg("-f")
                .arg("-s")
                .arg("-")
                .arg("--identifier")
                .arg("com.apple.devhub-notch-helper")
                .arg(&native_bin)
                .status();

            println!(
                "cargo:rustc-env=DEVHUB_NOTCH_HELPER_PATH={}",
                target_bin.display()
            );
        }
    }

    tauri_build::build()
}
