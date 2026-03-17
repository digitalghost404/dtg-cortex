/**
 * Core sync logic — importable by both scripts/sync.ts and app/api/sync/route.ts
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";
import { Redis } from "@upstash/redis";
import { Index } from "@upstash/vector";
import { saveScar } from "./scars";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;
const EMBED_BATCH_SIZE = 20;

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  unchanged: number;
  vectorsUpserted: number;
  pendingWritten: number;
  totalNotes: number;
  totalWords: number;
}

interface VectorMetadata {
  [key: string]: unknown;
  path: string;
  name: string;
  chunk: number;
  text: string;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function md5(content: string): string {
  return crypto.createHash("md5").update(content).digest("hex");
}

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

/* v8 ignore start — internal helper; edge branches tested via sync-helpers.test.ts */
function chunkText(text: string): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
    if (chunk.trim().length > 0) chunks.push(chunk);
    if (i + CHUNK_SIZE >= words.length) break;
  }
  return chunks;
}
/* v8 ignore stop */

function normaliseTag(raw: unknown): string {
  const s = String(raw).trim();
  return s.startsWith("#") ? s : `#${s}`;
}

/* v8 ignore start — internal helpers; edge branches tested via sync-helpers.test.ts */
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

function wikilinkTarget(raw: string): string {
  return raw.split(/[|#]/)[0].trim();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}
/* v8 ignore stop */

async function embedTexts(inputs: string[], voyageApiKey: string): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${voyageApiKey}`,
    },
    body: JSON.stringify({ input: inputs, model: "voyage-3" }),
  });
  if (!res.ok) {
    throw new Error(`Voyage AI error: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

export async function runSync(): Promise<SyncResult> {
  const VAULT_PATH = process.env.VAULT_PATH;
  const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

  if (!VAULT_PATH) throw new Error("VAULT_PATH is not set");
  if (!process.env.KV_REST_API_URL) throw new Error("KV_REST_API_URL is not set");

  const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  });

  const vectorIndex = new Index<VectorMetadata>({
    url: process.env.UPSTASH_VECTOR_REST_URL!,
    token: process.env.UPSTASH_VECTOR_REST_TOKEN!,
  });

  const files = collectMarkdownFiles(VAULT_PATH);
  const existingPaths = (await redis.smembers("vault:notes:index")) as string[];
  const existingPathSet = new Set(existingPaths);
  const localPaths = new Set<string>();

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let deleted = 0;
  let totalWords = 0;

  const vectorBatch: Array<{
    id: string;
    vector: number[];
    metadata: VectorMetadata;
  }> = [];

  for (const fullPath of files) {
    const raw = fs.readFileSync(fullPath, "utf-8");
    const { data, content } = matter(raw);
    const relativePath = path.relative(VAULT_PATH, fullPath);
    const name = path.basename(fullPath, ".md");
    const folder =
      path.dirname(relativePath) === "." ? "(root)" : path.dirname(relativePath);
    const stat = fs.statSync(fullPath);

    localPaths.add(relativePath);

    const hash = md5(raw);
    const existingHash = await redis.get<string>(`vault:hash:${relativePath}`);

    const words = countWords(content);
    totalWords += words;

    if (existingHash === hash) {
      unchanged++;
      continue;
    }

    const outgoing: string[] = [];
    const wikiRe = /\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiRe.exec(content)) !== null) {
      outgoing.push(wikilinkTarget(match[1]));
    }

    const tags = extractTags(data as Record<string, unknown>);

    await redis.hset(`vault:note:${relativePath}`, {
      name,
      content,
      rawContent: raw,
      tags: JSON.stringify(tags),
      outgoing: JSON.stringify(outgoing),
      folder,
      words: String(words),
      modifiedAt: stat.mtime.toISOString(),
      size: String(stat.size),
    });

    await redis.set(`vault:hash:${relativePath}`, hash);
    await redis.sadd("vault:notes:index", relativePath);

    // Prepare vector chunks
    const chunks = chunkText(content);
    if (chunks.length > 0 && VOYAGE_API_KEY) {
      try {
        const oldResults = await vectorIndex.query<VectorMetadata>({
          vector: new Array(1024).fill(0),
          topK: 1000,
          filter: `path = '${relativePath.replace(/'/g, "\\'")}'`,
          includeMetadata: false,
        });
        if (oldResults.length > 0) {
          await vectorIndex.delete(oldResults.map((r) => r.id as string));
        }
      } catch {
        // Index might be empty
      }

      for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
        const embeddings = await embedTexts(batch, VOYAGE_API_KEY);
        for (let j = 0; j < batch.length; j++) {
          const chunkIdx = i + j;
          vectorBatch.push({
            id: `${relativePath}#chunk${chunkIdx}`,
            vector: embeddings[j],
            metadata: {
              path: relativePath,
              name,
              chunk: chunkIdx,
              text: batch[j],
              tags,
            },
          });
        }
      }
    }

    if (existingPathSet.has(relativePath)) {
      updated++;
    } else {
      created++;
    }
  }

  // Upsert vector batches
  if (vectorBatch.length > 0) {
    const VECTOR_BATCH_SIZE = 1000;
    for (let i = 0; i < vectorBatch.length; i += VECTOR_BATCH_SIZE) {
      const batch = vectorBatch.slice(i, i + VECTOR_BATCH_SIZE);
      await vectorIndex.upsert(batch);
    }
  }

  // Handle deletes
  for (const existingPath of existingPaths) {
    if (!localPaths.has(existingPath)) {
      // Save scar tombstone before deleting
      try {
        const noteData = (await redis.hgetall(`vault:note:${existingPath}`)) as Record<string, string> | null;
        if (noteData) {
          /* v8 ignore next 2 — defensive fallbacks for missing fields */
          const name = noteData.name || path.basename(existingPath, ".md");
          const folder = noteData.folder || "(root)";
          let tags: string[] = [];
          let outgoing: string[] = [];
          /* v8 ignore start — catch blocks for malformed JSON in deleted note data */
          try { tags = JSON.parse(noteData.tags || "[]"); } catch {}
          try { outgoing = JSON.parse(noteData.outgoing || "[]"); } catch {}
          /* v8 ignore stop */
          await saveScar({ path: existingPath, name, folder, tags, connectedNotes: outgoing });
        }
      } catch (scarErr) { // eslint-disable-line
        /* v8 ignore next */
        console.error(`  Failed to save scar for ${existingPath}:`, scarErr);
      }

      await redis.del(`vault:note:${existingPath}`);
      await redis.del(`vault:hash:${existingPath}`);
      await redis.srem("vault:notes:index", existingPath);

      try {
        const oldResults = await vectorIndex.query<VectorMetadata>({
          vector: new Array(1024).fill(0),
          topK: 1000,
          filter: `path = '${existingPath.replace(/'/g, "\\'")}'`,
          includeMetadata: false,
        });
        if (oldResults.length > 0) {
          await vectorIndex.delete(oldResults.map((r) => r.id as string));
        }
      } catch {
        // Ignore
      }

      deleted++;
    }
  }

  // Handle pending creates
  const pendingCreates = (await redis.smembers("vault:pending-creates")) as string[];
  let pendingWritten = 0;
  for (const pendingPath of pendingCreates) {
    const noteData = (await redis.hgetall(`vault:note:${pendingPath}`)) as Record<
      string,
      string
    > | null;
    if (!noteData || !noteData.rawContent) continue;

    const diskPath = path.join(VAULT_PATH, pendingPath);
    const dir = path.dirname(diskPath);

    try {
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(diskPath)) {
        fs.writeFileSync(diskPath, noteData.rawContent, "utf-8");
        pendingWritten++;
      }
    } catch (err) {
      console.error(`  Failed to write pending note ${pendingPath}:`, err);
    }

    await redis.srem("vault:pending-creates", pendingPath);
  }

  // Update vault metadata
  await redis.hset("vault:meta", {
    totalNotes: String(localPaths.size),
    totalWords: String(totalWords),
    lastSyncAt: new Date().toISOString(),
  });

  return {
    created,
    updated,
    deleted,
    unchanged,
    vectorsUpserted: vectorBatch.length,
    pendingWritten,
    totalNotes: localPaths.size,
    totalWords,
  };
}
