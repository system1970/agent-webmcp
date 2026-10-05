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
];

fn takes_value(a: &str) -> bool {
    if VALUE_FLAGS.contains(&a) {
        return true;
    }
    // --name=value form still counts as a flag (value attached).
    VALUE_FLAGS.iter().any(|n| a.starts_with(&format!("{n}=")))
}

/// Bare flag present (--headed, --all). Values never count.
pub fn has(args: &[String], name: &str) -> bool {
    args.iter().any(|a| a == name)
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
