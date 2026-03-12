import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultDNA {
  noteCount: number;
  totalWords: number;
  linkDensity: number;     // avg outgoing links per note, normalized 0-1
  topicSpread: number;     // unique top-level folders / total notes, normalized 0-1
  tagDiversity: number;    // unique tags / total notes, normalized 0-1
  avgNoteLength: number;   // avg words per note, normalized 0-1
  activityScore: number;   // notes modified in last 7 days / total notes
  // Raw values for color generation
  topFolders: string[];    // top 5 folder names
  topTags: string[];       // top 5 tags
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
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

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Clamp a value to [0, 1]. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Normalize a raw value using a soft sigmoid-like curve so we never get
 * stuck at exactly 0 or 1.  `midpoint` is the raw value that maps to ~0.5.
 */
function softNorm(value: number, midpoint: number): number {
  if (midpoint <= 0) return clamp01(value);
  return clamp01(value / (value + midpoint));
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

function computeVaultDNA(vaultPath: string): VaultDNA {
  const allPaths = collectMarkdownFiles(vaultPath);
  const noteCount = allPaths.length;

  if (noteCount === 0) {
    return {
      noteCount: 0,
      totalWords: 0,
      linkDensity: 0,
      topicSpread: 0,
      tagDiversity: 0,
      avgNoteLength: 0,
      activityScore: 0,
      topFolders: [],
      topTags: [],
    };
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let totalWords = 0;
  let totalLinks = 0;
  let recentCount = 0;

  const tagCounts = new Map<string, number>();
  const folderCounts = new Map<string, number>();
  // Top-level folder = first path component under vault root
  const topLevelFolders = new Set<string>();

  for (const fullPath of allPaths) {
    let raw: string;
    try {
      raw = fs.readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }

    const { data, content } = matter(raw);
    const words = countWords(content);
    totalWords += words;

    // Count wikilinks in content
    const re = new RegExp(WIKILINK_RE.source, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      totalLinks++;
    }

    // Tags
    for (const tag of extractTags(data as Record<string, unknown>)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    // Folder tracking
    const relativePath = path.relative(vaultPath, fullPath);
    const parts = relativePath.split(path.sep);
    const topLevel = parts.length > 1 ? parts[0] : "(root)";
    topLevelFolders.add(topLevel);

    // All folder depths for folderCounts
    const folder = path.dirname(relativePath) === "." ? "(root)" : path.dirname(relativePath);
    folderCounts.set(folder, (folderCounts.get(folder) ?? 0) + 1);

    // Activity
    try {
      const stat = fs.statSync(fullPath);
      if (stat.mtime.getTime() > sevenDaysAgo) {
        recentCount++;
      }
    } catch {
      // ignore
    }
  }

  // ── Derived metrics ────────────────────────────────────────────────────────

  const avgLinks = totalLinks / noteCount;
  // Typical vault: 2-5 links/note → midpoint at 3
  const linkDensity = softNorm(avgLinks, 3);

  // More top-level folders relative to note count = higher spread
  // Typical: 1 folder per 5-10 notes → midpoint at 0.15
  const rawTopicSpread = topLevelFolders.size / noteCount;
  const topicSpread = softNorm(rawTopicSpread, 0.15);

  // Tags diversity: unique tags / notes
  // Typical: 0.5-1 unique tag per note → midpoint at 0.3
  const rawTagDiv = tagCounts.size / noteCount;
  const tagDiversity = softNorm(rawTagDiv, 0.3);

  // Avg note length in words, normalized — midpoint at 200 words
  const avgNoteLengthRaw = totalWords / noteCount;
  const avgNoteLength = softNorm(avgNoteLengthRaw, 200);

  // Activity score: fraction of notes touched in last 7 days
  const activityScore = clamp01(recentCount / noteCount);

  // ── Top folders / tags ────────────────────────────────────────────────────

  const topFolders = [...folderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([folder]) => folder);

  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  return {
    noteCount,
    totalWords,
    linkDensity,
    topicSpread,
    tagDiversity,
    avgNoteLength,
    activityScore,
    topFolders,
    topTags,
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
    const dna = computeVaultDNA(vaultPath);
    return NextResponse.json(dna, {
      headers: {
        // Cache for 5 minutes — vault metrics don't change per-request
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
