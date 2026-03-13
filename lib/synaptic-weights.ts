// ---------------------------------------------------------------------------
// Synaptic Strengthening — edge co-occurrence weights
// Notes that appear together in queries, outgoing links, and phantom threads
// build "synaptic weight" over time.
// ---------------------------------------------------------------------------

import { getAllNotes } from "./vault";
import { getJSON, setJSON } from "./kv";
import { loadLineage } from "./lineage";

const CACHE_KEY = "cortex:synaptic-weights";
const CACHE_TS_KEY = "cortex:synaptic-weights:computedAt";
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

function edgeKey(pathA: string, pathB: string): string {
  return pathA < pathB ? `${pathA}::${pathB}` : `${pathB}::${pathA}`;
}

/**
 * Compute synaptic weights for all note pairs based on co-occurrences:
 * - +1 for each direct wikilink between them
 * - +0.5 for each lineage entry mentioning both
 * Returns a map from edge key to normalized weight (0-1).
 */
export async function computeSynapticWeights(): Promise<Record<string, number>> {
  const [notes, lineageStore] = await Promise.all([
    getAllNotes(),
    loadLineage(),
  ]);

  const rawWeights = new Map<string, number>();

  // Build name→path lookup
  const nameToPath = new Map<string, string>();
  for (const note of notes) {
    nameToPath.set(note.name, note.path);
  }

  // Count wikilink connections (+1 per link)
  for (const note of notes) {
    for (const target of note.outgoing) {
      const targetPath = nameToPath.get(target);
      if (targetPath && targetPath !== note.path) {
        const key = edgeKey(note.path, targetPath);
        rawWeights.set(key, (rawWeights.get(key) ?? 0) + 1);
      }
    }
  }

  // Count lineage co-occurrences (+0.5 per shared query)
  for (const entry of lineageStore.entries) {
    const paths = entry.sourceNotes.map((sn) => sn.path);
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const key = edgeKey(paths[i], paths[j]);
        rawWeights.set(key, (rawWeights.get(key) ?? 0) + 0.5);
      }
    }
  }

  // Normalize to 0-1 range
  const maxWeight = Math.max(1, ...rawWeights.values());
  const normalized: Record<string, number> = {};
  for (const [key, weight] of rawWeights) {
    normalized[key] = Math.min(1, weight / maxWeight);
  }

  return normalized;
}

/**
 * Get synaptic weights with 24h caching (same pattern as phantom threads).
 */
export async function getSynapticWeights(
  forceRecompute = false
): Promise<Record<string, number>> {
  if (!forceRecompute) {
    const computedAt = await getJSON<string>(CACHE_TS_KEY);
    if (computedAt && Date.now() - new Date(computedAt).getTime() < STALE_MS) {
      const cached = await getJSON<Record<string, number>>(CACHE_KEY);
      if (cached) return cached;
    }
  }

  const weights = await computeSynapticWeights();
  await setJSON(CACHE_KEY, weights);
  await setJSON(CACHE_TS_KEY, new Date().toISOString());
  return weights;
}
