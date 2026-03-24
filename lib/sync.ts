/**
 * Core sync logic — importable by both scripts/sync.ts and app/api/sync/route.ts
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import matter from "gray-matter";
import * as kv from "./kv";
import { upsertVectors, deleteVectorsByPath } from "./vector";
import type { VectorMetadata } from "./vector";
import { saveScar } from "./scars";
import { chunkText, extractTags, wikilinkTarget, countWords } from "./text-utils";
import { generateBriefing } from "./briefing-generator";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

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
// Lightweight pending-creates pull (used by watch mode on 15s interval)
// ---------------------------------------------------------------------------

export async function pullPending(): Promise<{ written: number; paths: string[] }> {
  const VAULT_PATH = process.env.VAULT_PATH;
  if (!VAULT_PATH) throw new Error("VAULT_PATH is not set");

  const pending = await kv.smembers("vault:pending-creates");
  if (pending.length === 0) return { written: 0, paths: [] };

  let written = 0;
  const paths: string[] = [];

  for (const relativePath of pending) {
    const noteData = await kv.hgetall<Record<string, string>>(`vault:note:${relativePath}`);
    if (!noteData) {
      await kv.srem("vault:pending-creates", relativePath);
      continue;
    }

    const diskPath = path.join(VAULT_PATH, relativePath);

    // Guard against path traversal
    if (!diskPath.startsWith(VAULT_PATH + path.sep) && diskPath !== VAULT_PATH) {
      console.error(`[pullPending] Path traversal blocked: ${relativePath}`);
      await kv.srem("vault:pending-creates", relativePath);
      continue;
    }

    // Skip if file already exists on disk
    if (fs.existsSync(diskPath)) {
      await kv.srem("vault:pending-creates", relativePath);
      continue;
    }

    // Prefer rawContent; fall back to reconstructing frontmatter
    let content = noteData.rawContent;
    if (!content && noteData.content) {
      const name = noteData.name || path.basename(relativePath, ".md");
      const tags: string[] = noteData.tags ? JSON.parse(noteData.tags) : [];
      const created = noteData.modifiedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const frontmatter = [
        "---",
        `title: "${name}"`,
        `created: ${created}`,
        "source: cortex-chat",
        "tags:",
        ...tags.map((t: string) => `  - ${t.replace(/^#/, "")}`),
        "---",
      ].join("\n");
      content = frontmatter + "\n\n" + noteData.content + "\n";
    }

    if (!content) {
      await kv.srem("vault:pending-creates", relativePath);
      continue;
    }

    try {
      const dir = path.dirname(diskPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(diskPath, content, "utf-8");

      // Set hash so runSync() skips this file as "unchanged"
      const hash = md5(content);
      await kv.setJSON(`vault:hash:${relativePath}`, hash);
      await kv.srem("vault:pending-creates", relativePath);

      written++;
      paths.push(relativePath);
    } catch (err) {
      console.error(`[pullPending] Failed to write ${relativePath}:`, err);
    }
  }

  return { written, paths };
}

// ---------------------------------------------------------------------------
// Main sync function
// ---------------------------------------------------------------------------

export async function runSync(
  options: { skipPending?: boolean } = {},
): Promise<SyncResult> {
  const VAULT_PATH = process.env.VAULT_PATH;
  const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;

  if (!VAULT_PATH) throw new Error("VAULT_PATH is not set");
  if (!process.env.KV_REST_API_URL) throw new Error("KV_REST_API_URL is not set");

  const files = collectMarkdownFiles(VAULT_PATH);
  const existingPaths = await kv.smembers("vault:notes:index");
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

  // Pre-read all files and compute hashes locally
  const fileEntries = files.map((fullPath) => {
    const raw = fs.readFileSync(fullPath, "utf-8");
    const { data, content } = matter(raw);
    const relativePath = path.relative(VAULT_PATH, fullPath);
    const name = path.basename(fullPath, ".md");
    const folder =
      path.dirname(relativePath) === "." ? "(root)" : path.dirname(relativePath);
    const stat = fs.statSync(fullPath);
    const hash = md5(raw);
    return { fullPath, raw, data, content, relativePath, name, folder, stat, hash };
  });

  // Batch-fetch all existing hashes in one Redis call (1 command instead of N)
  const hashKeys = fileEntries.map((e) => `vault:hash:${e.relativePath}`);
  const existingHashes = hashKeys.length > 0
    ? await kv.mget<string>(...hashKeys)
    : [];

  for (let i = 0; i < fileEntries.length; i++) {
    const { raw, data, content, relativePath, name, folder, stat, hash } = fileEntries[i];
    const existingHash = existingHashes[i];

    localPaths.add(relativePath);

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
      const target = wikilinkTarget(match[1]);
      if (target) outgoing.push(target);
    }

    const tags = extractTags(data as Record<string, unknown>);

    await kv.hset(`vault:note:${relativePath}`, {
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

    await kv.setJSON(`vault:hash:${relativePath}`, hash);
    await kv.sadd("vault:notes:index", relativePath);

    // Prepare vector chunks
    const chunks = chunkText(content);
    if (chunks.length > 0 && VOYAGE_API_KEY) {
      try {
        await deleteVectorsByPath(relativePath);
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

  // Upsert vector batches via shared abstraction
  if (vectorBatch.length > 0) {
    await upsertVectors(vectorBatch);
  }

  // Handle deletes
  for (const existingPath of existingPaths) {
    if (!localPaths.has(existingPath)) {
      // Save scar tombstone before deleting
      try {
        const noteData = await kv.hgetall<Record<string, string>>(`vault:note:${existingPath}`);
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

      await kv.deleteKey(`vault:note:${existingPath}`);
      await kv.deleteKey(`vault:hash:${existingPath}`);
      await kv.srem("vault:notes:index", existingPath);

      try {
        await deleteVectorsByPath(existingPath);
      } catch {
        // Ignore
      }

      deleted++;
    }
  }

  // Handle pending creates (skipped in watch mode where pullPending handles this)
  let pendingWritten = 0;
  if (!options.skipPending) {
    const pendingCreates = await kv.smembers("vault:pending-creates");
    for (const pendingPath of pendingCreates) {
      const noteData = await kv.hgetall<Record<string, string>>(`vault:note:${pendingPath}`);
      if (!noteData) {
        await kv.srem("vault:pending-creates", pendingPath);
        continue;
      }

      // Prefer rawContent; fall back to reconstructing frontmatter
      let fileContent = noteData.rawContent;
      if (!fileContent && noteData.content) {
        const name = noteData.name || path.basename(pendingPath, ".md");
        const tags: string[] = noteData.tags ? JSON.parse(noteData.tags) : [];
        const created = noteData.modifiedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
        const frontmatter = [
          "---",
          `title: "${name}"`,
          `created: ${created}`,
          "source: cortex-chat",
          "tags:",
          ...tags.map((t: string) => `  - ${t.replace(/^#/, "")}`),
          "---",
        ].join("\n");
        fileContent = frontmatter + "\n\n" + noteData.content + "\n";
      }

      if (!fileContent) {
        await kv.srem("vault:pending-creates", pendingPath);
        continue;
      }

      const diskPath = path.join(VAULT_PATH, pendingPath);
      const dir = path.dirname(diskPath);

      try {
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(diskPath)) {
          fs.writeFileSync(diskPath, fileContent, "utf-8");
          pendingWritten++;
        }
      } catch (err) {
        console.error(`  Failed to write pending note ${pendingPath}:`, err);
      }

      await kv.srem("vault:pending-creates", pendingPath);
    }
  }

  // Update vault metadata
  await kv.hset("vault:meta", {
    totalNotes: String(localPaths.size),
    totalWords: String(totalWords),
    lastSyncAt: new Date().toISOString(),
  });

  // Invalidate cached cluster visualization since vault data changed
  await kv.deleteKey("cache:clusters").catch(() => {});

  // Generate today's briefing (runs after sync so resonance has fresh vault data)
  try {
    await generateBriefing();
  } catch (err) {
    console.error("[sync] Briefing generation failed (non-fatal):", err);
  }

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
