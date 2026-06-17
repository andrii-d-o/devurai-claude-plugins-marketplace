import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface WikiEntry {
  id: string; // relative path: "architecture/database.md"
  title: string;
  tags: string[];
  date: string;
  source: string;
  body: string;
}

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  mtimeMs: number;
}

export function parseEntry(content: string, relativePath: string): WikiEntry {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!frontmatterMatch) {
    return {
      id: relativePath,
      title: relativePath,
      tags: [],
      date: "",
      source: "",
      body: content.trim(),
    };
  }

  const [, rawFrontmatter, rawBody] = frontmatterMatch;
  const frontmatter = parseFrontmatter(rawFrontmatter ?? "");
  const body = (rawBody ?? "").trim();

  return {
    id: relativePath,
    title:
      typeof frontmatter.title === "string" ? frontmatter.title : relativePath,
    tags: Array.isArray(frontmatter.tags)
      ? frontmatter.tags.filter((t): t is string => typeof t === "string")
      : [],
    date:
      typeof frontmatter.date === "string"
        ? frontmatter.date
        : String(frontmatter.date ?? ""),
    source: typeof frontmatter.source === "string" ? frontmatter.source : "",
    body,
  };
}

/** Minimal YAML-ish frontmatter parser. Handles scalars and arrays like [a, b, c]. */
function parseFrontmatter(raw: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const line of raw.split("\n")) {
    const match = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!key || value === undefined) continue;

    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      result[key] = trimmed
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0);
    } else {
      result[key] = trimmed.replace(/^["']|["']$/g, "");
    }
  }
  return result;
}

export async function scanWikiFiles(wikiDir: string): Promise<ScannedFile[]> {
  const results: ScannedFile[] = [];
  await walkDir(wikiDir, wikiDir, results);
  return results;
}

async function walkDir(
  baseDir: string,
  currentDir: string,
  results: ScannedFile[],
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) {
        await walkDir(baseDir, fullPath, results);
      }
    } else if (entry.name.endsWith(".md") && entry.name !== "README.md") {
      const stats = await stat(fullPath);
      results.push({
        relativePath: path.relative(baseDir, fullPath),
        absolutePath: fullPath,
        mtimeMs: stats.mtimeMs,
      });
    }
  }
}

export async function loadEntry(file: ScannedFile): Promise<WikiEntry> {
  const content = await readFile(file.absolutePath, "utf-8");
  return parseEntry(content, file.relativePath);
}
