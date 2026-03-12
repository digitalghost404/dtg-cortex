import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmbientCard {
  type: "quote" | "stat" | "connection" | "forgotten" | "tag_cloud" | "on_this_day";
  title: string;
  content: string;
  meta?: string;
}

interface NoteRecord {
  name: string;
  path: string;
  fullPath: string;
  content: string;
  tags: string[];
  outgoing: string[];
  modified: Date;
  firstLine: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectMarkdownFiles(full));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(full);
      }
    }
  } catch {
    // silently skip unreadable dirs
  }
  return results;
}

function normaliseTag(raw: unknown): string {
  const s = String(raw).trim();
  return s.startsWith("#") ? s : `#${s}`;
}

function extractTags(data: Record<string, unknown>): string[] {
  const raw = data.tags ?? data.tag ?? data.Topics ?? data.topics ?? null;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normaliseTag);
  if (typeof raw === "string") {
    return raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normaliseTag);
  }
  return [];
}

function wikilinkTarget(raw: string): string {
  return raw.split(/[|#]/)[0].trim();
}

/** Pick a random subset of `count` items from `arr` without repeats. */
function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/** Extract the first non-empty non-frontmatter line from content. */
function firstLine(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.length > 10) {
      return trimmed.slice(0, 160);
    }
  }
  return "(no excerpt)";
}

