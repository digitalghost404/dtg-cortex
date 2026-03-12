import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NoteRecord {
  name: string;
  /** Path relative to vault root */
  path: string;
  fullPath: string;
  content: string;
  /** Frontmatter tags — normalised to include the # prefix */
  tags: string[];
  /** Raw wikilinks extracted from content e.g. "My Note" */
  outgoing: string[];
  modified: Date;
  words: number;
  folder: string;
}

interface RecentlyModifiedNote {
  name: string;
  path: string;
  modified: string;
}

interface TagEntry {
  tag: string;
  count: number;
}

interface FolderEntry {
  folder: string;
  count: number;
}

export interface VaultStats {
  totalNotes: number;
  totalFolders: number;
  totalWords: number;
  orphans: string[];
  brokenLinks: string[];
  recentlyModified: RecentlyModifiedNote[];
  topTags: TagEntry[];
  folderSizes: FolderEntry[];
  emptyNotes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/** Recursively collect all .md file paths under a directory. */
function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

/** Normalise a tag value so it always starts with "#". */
function normaliseTag(raw: unknown): string {
  const s = String(raw).trim();
  return s.startsWith("#") ? s : `#${s}`;
}

/** Extract tags from gray-matter frontmatter. Handles array or space/comma-separated string. */
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

/** Extract the display name a wikilink resolves to (drop aliases and headings). */
function wikilinkTarget(raw: string): string {
  // [[Note Name#Heading|Alias]] → "Note Name"
  return raw.split(/[|#]/)[0].trim();
}

/** Count words in a string (split on whitespace). */
function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

function computeVaultStats(vaultPath: string): VaultStats {
  const allPaths = collectMarkdownFiles(vaultPath);

  // ── Build note records ────────────────────────────────────────────────────
  const notes: NoteRecord[] = allPaths.map((fullPath) => {
    const relativePath = path.relative(vaultPath, fullPath);
    const name = path.basename(fullPath, ".md");
    const folder = path.dirname(relativePath) === "." ? "(root)" : path.dirname(relativePath);

    const raw = fs.readFileSync(fullPath, "utf8");
    const { data, content } = matter(raw);

    const outgoing: string[] = [];
    let match: RegExpExecArray | null;
    const re = new RegExp(WIKILINK_RE.source, "g");
    while ((match = re.exec(content)) !== null) {
      outgoing.push(wikilinkTarget(match[1]));
    }

    const stat = fs.statSync(fullPath);

    return {
      name,
      path: relativePath,
      fullPath,
      content,
      tags: extractTags(data as Record<string, unknown>),
      outgoing,
      modified: stat.mtime,
      words: countWords(content),
      folder,
    };
  });

  // ── Build lookup: note name → exists (case-insensitive) ──────────────────
  const nameSet = new Set(notes.map((n) => n.name.toLowerCase()));

  // Also index by full relative path without extension for path-based wikilinks
  const pathSet = new Set(
    notes.map((n) => n.path.replace(/\.md$/, "").toLowerCase())
  );

  function resolves(target: string): boolean {
    const lower = target.toLowerCase();
    return nameSet.has(lower) || pathSet.has(lower);
  }

  // ── Broken links ─────────────────────────────────────────────────────────
  const brokenSet = new Set<string>();
  for (const note of notes) {
    for (const target of note.outgoing) {
      if (!resolves(target)) {
        brokenSet.add(`[[${target}]]`);
      }
    }
  }

  // ── Incoming link map ─────────────────────────────────────────────────────
  const incomingCount = new Map<string, number>();
  for (const note of notes) {
    for (const target of note.outgoing) {
      const lower = target.toLowerCase();
      // Find matching note name
      const matched = notes.find((n) => n.name.toLowerCase() === lower);
      if (matched) {
        incomingCount.set(matched.name, (incomingCount.get(matched.name) ?? 0) + 1);
      }
    }
  }

  // ── Orphans: no incoming AND no outgoing resolved links ───────────────────
  const orphans = notes
    .filter((n) => {
      const hasIncoming = (incomingCount.get(n.name) ?? 0) > 0;
      const hasOutgoing = n.outgoing.some((t) => resolves(t));
      return !hasIncoming && !hasOutgoing;
    })
    .map((n) => n.name + ".md");

  // ── Recently modified (top 10) ────────────────────────────────────────────
  const recentlyModified: RecentlyModifiedNote[] = [...notes]
    .sort((a, b) => b.modified.getTime() - a.modified.getTime())
    .slice(0, 10)
    .map((n) => ({
      name: n.name + ".md",
      path: n.path,
      modified: n.modified.toISOString(),
    }));

  // ── Top tags ──────────────────────────────────────────────────────────────
  const tagCounts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags: TagEntry[] = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // ── Folder sizes ──────────────────────────────────────────────────────────
  const folderCounts = new Map<string, number>();
  for (const note of notes) {
    folderCounts.set(note.folder, (folderCounts.get(note.folder) ?? 0) + 1);
  }
  const folderSizes: FolderEntry[] = [...folderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([folder, count]) => ({ folder, count }));

  // ── Total folders ─────────────────────────────────────────────────────────
  // Count unique actual directories that contain .md files
  const uniqueDirs = new Set(
    notes
      .map((n) => path.dirname(n.path))
      .filter((d) => d !== ".")
  );

  // ── Empty notes ───────────────────────────────────────────────────────────
  const emptyNotes = notes
    .filter((n) => n.content.trim().length === 0)
    .map((n) => n.name + ".md");

  // ── Total words ───────────────────────────────────────────────────────────
  const totalWords = notes.reduce((sum, n) => sum + n.words, 0);

  return {
    totalNotes: notes.length,
    totalFolders: uniqueDirs.size,
    totalWords,
    orphans,
    brokenLinks: [...brokenSet].sort(),
    recentlyModified,
    topTags,
    folderSizes,
    emptyNotes,
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
    const stats = computeVaultStats(vaultPath);
    return NextResponse.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
