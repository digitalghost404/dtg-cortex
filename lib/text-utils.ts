/**
 * Shared text-processing utilities used by sync, indexer, and vault.
 *
 * Keep this file free of side-effects and external dependencies so it can be
 * imported from any execution context (Edge, Node, scripts).
 */

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 500; // words per chunk
const CHUNK_OVERLAP = 50;

/**
 * Split `text` into overlapping word-level chunks suitable for embedding.
 * Chunks are at most CHUNK_SIZE words with a CHUNK_OVERLAP word overlap.
 */
export function chunkText(text: string): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
    if (chunk.trim().length > 0) chunks.push(chunk);
    if (i + CHUNK_SIZE >= words.length) break;
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Tag normalisation
// ---------------------------------------------------------------------------

/**
 * Ensure a tag value starts with "#". Trims surrounding whitespace.
 */
export function normaliseTag(raw: unknown): string {
  const s = String(raw).trim();
  return s.startsWith("#") ? s : `#${s}`;
}

/**
 * Extract tags from a frontmatter data object. Handles the common field
 * aliases used across the vault (tags / tag / Topics / topics) and both
 * array and space-or-comma-delimited string forms.
 */
export function extractTags(data: Record<string, unknown>): string[] {
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

// ---------------------------------------------------------------------------
// Wikilink parsing
// ---------------------------------------------------------------------------

/**
 * Given the raw content of a `[[...]]` wikilink, return the target note name,
 * stripping any display text (`|`) or heading anchors (`#`).
 */
export function wikilinkTarget(raw: string): string {
  return raw.split(/[|#]/)[0].trim();
}

// ---------------------------------------------------------------------------
// Word count
// ---------------------------------------------------------------------------

/**
 * Count the number of whitespace-delimited words in `text`.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
