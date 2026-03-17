// ---------------------------------------------------------------------------
// Memory Echoes — detect when a new query is similar to a past query
// Uses vector similarity on the lineage:entries query history.
// ---------------------------------------------------------------------------

import { loadLineage } from "./lineage";

// We embed via the Voyage API (same as indexer.ts)
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY!;
const ECHO_THRESHOLD = 0.8;
const MAX_PAST_QUERIES = 100;

export interface MemoryEchoMatch {
  previousQuery: string;
  daysAgo: number;
  similarity: number;
  timestamp: string;
}

async function embedText(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: [text], model: "voyage-3" }),
  });

  if (!res.ok) {
    throw new Error(`Voyage AI error: ${res.status}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

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

/**
 * Search past queries for one that is semantically similar to the given query.
 * Returns the best match above threshold, or null if none found.
 */
export async function findEcho(query: string): Promise<MemoryEchoMatch | null> {
  const store = await loadLineage();
  if (store.entries.length === 0) return null;

  // Get recent past queries (skip duplicates)
  const seen = new Set<string>();
  const pastQueries: Array<{ query: string; timestamp: string }> = [];

  // Iterate newest-first
  const sorted = [...store.entries].sort(
    (a, b) => b.timestamp.localeCompare(a.timestamp)
  );

  for (const entry of sorted) {
    const normalized = entry.query.trim().toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    pastQueries.push({ query: entry.query, timestamp: entry.timestamp });
    if (pastQueries.length >= MAX_PAST_QUERIES) break;
  }

  /* v8 ignore next 2 -- defensive guard; structurally unreachable when entries.length > 0 */
  if (pastQueries.length === 0) return null;

  // Embed the new query
  const queryVec = await embedText(query);

  // Embed all past queries in one batch for efficiency
  const batchRes = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({
      input: pastQueries.map((pq) => pq.query),
      model: "voyage-3",
    }),
  });

  if (!batchRes.ok) {
    throw new Error(`Voyage AI batch error: ${batchRes.status}`);
  }

  const batchJson = (await batchRes.json()) as {
    data: { embedding: number[] }[];
  };

  // Find best match
  let bestMatch: MemoryEchoMatch | null = null;
  let bestSim = ECHO_THRESHOLD;

  for (let i = 0; i < pastQueries.length; i++) {
    const sim = cosineSimilarity(queryVec, batchJson.data[i].embedding);
    // Skip exact same query (sim ≈ 1.0)
    if (sim > 0.98) continue;
    if (sim > bestSim) {
      bestSim = sim;
      const daysAgo = Math.floor(
        (Date.now() - new Date(pastQueries[i].timestamp).getTime()) / 86_400_000
      );
      bestMatch = {
        previousQuery: pastQueries[i].query,
        daysAgo,
        similarity: sim,
        timestamp: pastQueries[i].timestamp,
      };
    }
  }

  return bestMatch;
}
