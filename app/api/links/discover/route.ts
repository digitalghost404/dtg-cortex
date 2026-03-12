import { NextRequest, NextResponse } from "next/server";
import { getAllNotes } from "@/lib/vault";
import { fetchAllVectors, indexHasItems } from "@/lib/vector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
// Wikilink extraction
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
// Route handler
// ---------------------------------------------------------------------------

const SIMILARITY_THRESHOLD = 0.75;
const DEFAULT_TOP_N = 20;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawTopN = searchParams.get("topN");
  const topN =
    rawTopN && Number.isFinite(Number(rawTopN)) && Number(rawTopN) > 0
      ? Math.min(Number(rawTopN), 100)
      : DEFAULT_TOP_N;

  try {
    const hasItems = await indexHasItems();
    if (!hasItems) {
      return NextResponse.json(
        { error: "Vector index not found. Run /api/index to build it first." },
        { status: 404 }
      );
    }

    const items = await fetchAllVectors();

    if (items.length === 0) {
      return NextResponse.json({ suggestions: [] } satisfies DiscoverResponse);
    }

    // Group chunk vectors by note name
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

    // Build wikilink adjacency from vault notes
    const vaultNotes = await getAllNotes();
    const outgoing = new Map<string, Set<string>>();
    for (const note of vaultNotes) {
      outgoing.set(note.name.toLowerCase(), extractWikilinks(note.content));
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

    suggestions.sort((a, b) => b.similarity - a.similarity);
    const top = suggestions.slice(0, topN);

    return NextResponse.json({ suggestions: top } satisfies DiscoverResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
