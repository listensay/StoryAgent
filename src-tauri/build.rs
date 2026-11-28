fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=src/window_layout.m");
        cc::Build::new().file("src/window_layout.m").flag("-fobjc-arc").compile("storyagent_window_layout");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
    tauri_build::build()
}
