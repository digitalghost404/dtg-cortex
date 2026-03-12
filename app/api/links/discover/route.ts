import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { LocalIndex } from "vectra";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Vectra's MetadataTypes is `number | string | boolean` — no arrays.
// We use the unconstrained Record form and cast when reading individual fields.
type ChunkMetadata = Record<string, import("vectra").MetadataTypes>;

export interface DiscoverSuggestion {
  noteA: string;
  noteB: string;
  similarity: number;
  pathA: string;
  pathB: string;
}

export interface DiscoverResponse {
  suggestions: DiscoverSuggestion[];
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/**
 * Compute the cosine similarity between two equal-length vectors.
 * Returns a value in [-1, 1]. Returns 0 if either vector has zero magnitude.
 */
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

/**
 * Compute the element-wise average of a list of vectors.
 * All vectors must have the same length. Returns a zero vector if the list is
 * empty.
 */
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
// Wikilink extraction
// ---------------------------------------------------------------------------

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Extract the set of note names that a markdown file links to via [[wikilinks]].
 * Strips aliases ([[Target|Alias]] → "Target") and heading anchors
 * ([[Target#Heading]] → "Target"). Returns lowercase names for case-insensitive
 * comparison.
 */
function extractWikilinks(content: string): Set<string> {
  const targets = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, "g");

  while ((match = re.exec(content)) !== null) {
    const raw = match[1];
    // Strip alias and heading: "Note#Heading|Alias" → "Note"
    const target = raw.split(/[|#]/)[0].trim();
    if (target) targets.add(target.toLowerCase());
  }

  return targets;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

const INDEX_PATH = path.join(process.cwd(), ".cortex-index");
const SIMILARITY_THRESHOLD = 0.75;
const DEFAULT_TOP_N = 20;

export async function GET(req: NextRequest) {
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

  const { searchParams } = new URL(req.url);
  const rawTopN = searchParams.get("topN");
  const topN =
    rawTopN && Number.isFinite(Number(rawTopN)) && Number(rawTopN) > 0
      ? Math.min(Number(rawTopN), 100)
      : DEFAULT_TOP_N;

  // ── Load all index items ──────────────────────────────────────────────────

  const index = new LocalIndex<ChunkMetadata>(INDEX_PATH);

  if (!(await index.isIndexCreated())) {
    return NextResponse.json(
      { error: "Vector index not found. Run /api/index to build it first." },
      { status: 404 }
    );
  }

  const items = await index.listItems<ChunkMetadata>();

  if (items.length === 0) {
    return NextResponse.json({ suggestions: [] } satisfies DiscoverResponse);
  }

  // ── Group chunk vectors by note name ─────────────────────────────────────
  // Key: note name (lowercase for deduplication), Value: { vectors, path }
  // We use the first path encountered as canonical for each note.

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

  // ── Compute per-note average embedding ───────────────────────────────────

  const notes = [...noteMap.values()].map((entry) => ({
    name: entry.name,
    path: entry.path,
    avgVector: averageVectors(entry.vectors),
  }));

  // ── Build wikilink adjacency: which notes does each note link to? ─────────
  // Read each markdown file and collect outgoing wikilinks (lowercase names).

  const outgoing = new Map<string, Set<string>>(); // name.lower → Set<name.lower>

  for (const note of notes) {
    const fullPath = path.join(vaultPath, note.path);
    let content = "";
    try {
      content = fs.readFileSync(fullPath, "utf-8");
    } catch {
      // File missing from disk but still in index — skip
    }
    outgoing.set(note.name.toLowerCase(), extractWikilinks(content));
  }

  /**
   * Returns true when noteA already links to noteB OR noteB links to noteA.
   */
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

  // ── Pairwise cosine similarity ────────────────────────────────────────────

  const suggestions: DiscoverSuggestion[] = [];

  for (let i = 0; i < notes.length; i++) {
    for (let j = i + 1; j < notes.length; j++) {
      const noteA = notes[i];
      const noteB = notes[j];

      if (noteA.avgVector.length === 0 || noteB.avgVector.length === 0) {
        continue;
      }

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

  // ── Sort by similarity descending and take top N ──────────────────────────

  suggestions.sort((a, b) => b.similarity - a.similarity);
  const top = suggestions.slice(0, topN);

  return NextResponse.json({ suggestions: top } satisfies DiscoverResponse);
}