/** Extract 2-4 consecutive sentences from the middle of a note's content. */
function extractQuote(content: string): string {
  // Strip markdown syntax lightly
  const cleaned = content
    .replace(/#+\s+/g, "")
    .replace(/\*\*?([^*]+)\*\*?/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`[^`]+`/g, "")
    .trim();

  // Split into sentences
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 300);

  if (sentences.length === 0) return cleaned.slice(0, 200);

  const count = Math.min(4, Math.max(2, sentences.length));
  const start = Math.floor(Math.random() * Math.max(1, sentences.length - count));
  return sentences.slice(start, start + count).join(" ");
}

// ---------------------------------------------------------------------------
// Card generators
// ---------------------------------------------------------------------------

function makeQuoteCard(notes: NoteRecord[]): AmbientCard | null {
  const candidates = notes.filter((n) => n.content.trim().length > 100);
  if (candidates.length === 0) return null;
  const note = candidates[Math.floor(Math.random() * candidates.length)];
  const quote = extractQuote(note.content);
  return {
    type: "quote",
    title: "VAULT EXCERPT",
    content: quote,
    meta: note.name,
  };
}

function makeStatCard(
  notes: NoteRecord[],
  vaultPath: string
): AmbientCard {
  const stats = [
    () => {
      const folders = new Set(
        notes.map((n) => path.dirname(path.relative(vaultPath, n.fullPath))).filter((d) => d !== ".")
      );
      return {
        title: "VAULT SCOPE",
        content: `${notes.length}`,
        meta: `notes across ${Math.max(1, folders.size)} folder${folders.size !== 1 ? "s" : ""}`,
      };
    },
    () => {
      const totalWords = notes.reduce((sum, n) => {
        const words = n.content.trim().split(/\s+/).length;
        return sum + words;
      }, 0);
      return {
        title: "TOTAL WORDS",
        content: totalWords.toLocaleString(),
        meta: "words written across all notes",
      };
    },
    () => {
      const withLinks = notes.filter((n) => n.outgoing.length > 0).length;
      return {
        title: "LINKED NOTES",
        content: `${withLinks}`,
        meta: `of ${notes.length} notes have outgoing links`,
      };
    },
    () => {
      const tagSet = new Set<string>();
      notes.forEach((n) => n.tags.forEach((t) => tagSet.add(t)));
      return {
        title: "UNIQUE TAGS",
        content: `${tagSet.size}`,
        meta: "distinct tags catalogued",
      };
    },
    () => {
      const avgWords = Math.round(
        notes.reduce((sum, n) => sum + n.content.trim().split(/\s+/).length, 0) /
          Math.max(1, notes.length)
      );
      return {
        title: "AVG NOTE LENGTH",
        content: `${avgWords}`,
        meta: "average words per note",
      };
    },
  ];
  const fn = stats[Math.floor(Math.random() * stats.length)];
  return { type: "stat", ...fn() };
}

function makeConnectionCard(notes: NoteRecord[]): AmbientCard | null {
  const nameSet = new Set(notes.map((n) => n.name.toLowerCase()));
  const pairs: Array<{ from: string; to: string }> = [];
  for (const note of notes) {
    for (const target of note.outgoing) {
      if (nameSet.has(target.toLowerCase()) && target.toLowerCase() !== note.name.toLowerCase()) {
        pairs.push({ from: note.name, to: target });
      }
    }
  }
  if (pairs.length === 0) return null;
  const pair = pairs[Math.floor(Math.random() * pairs.length)];
  return {
    type: "connection",
    title: "KNOWLEDGE LINK",
    content: `${pair.from} → ${pair.to}`,
    meta: `[[${pair.from}]] links to [[${pair.to}]]`,
  };
}

function makeForgottenCard(notes: NoteRecord[]): AmbientCard | null {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const old = notes.filter((n) => n.modified.getTime() < cutoff);
  if (old.length === 0) return null;
  const note = old[Math.floor(Math.random() * old.length)];
  const daysSince = Math.floor((Date.now() - note.modified.getTime()) / (24 * 60 * 60 * 1000));
  return {
    type: "forgotten",
    title: "MEMORY FADING",
    content: note.firstLine,
    meta: `${note.name} · last modified ${daysSince} days ago`,
  };
}

function makeTagCloudCard(notes: NoteRecord[]): AmbientCard | null {
  const tagCounts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  if (tagCounts.size === 0) return null;
  const top5 = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const content = top5.map(([tag, count]) => `${tag}:${count}`).join(" ");
  return {
    type: "tag_cloud",
    title: "TAG FREQUENCY",
    content,
    meta: `${tagCounts.size} total tags`,
  };
}

function makeOnThisDayCard(notes: NoteRecord[]): AmbientCard | null {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  const currentYear = now.getFullYear();

  const matches = notes.filter((n) => {
    const d = n.modified;
    return d.getMonth() === month && d.getDate() === day && d.getFullYear() < currentYear;
  });
  if (matches.length === 0) return null;

  const names = matches.map((n) => n.name).join(", ");
  return {
    type: "on_this_day",
    title: "ON THIS DAY",
    content: names,
    meta: `${matches.length} note${matches.length !== 1 ? "s" : ""} touched on this date in previous years`,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET() {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    return NextResponse.json(
      { error: "VAULT_PATH environment variable is not set." },
      { status: 500 }
    );
  }
  if (!fs.existsSync(vaultPath)) {
    return NextResponse.json(
      { error: `Vault directory not found: ${vaultPath}` },
      { status: 404 }
    );
  }

  try {
    const allPaths = collectMarkdownFiles(vaultPath);

    const notes: NoteRecord[] = allPaths.map((fullPath) => {
      const raw = fs.readFileSync(fullPath, "utf8");
      const { data, content } = matter(raw);
      const name = path.basename(fullPath, ".md");
      const relativePath = path.relative(vaultPath, fullPath);
      const stat = fs.statSync(fullPath);

      const outgoing: string[] = [];
      let match: RegExpExecArray | null;
      const re = new RegExp(WIKILINK_RE.source, "g");
      while ((match = re.exec(content)) !== null) {
        outgoing.push(wikilinkTarget(match[1]));
      }

      return {
        name,
        path: relativePath,
        fullPath,
        content,
        tags: extractTags(data as Record<string, unknown>),
        outgoing,
        modified: stat.mtime,
        firstLine: firstLine(content),
      };
    });

    // Build pool of all possible cards, then pick 5-8 randomly
    const pool: AmbientCard[] = [];

    // Always attempt to add multiple of each type so random selection has variety
    for (let i = 0; i < 4; i++) {
      const c = makeQuoteCard(notes);
      if (c) pool.push(c);
    }
    for (let i = 0; i < 3; i++) {
      pool.push(makeStatCard(notes, vaultPath));
    }
    for (let i = 0; i < 3; i++) {
      const c = makeConnectionCard(notes);
      if (c) pool.push(c);
    }
    {
      const c = makeForgottenCard(notes);
      if (c) pool.push(c);
    }
    {
      const c = makeTagCloudCard(notes);
      if (c) pool.push(c);
    }
    {
      const c = makeOnThisDayCard(notes);
      if (c) pool.push(c);
    }

    const count = Math.floor(Math.random() * 4) + 5; // 5-8
    const cards = pickRandom(pool, Math.min(count, pool.length));

    return NextResponse.json({ cards });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
