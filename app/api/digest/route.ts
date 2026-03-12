import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { LocalIndex } from "vectra";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChunkMetadata = Record<string, import("vectra").MetadataTypes>;

export interface DigestSection {
  type: "changes" | "connections" | "forgotten" | "questions" | "stats";
  title: string;
  items: Array<{ text: string; meta?: string }>;
}

export interface DigestResponse {
  generatedAt: string;
  sections: DigestSection[];
}

// ---------------------------------------------------------------------------
// Math helpers (mirrored from links/discover)
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i] += v[i];
    }
  }
  return sum.map((x) => x / vectors.length);
}

// ---------------------------------------------------------------------------
// Wikilink extraction (mirrored from links/discover)
// ---------------------------------------------------------------------------

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function extractWikilinks(content: string): Set<string> {
  const targets = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, "g");
  while ((match = re.exec(content)) !== null) {
    const raw = match[1];
    const target = raw.split(/[|#]/)[0].trim();
    if (target) targets.add(target.toLowerCase());
  }
  return targets;
}

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

interface VaultFile {
  /** Relative path from vault root, e.g. "folder/note.md" */
  relPath: string;
  /** Base name without extension */
  name: string;
  /** Full absolute path */
  absPath: string;
  mtimeMs: number;
  content: string;
  wordCount: number;
  /** Tags extracted from frontmatter */
  tags: string[];
  /** Folders in the path (all but last segment) */
  folder: string;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function collectMarkdownFiles(vaultPath: string): VaultFile[] {
  const results: VaultFile[] = [];

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        let stat: fs.Stats;
        try {
          stat = fs.statSync(absPath);
        } catch {
          continue;
        }
        let raw = "";
        try {
          raw = fs.readFileSync(absPath, "utf-8");
        } catch {
          continue;
        }
        const parsed = matter(raw);
        const body = parsed.content;
        const frontmatterTags: string[] = (() => {
          const t = parsed.data?.tags;
          if (Array.isArray(t)) return t.map(String);
          if (typeof t === "string") return [t];
          return [];
        })();

        const relPath = path.relative(vaultPath, absPath);
        const name = path.basename(entry.name, ".md");
        const folder = path.dirname(relPath) === "." ? "" : path.dirname(relPath);

        results.push({
          relPath,
          name,
          absPath,
          mtimeMs: stat.mtimeMs,
          content: body,
          wordCount: countWords(body),
          tags: frontmatterTags,
          folder,
        });
      }
    }
  }

  walk(vaultPath);
  return results;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const THIRTY_DAYS_MS = 30 * DAY_MS;

