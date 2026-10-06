// Skill verbs: list, show, search. Playbooks live with their plugins
// (manifest `skills`); this serves them to agents progressively:
// names first, content on demand, grep before full reads.
use crate::plugin::{Plugin, Verb};

/// Cap a served playbook: skills are small by convention; a huge file
/// truncates with a note instead of flooding context.
const MAX_SKILL_BYTES: usize = 32 * 1024;

/// Resolve a manifest-declared skill to a real file. Canonicalizes and
/// confines to the plugin dir: a manifest pointing outside its own dir
/// is refused, never read.
fn resolve_skill(plugin_dir: &str, entry: &str) -> anyhow::Result<std::path::PathBuf> {
    let base = std::path::PathBuf::from(plugin_dir)
        .canonicalize()
        .map_err(|_| anyhow::anyhow!("not_found: no plugin dir"))?;
    let cand = std::path::PathBuf::from(entry);
    let joined = if cand.is_absolute() {
        cand
    } else {
        base.join(entry.trim_start_matches("./"))
    };
    let real = joined
        .canonicalize()
        .map_err(|_| anyhow::anyhow!("not_found: no skill {entry}"))?;
    if !real.starts_with(&base) || !real.is_file() {
        anyhow::bail!("policy_denied: skill escapes plugin dir");
    }
    Ok(real)
}

fn read_skill(plugin_dir: &str, entry: &str) -> anyhow::Result<String> {
    let real = resolve_skill(plugin_dir, entry)?;
    let raw = std::fs::read_to_string(&real)?;
    if raw.len() > MAX_SKILL_BYTES {
        Ok(format!("{}…\n[truncated at {MAX_SKILL_BYTES} bytes]", &raw[..MAX_SKILL_BYTES]))
    } else {
        Ok(raw)
    }
}

/// Skill verbs: list, show, search.
pub fn plugins() -> Vec<Plugin> {
    vec![Plugin {
        id: "skill.serve",
        permissions: vec![],
        verbs: vec![Verb {
            name: "skill",
            help: "skill <list|show|search> — list playbooks, read one, grep all",
            run: |_ctx, _reg, _verb, args| {
                let sub = crate::args::positionals(args)
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "list".to_string());
                match sub.as_str() {
                    "list" => skill_list(args),
                    "show" => skill_show(args),
                    "search" => skill_search(args),
                    _ => anyhow::bail!("usage: skill <list|show|search>"),
                }
            },
        }],
        hooks: crate::plugin::Hooks {
            before: None,
            after: None,
        },
    }]
}

fn skill_list(args: &[String]) -> anyhow::Result<serde_json::Value> {
    let only = crate::args::flag(args, "--plugin");
    let mut items = vec![];
    for (id, meta) in crate::plugin::all_meta() {
        if let Some(ref want) = only
            && want != &id
        {
            continue;
        }
        for s in &meta.skills {
            items.push(serde_json::json!({"plugin": id, "skill": s}));
        }
    }
    Ok(serde_json::json!({"skills": items}))
}

fn skill_show(args: &[String]) -> anyhow::Result<serde_json::Value> {
    let id = crate::args::positionals(args)
        .into_iter()
        .find(|a| a != "show")
        .ok_or_else(|| anyhow::anyhow!("usage: skill show <plugin-id>"))?;
    let meta = crate::plugin::meta_for(&id)
        .ok_or_else(|| anyhow::anyhow!("not_found: no skills for {id}"))?;
    if meta.skills.is_empty() {
        anyhow::bail!("not_found: no skills for {id}");
    }
    let mut docs = vec![];
    for s in &meta.skills {
        match read_skill(&meta.source, s) {
            Ok(body) => docs.push(serde_json::json!({"skill": s, "body": body})),
            Err(e) => docs.push(serde_json::json!({"skill": s, "error": format!("{e:#}")})),
        }
    }
    Ok(serde_json::json!({"plugin": id, "skills": docs}))
}

fn skill_search(args: &[String]) -> anyhow::Result<serde_json::Value> {
    let query = crate::args::positionals(args)
        .into_iter()
        .filter(|a| a != "search")
        .collect::<Vec<_>>()
        .join(" ");
    if query.trim().is_empty() {
        anyhow::bail!("usage: skill search <terms>");
    }
    let terms: Vec<String> = query.split_whitespace().map(|t| t.to_lowercase()).collect();
    let mut hits = vec![];
    for (id, meta) in crate::plugin::all_meta() {
        for s in &meta.skills {
            let body = match read_skill(&meta.source, s) {
                Ok(b) => b,
                Err(_) => continue,
            };
            let hay = format!("{id}\n{s}\n{body}").to_lowercase();
            if !terms.iter().all(|t| hay.contains(t)) {
                continue;
            }
            // Score: id/name hit outranks body-only.
            let name_hit = format!("{id}\n{s}").to_lowercase();
            let score = if terms.iter().all(|t| name_hit.contains(t)) {
                2
            } else {
                1
            };
            let mut lines: Vec<String> = body
                .lines()
                .filter(|l| {
                    let l = l.to_lowercase();
                    terms.iter().any(|t| l.contains(t))
                })
                .take(3)
                .map(|l| l.trim().chars().take(120).collect())
                .collect();
            if lines.is_empty() {
                lines = body.lines().take(2).map(|l| l.trim().chars().take(120).collect()).collect();
            }
            hits.push((score, serde_json::json!({"plugin": id, "skill": s, "matches": lines})));
        }
    }
    hits.sort_by(|a, b| b.0.cmp(&a.0).then(a.1["plugin"].as_str().cmp(&b.1["plugin"].as_str())));
    let items: Vec<serde_json::Value> = hits.into_iter().map(|(_, v)| v).collect();
    Ok(serde_json::json!({"results": items, "total": items.len()}))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_skill(tag: &str, body: &str) -> (String, String) {
        let dir = std::env::temp_dir().join(format!("awmcp-skill-{tag}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), body).unwrap();
        (
            dir.to_string_lossy().to_string(),
            dir.join("SKILL.md").to_string_lossy().to_string(),
        )
    }

    #[test]
    fn escape_refused() {
        let (dir, _) = tmp_skill("esc", "hi");
        assert!(resolve_skill(&dir, "../../etc/passwd").is_err());
        assert!(resolve_skill(&dir, "./SKILL.md").is_ok());
        assert!(resolve_skill(&dir, "./missing.md").is_err());
    }

    #[test]
    fn search_ranks_and_snippets() {
        let (dir, path) = tmp_skill(
            "rank",
            "---\nname: test.rank\n---\n# Compare drills\nWorkflow for cordless drills.",
        );
        crate::plugin::register_meta(
            "test.skillrank",
            crate::plugin::ExtMeta {
                version: "0.1.0".into(),
                scope: "extra".into(),
                source: dir,
                skills: vec![path],
                tools: vec![],
            },
        );
        let args: Vec<String> = ["search", "cordless", "drills"].iter().map(|s| s.to_string()).collect();
        let out = skill_search(&args).unwrap();
        let hit = &out["results"][0];
        assert_eq!(hit["plugin"], serde_json::json!("test.skillrank"));
        assert!(!hit["matches"].as_array().unwrap().is_empty());
        let miss: Vec<String> = ["search", "zzz-nope"].iter().map(|s| s.to_string()).collect();
        assert_eq!(skill_search(&miss).unwrap()["total"], serde_json::json!(0));
    }
}
