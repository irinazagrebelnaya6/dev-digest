import type { SkillType } from "@devdigest/shared";

const SKILL_TYPES = new Set<SkillType>(["rubric", "convention", "security", "custom"]);

export interface ParsedSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body: string;
}

/**
 * Extract YAML frontmatter (between leading `---` delimiters) and the body
 * of a skill Markdown file. Pure function — no I/O, no external libraries.
 *
 * Frontmatter keys recognised: `name`, `description`, `type`.
 * Everything after the closing `---` is treated as the skill body.
 */
export function parseSkillMarkdown(text: string): ParsedSkill {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    // No frontmatter — the whole file is the body.
    return { body: text.trim() };
  }

  const closeIdx = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (closeIdx === -1) {
    return { body: text.trim() };
  }

  const fmLines = lines.slice(1, closeIdx);
  const body = lines.slice(closeIdx + 1).join("\n").trim();

  const result: ParsedSkill = { body };

  for (const line of fmLines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (!value) continue;

    if (key === "name") result.name = value;
    else if (key === "description") result.description = value;
    else if (key === "type" && SKILL_TYPES.has(value as SkillType)) result.type = value as SkillType;
  }

  return result;
}