function buildChangesSection(files: VaultFile[], now: number): DigestSection {
  const recent = files
    .filter((f) => now - f.mtimeMs <= SEVEN_DAYS_MS)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  const items = recent.map((f) => {
    const daysAgo = Math.floor((now - f.mtimeMs) / DAY_MS);
    const when =
      daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`;
    return {
      text: f.name,
      meta: `${when} · ${f.wordCount} words · ${f.relPath}`,
    };
  });

  return {
    type: "changes",
    title: "RECENT CHANGES",
    items,
  };
}

function buildForgottenSection(files: VaultFile[], now: number): DigestSection {
  const forgotten = files
    .filter((f) => now - f.mtimeMs > THIRTY_DAYS_MS)
    .sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first

  const items = forgotten.slice(0, 10).map((f) => {
    const daysAgo = Math.floor((now - f.mtimeMs) / DAY_MS);
    return {
      text: f.name,
      meta: `${daysAgo}d since last edit · ${f.relPath}`,
    };
  });

  return {
    type: "forgotten",
    title: "FORGOTTEN NOTES",
    items,
  };
}

const INDEX_PATH = path.join(process.cwd(), ".cortex-index");
const SIMILARITY_THRESHOLD = 0.75;
const DIGEST_TOP_CONNECTIONS = 5;

async function buildConnectionsSection(
  vaultPath: string,
  files: VaultFile[]
): Promise<DigestSection> {
  const emptySection: DigestSection = {
    type: "connections",
    title: "MISSING CONNECTIONS",
    items: [],
  };

  const index = new LocalIndex<ChunkMetadata>(INDEX_PATH);
  if (!(await index.isIndexCreated())) return emptySection;

  const items = await index.listItems<ChunkMetadata>();
  if (items.length === 0) return emptySection;

  // Build note → average vector map
  const noteMap = new Map<
    string,
    { name: string; path: string; vectors: number[][] }
  >();

  for (const item of items) {
    const { name, path: notePath } = item.metadata;
    if (typeof name !== "string" || typeof notePath !== "string") continue;
    const key = name.toLowerCase();
    if (!noteMap.has(key)) {
      noteMap.set(key, { name, path: notePath, vectors: [] });
    }
    noteMap.get(key)!.vectors.push(item.vector);
  }

  const notes = [...noteMap.values()].map((entry) => ({
    name: entry.name,
    path: entry.path,
    avgVector: averageVectors(entry.vectors),
  }));

  // Build wikilink adjacency
  const outgoing = new Map<string, Set<string>>();
  for (const note of notes) {
    const fullPath = path.join(vaultPath, note.path);
    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      // missing from disk
    }
    outgoing.set(note.name.toLowerCase(), extractWikilinks(content));
  }

  function hasLink(nameA: string, nameB: string): boolean {
    const lA = nameA.toLowerCase();
    const lB = nameB.toLowerCase();
    const fromA = outgoing.get(lA);
    const fromB = outgoing.get(lB);
    return !!(
      (fromA && fromA.has(lB)) ||
      (fromB && fromB.has(lA))
    );
  }

  // Pairwise cosine similarity
  const suggestions: Array<{
    noteA: string;
    noteB: string;
    similarity: number;
    pathA: string;
    pathB: string;
  }> = [];

  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const noteA = notes[i];
      const noteB = notes[j];
      if (noteA.avgVector.length === 0 || noteB.avgVector.length === 0) continue;

      const sim = cosineSimilarity(noteA.avgVector, noteB.avgVector);
      if (sim <= SIMILARITY_THRESHOLD) continue;
      if (hasLink(noteA.name, noteB.name)) continue;

      suggestions.push({
        noteA: noteA.name,
        noteB: noteB.name,
        similarity: sim,
        pathA: noteA.path,
        pathB: noteB.path,
      });
    }
  }

  suggestions.sort((a, b) => b.similarity - a.similarity);
  const top = suggestions.slice(0, DIGEST_TOP_CONNECTIONS);

  const sectionItems = top.map((s) => ({
    text: `${s.noteA} ←→ ${s.noteB}`,
    meta: JSON.stringify({
      similarity: s.similarity,
      pathA: s.pathA,
      pathB: s.pathB,
      noteA: s.noteA,
      noteB: s.noteB,
    }),
  }));

  return {
    type: "connections",
    title: "MISSING CONNECTIONS",
    items: sectionItems,
  };
}

function buildQuestionsSection(files: VaultFile[]): DigestSection {
  // Collect tag frequency
  const tagCount = new Map<string, number>();
  for (const f of files) {
    for (const tag of f.tags) {
      const t = tag.toLowerCase().trim();
      if (t) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
  }

  // Collect word-based "topic" proxies from note names
  // (normalise to lowercase single tokens)
  const allNames = files.map((f) => f.name.toLowerCase());

  // Sort tags by frequency (descending)
  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag);

  const questions: string[] = [];

  // Heuristic 1: notes with same tag but no wikilinks between them
  if (topTags.length >= 2) {
    const [tagA, tagB] = topTags;
    const countA = tagCount.get(tagA) ?? 0;
    const countB = tagCount.get(tagB) ?? 0;
    questions.push(
      `You have ${countA} notes tagged "${tagA}" and ${countB} tagged "${tagB}" — what is the relationship between these two themes?`
    );
  }

  // Heuristic 2: tag with many notes but no "synthesis" note (no note named after the tag)
  for (const [tag, count] of tagCount.entries()) {
    if (count >= 3 && !allNames.includes(tag) && !allNames.includes(tag + "s")) {
      questions.push(
        `You have ${count} notes about "${tag}" but no dedicated overview note — what would a synthesis of these notes look like?`
      );
      if (questions.length >= 4) break;
    }
  }

  // Heuristic 3: forgotten notes with interesting names
  const forgotten = files.filter(
    (f) => Date.now() - f.mtimeMs > THIRTY_DAYS_MS
  );
  if (forgotten.length > 0) {
    const oldest = forgotten.sort((a, b) => a.mtimeMs - b.mtimeMs)[0];
    questions.push(
      `"${oldest.name}" hasn't been touched in over ${Math.floor((Date.now() - oldest.mtimeMs) / DAY_MS)} days — is it still relevant, or does it need to be updated or archived?`
    );
  }

  // Heuristic 4: folder with the most notes but no "index" or "readme"
  const folderCount = new Map<string, number>();
  for (const f of files) {
    if (f.folder) {
      folderCount.set(f.folder, (folderCount.get(f.folder) ?? 0) + 1);
    }
  }
  if (folderCount.size > 0) {
    const [busyFolder, count] = [...folderCount.entries()].sort(
      (a, b) => b[1] - a[1]
    )[0];
    const hasIndex = files.some(
      (f) =>
        f.folder === busyFolder &&
        (f.name.toLowerCase() === "index" ||
          f.name.toLowerCase() === "readme" ||
          f.name.toLowerCase() === "_index")
    );
    if (!hasIndex) {
      questions.push(
        `The folder "${busyFolder}" has ${count} notes but no index — what overarching theme ties these notes together?`
      );
    }
  }

  // Heuristic 5: no connections between the two most-edited files
  const topTwo = [...files]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 2);
  if (topTwo.length === 2) {
    questions.push(
      `Your two most recently active notes are "${topTwo[0].name}" and "${topTwo[1].name}" — are there hidden connections worth exploring?`
    );
  }

  // Cap at 5 and ensure we have at least a default
  if (questions.length === 0) {
    questions.push(
      "What recurring theme appears across your notes that you haven't explicitly written about yet?"
    );
  }

  return {
    type: "questions",
    title: "SUGGESTED QUESTIONS",
    items: questions.slice(0, 5).map((q) => ({ text: q })),
  };
}

