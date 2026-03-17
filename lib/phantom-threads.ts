// ---------------------------------------------------------------------------
// Phantom Threads — high-similarity unlinked note pairs
// ---------------------------------------------------------------------------

import { fetchAllVectors, type VectorMetadata } from "./vector";
import { getAllNotes } from "./vault";
import { getJSON, setJSON } from "./kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhantomThread {
  sourceNotePath: string;
  sourceNoteName: string;
  targetNotePath: string;
  targetNoteName: string;
  similarity: number;
}

const CACHE_KEY = "cortex:phantom-threads";
const CACHE_TS_KEY = "cortex:phantom-threads:computedAt";
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours
const SIMILARITY_THRESHOLD = 0.7;
const MAX_PHANTOMS = 20;

// ---------------------------------------------------------------------------
// Cosine similarity
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
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Compute phantom threads
// ---------------------------------------------------------------------------

export async function computePhantomThreads(): Promise<PhantomThread[]> {
  // Fetch all vectors and group by note path
  const allVectors = await fetchAllVectors();
  const noteVectors = new Map<string, { name: string; vectors: number[][] }>();

  for (const v of allVectors) {
    const existing = noteVectors.get(v.metadata.path);
    if (existing) {
      existing.vectors.push(v.vector);
    } else {
      noteVectors.set(v.metadata.path, {
        name: v.metadata.name,
        vectors: [v.vector],
      });
    }
  }

  // Average chunk vectors per note
  const noteAverages = new Map<string, { name: string; avg: number[] }>();
  for (const [path, { name, vectors }] of noteVectors.entries()) {
    /* v8 ignore next */
    if (vectors.length === 0) continue;
    const dim = vectors[0].length;
    const avg = new Array<number>(dim).fill(0);
    for (const vec of vectors) {
      for (let i = 0; i < dim; i++) {
        avg[i] += vec[i];
      }
    }
    for (let i = 0; i < dim; i++) {
      avg[i] /= vectors.length;
    }
    noteAverages.set(path, { name, avg });
  }

  // Get outgoing links for all notes
  const notes = await getAllNotes();
  const outgoingMap = new Map<string, Set<string>>();
  const nameToPath = new Map<string, string>();
  for (const note of notes) {
    outgoingMap.set(note.path, new Set(note.outgoing));
    nameToPath.set(note.name, note.path);
  }

  // Check if two notes are linked
  /* v8 ignore start — defensive null coalescing; notes always exist in both maps during normal operation */
  function areLinked(pathA: string, pathB: string): boolean {
    const nameA = noteAverages.get(pathA)?.name ?? "";
    const nameB = noteAverages.get(pathB)?.name ?? "";
    const outA = outgoingMap.get(pathA);
    const outB = outgoingMap.get(pathB);
    return (
      (outA?.has(nameB) ?? false) ||
      (outB?.has(nameA) ?? false)
    );
  }
  /* v8 ignore stop */

  // Compute all pairs
  const paths = Array.from(noteAverages.keys());
  const candidates: PhantomThread[] = [];

  for (let i = 0; i < paths.length; i++) {
    for (let j = i + 1; j < paths.length; j++) {
      const pathA = paths[i];
      const pathB = paths[j];

      if (areLinked(pathA, pathB)) continue;

      const a = noteAverages.get(pathA)!;
      const b = noteAverages.get(pathB)!;
      const sim = cosineSimilarity(a.avg, b.avg);

      if (sim > SIMILARITY_THRESHOLD) {
        candidates.push({
          sourceNotePath: pathA,
          sourceNoteName: a.name,
          targetNotePath: pathB,
          targetNoteName: b.name,
          similarity: sim,
        });
      }
    }
  }

  // Sort by similarity descending, take top N
  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, MAX_PHANTOMS);
}

// ---------------------------------------------------------------------------
// Cached access
// ---------------------------------------------------------------------------

export async function getPhantomThreads(forceRecompute = false): Promise<PhantomThread[]> {
  if (!forceRecompute) {
    const computedAt = await getJSON<string>(CACHE_TS_KEY);
    if (computedAt && Date.now() - new Date(computedAt).getTime() < STALE_MS) {
      const cached = await getJSON<PhantomThread[]>(CACHE_KEY);
      if (cached) return cached;
    }
  }

  const threads = await computePhantomThreads();
  await setJSON(CACHE_KEY, threads);
  await setJSON(CACHE_TS_KEY, new Date().toISOString());
  return threads;
}

export async function removePhantomThread(
  sourcePath: string,
  targetPath: string
): Promise<void> {
  const cached = await getJSON<PhantomThread[]>(CACHE_KEY);
  if (!cached) return;
  const updated = cached.filter(
    (t) =>
      !(
        (t.sourceNotePath === sourcePath && t.targetNotePath === targetPath) ||
        (t.sourceNotePath === targetPath && t.targetNotePath === sourcePath)
      )
  );
  await setJSON(CACHE_KEY, updated);
}
