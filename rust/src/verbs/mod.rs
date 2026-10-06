// Verb plugins, one file per area. Each module exposes a constructor
// returning its plugins; mod.rs aggregates them for the registry.
pub mod act;
pub mod browser;
pub mod core;
pub mod exec;
pub mod skills;
pub mod tools;
pub mod webmcp;

use crate::plugin::Plugin;

/// All verb plugins, in dispatch order.
pub fn all() -> Vec<Plugin> {
    let mut v = core::plugins();
    v.extend(browser::plugins());
    v.extend(act::plugins());
    v.extend(webmcp::plugins());
    v.extend(tools::plugins());
    v.extend(skills::plugins());
    v.extend(exec::plugins());
    v
}
