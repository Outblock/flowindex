import fs from "fs";
import path from "path";
import { tool } from "ai";
import { z } from "zod";

export interface SkillMetadata {
  name: string;
  description: string;
  dirPath: string; // absolute path to skill directory
}

/**
 * Parse YAML frontmatter from a SKILL.md file.
 * Expects: ---\nname: ...\ndescription: ...\n---
 */
function parseFrontmatter(content: string): { name: string; description: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;

  const block = match[1];
  let name = "";
  let description = "";

  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("name:")) {
      name = trimmed.slice(5).trim();
    } else if (trimmed.startsWith("description:")) {
      description = trimmed.slice(12).trim();
    }
  }

  return name ? { name, description } : null;
}

/**
 * Strip YAML frontmatter, returning only the markdown body.
 */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
}

/**
 * Resolve the skills directory. Checks (in order):
 * 1. SKILLS_DIR env var
 * 2. <project-root>/skills (development — walks up from ai/chat/web)
 * 3. /app/skills (Docker production)
 */
function resolveSkillsDir(): string {
  if (process.env.SKILLS_DIR) return process.env.SKILLS_DIR;

  // Walk up from ai/chat/web to find monorepo root with skills/
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "skills");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    dir = path.dirname(dir);
  }

  // Docker fallback
  if (fs.existsSync("/app/skills")) return "/app/skills";

  return path.join(process.cwd(), "skills");
}

// ── Cached discovery ──

let _skills: SkillMetadata[] | null = null;
let _skillsDir: string | null = null;

/**
 * Discover all skills by scanning the skills directory.
 * Results are cached after first call.
 */
export function discoverSkills(): SkillMetadata[] {
  if (_skills) return _skills;

  _skillsDir = resolveSkillsDir();
  _skills = [];

  if (!fs.existsSync(_skillsDir)) {
    console.warn(`[skills] Directory not found: ${_skillsDir}`);
    return _skills;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(_skillsDir, { withFileTypes: true });
  } catch {
    return _skills;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(_skillsDir, entry.name);
    const skillFile = path.join(skillDir, "SKILL.md");

    if (!fs.existsSync(skillFile)) continue;

    try {
      const content = fs.readFileSync(skillFile, "utf-8");
      const meta = parseFrontmatter(content);
      if (meta) {
        _skills.push({
          name: meta.name,
          description: meta.description,
          dirPath: skillDir,
        });
      }
    } catch {
      // skip unreadable skill files
    }
  }

  if (_skills.length > 0) {
    console.log(
      `[skills] Discovered ${_skills.length} skill(s): ${_skills.map((s) => s.name).join(", ")}`
    );
  }

  return _skills;
}

/**
 * Load the full content of a skill by name.
 */
export function loadSkillContent(name: string): { content: string; skillDirectory: string } | null {
  const skills = discoverSkills();
  const skill = skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!skill) return null;

  const skillFile = path.join(skill.dirPath, "SKILL.md");
  try {
    const content = fs.readFileSync(skillFile, "utf-8");
    return {
      content: stripFrontmatter(content),
      skillDirectory: skill.dirPath,
    };
  } catch {
    return null;
  }
}

/**
 * Build a prompt section listing available skills.
 * Appended to the system prompt so the AI knows what skills exist.
 */
export function buildSkillsPrompt(): string {
  const skills = discoverSkills();
  if (skills.length === 0) return "";

  const list = skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n");

  return `\n## Available Skills

Use the \`loadSkill\` tool to load specialized knowledge when a user's request would benefit from it. Only load a skill when needed — the content will be added to your context.

${list}`;
}

/**
 * Create the loadSkill tool definition (shared by all chat routes).
 */
export function createLoadSkillTool() {
  return tool({
    description:
      "Load a skill to get specialized instructions and knowledge. " +
      "Use this when the user's request matches an available skill.",
    inputSchema: z.object({
      name: z.string().describe("The skill name to load (e.g. 'cadence')"),
    }),
    execute: async ({ name }: { name: string }) => {
      const result = loadSkillContent(name);
      if (!result) {
        return { error: `Skill '${name}' not found. Check available skills in your instructions.` };
      }
      return result;
    },
  });
}