function buildStatsSection(files: VaultFile[], now: number): DigestSection {
  const totalNotes = files.length;
  const totalWords = files.reduce((sum, f) => sum + f.wordCount, 0);
  const notesThisWeek = files.filter(
    (f) => now - f.mtimeMs <= SEVEN_DAYS_MS
  ).length;

  // Most active folder (by count)
  const folderCount = new Map<string, number>();
  for (const f of files) {
    const folder = f.folder || "(root)";
    folderCount.set(folder, (folderCount.get(folder) ?? 0) + 1);
  }
  const mostActiveFolder =
    folderCount.size > 0
      ? [...folderCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : "(root)";

  return {
    type: "stats",
    title: "VAULT STATS",
    items: [
      { text: "Total notes", meta: String(totalNotes) },
      { text: "Total words", meta: totalWords.toLocaleString() },
      { text: "Modified this week", meta: String(notesThisWeek) },
      { text: "Most active folder", meta: mostActiveFolder },
    ],
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

  const now = Date.now();
  const files = collectMarkdownFiles(vaultPath);

  const [connectionsSection] = await Promise.all([
    buildConnectionsSection(vaultPath, files),
  ]);

  const sections: DigestSection[] = [
    buildStatsSection(files, now),
    buildChangesSection(files, now),
    connectionsSection,
    buildForgottenSection(files, now),
    buildQuestionsSection(files),
  ];

  const response: DigestResponse = {
    generatedAt: new Date().toISOString(),
    sections,
  };

  return NextResponse.json(response);
}
