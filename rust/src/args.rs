// Argument parsing, in one place. Every verb reads args through
// these three functions — flag values never leak into positionals,
// because the leak has bitten three separate verbs already.
//
// Convention: flags may precede or follow positionals; values attach
// with space or =. Boolean flags are bare (--headed, --all).
// VALUE_FLAGS names every flag that consumes the next arg.
const VALUE_FLAGS: &[&str] = &[
    "--session",
    "-s",
    "--profile",
    "--url",
    "--params",
    "--frame",
    "--program",
    "--max-calls",
    "--timeout-ms",
    "--limit",
    "--offset",
    "--query",
    "--for",
    "--name",
    "--desc",
    "--file",
    "--tool",
];

fn takes_value(a: &str) -> bool {
    if VALUE_FLAGS.contains(&a) {
        return true;
    }
    if extra_flags().lock().is_ok_and(|set| set.contains(a)) {
        return true;
    }
    // --name=value form still counts as a flag (value attached).
    VALUE_FLAGS.iter().any(|n| a.starts_with(&format!("{n}=")))
}

/// Bare flag present (--headed, --all). Values never count.
pub fn has(args: &[String], name: &str) -> bool {
    args.iter().any(|a| a == name)
}

/// Value flags contributed by external plugin manifests (manifest
/// `flags` per verb). Same semantics as VALUE_FLAGS: global, additive.
fn extra_flags() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static SET: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    SET.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

/// Register manifest-declared value flags (--depth, ...). Additive and
/// global, like the const table: a declared flag consumes its value in
/// positionals for every verb.
pub fn register_value_flags(flags: &[String]) {
    if let Ok(mut set) = extra_flags().lock() {
        for f in flags {
            if f.starts_with("--") && !f.contains('=') {
                set.insert(f.clone());
            }
        }
    }
}

/// Flag value: --name value or --name=value. None when absent.
pub fn flag(args: &[String], name: &str) -> Option<String> {
    let mut it = args.iter().peekable();
    while let Some(a) = it.next() {
        if a == name {
            if let Some(v) = it.next() {
                return Some(v.clone());
            }
            return None;
        }
        if let Some(v) = a.strip_prefix(&format!("{name}=")) {
            return Some(v.to_string());
        }
    }
    None
}

/// Positional args: bare values that are neither flags nor flag
/// values. `open --session w URL` yields ["URL"], never ["w", "URL"].
pub fn positionals(args: &[String]) -> Vec<String> {
    let mut skip = false;
    args.iter()
        .filter(|a| {
            if skip {
                skip = false;
                return false;
            }
            if takes_value(a) && !a.contains('=') {
                skip = true;
                return false;
            }
            !a.starts_with('-')
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn flag_values_never_leak() {
        // Documented example: session value is not positional.
        assert_eq!(positionals(&v(&["open", "--session", "w", "https://x"])), vec!["open".to_string(), "https://x".to_string()]);
        // --flag=value form: value attached, nothing leaks.
        assert_eq!(positionals(&v(&["--session=w", "https://x"])), vec!["https://x".to_string()]);
        assert_eq!(flag(&v(&["--session=w"]), "--session"), Some("w".to_string()));
        // Bare flags stay out; unknown --flags keep their following value
        // visible (only declared value flags consume).
        assert_eq!(positionals(&v(&["a", "--headed", "b"])), vec!["a".to_string(), "b".to_string()]);
        assert!(has(&v(&["a", "--headed"]), "--headed"));
        assert!(!has(&v(&["a"]), "--headed"));
        // Short value flag consumes.
        assert_eq!(positionals(&v(&["-s", "w", "https://x"])), vec!["https://x".to_string()]);
        // Manifest-declared flags consume globally once registered.
        register_value_flags(&["--testdepth".to_string()]);
        assert_eq!(positionals(&v(&["go", "--testdepth", "2"])), vec!["go".to_string()]);
        // = form never consumes the next arg.
        assert_eq!(positionals(&v(&["--query=a b", "c"])), vec!["c".to_string()]);
    }
}
