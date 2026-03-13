import { Index } from "@upstash/vector";

// ---------------------------------------------------------------------------
// Upstash Vector wrapper — replaces Vectra LocalIndex
// ---------------------------------------------------------------------------

export interface VectorMetadata {
  [key: string]: unknown;
  path: string;
  name: string;
  chunk: number;
  text: string;
  tags: string[];
}

let vectorIndex: Index<VectorMetadata> | null = null;

function getIndex(): Index<VectorMetadata> {
  if (!vectorIndex) {
    vectorIndex = new Index<VectorMetadata>({
      url: process.env.UPSTASH_VECTOR_REST_URL!,
      token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
    });
  }
  return vectorIndex;
}

/**
 * Check if the vector index has any items.
 */
export async function indexHasItems(): Promise<boolean> {
  try {
    const info = await getIndex().info();
    return info.vectorCount > 0;
  } catch {
    return false;
  }
}

/**
 * Upsert vectors into the index. Each vector gets an ID like "path#chunk0".
 */
export async function upsertVectors(
  items: Array<{
    id: string;
    vector: number[];
    metadata: VectorMetadata;
  }>
): Promise<void> {
  if (items.length === 0) return;

  // Upstash Vector supports batch upsert up to 1000 at a time
  const BATCH_SIZE = 1000;
  const index = getIndex();

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    await index.upsert(batch);
  }
}

/**
 * Query the vector index with a pre-computed embedding.
 */
export async function queryVectors(
  vector: number[],
  topK = 6
): Promise<Array<{ id: string; score: number; metadata: VectorMetadata }>> {
  const results = await getIndex().query<VectorMetadata>({
    vector,
    topK,
    includeMetadata: true,
    includeVectors: false,
  });

  return results
    .filter((r) => r.metadata != null)
    .map((r) => ({
      id: r.id as string,
      score: r.score,
      metadata: r.metadata!,
    }));
}

/**
 * Delete vectors by their IDs.
 */
export async function deleteVectors(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await getIndex().delete(ids);
}

/**
 * Delete all vectors matching a given path (all chunks of a note).
 * Uses range + filter to find matching IDs, then deletes them.
 */
export async function deleteVectorsByPath(notePath: string): Promise<void> {
  // Escape single quotes to prevent filter injection
  const safePath = notePath.replace(/'/g, "\\'");
  const results = await getIndex().query<VectorMetadata>({
    vector: new Array(1024).fill(0), // dummy vector
    topK: 1000,
    filter: `path = '${safePath}'`,
    includeMetadata: false,
  });

  const ids = results.map((r) => r.id as string);
  if (ids.length > 0) {
    await deleteVectors(ids);
  }
}

/**
 * Reset the entire index (delete all vectors).
 */
export async function resetIndex(): Promise<void> {
  await getIndex().reset();
}

/**
 * Fetch all vectors with metadata (paginated). Used by clusters and links.
 */
export async function fetchAllVectors(): Promise<
  Array<{ id: string; vector: number[]; metadata: VectorMetadata }>
> {
  const index = getIndex();
  const all: Array<{ id: string; vector: number[]; metadata: VectorMetadata }> = [];

  let cursor = "0";
  do {
    const result = await index.range<VectorMetadata>({
      cursor,
      limit: 1000,
      includeMetadata: true,
      includeVectors: true,
    });

    for (const item of result.vectors) {
      if (item.metadata && item.vector) {
        all.push({
          id: item.id as string,
          vector: item.vector,
          metadata: item.metadata,
        });
      }
    }

    cursor = result.nextCursor;
  } while (cursor !== "0" && cursor !== "");

  return all;
}

/**
 * Get index info (vector count, dimension, etc).
 */
export async function getIndexInfo(): Promise<{ vectorCount: number }> {
  const info = await getIndex().info();
  return { vectorCount: info.vectorCount };
}
