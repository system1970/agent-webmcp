// Build stamp: git rev (+-dirty) baked in at compile time so a
// running server can prove which source it was built from. Falls back
// to "unknown" outside a git checkout (packaged builds).
fn main() {
    let rev = |args: &[&str]| {
        std::process::Command::new("git")
            .arg("-C")
            .arg("..")
            .args(args)
            .output()
            .ok()
            .and_then(|o| String::from_utf8(o.stdout).ok())
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    };
    let sha = rev(&["rev-parse", "--short", "HEAD"]);
    let sha = if sha.is_empty() { "unknown".to_string() } else { sha };
    let dirty = !rev(&["status", "--porcelain"]).is_empty();
    println!(
        "cargo::rustc-env=AGENT_WEBMCP_REV={}{}",
        sha,
        if dirty && sha != "unknown" { "-dirty" } else { "" }
    );
    println!("cargo::rerun-if-changed=build.rs");
    println!("cargo::rerun-if-changed=../.git/HEAD");
    println!("cargo::rerun-if-changed=../.git/index");
}
