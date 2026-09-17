package catalogdata

import "embed"

//go:embed skills-catalog
var CatalogFS embed.FS

//go:embed skills/agent-webmcp/SKILL.md skills/agent-webmcp/references/*.md
var SkillFS embed.FS
