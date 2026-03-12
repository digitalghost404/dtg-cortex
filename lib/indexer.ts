import fs from "fs";
import path from "path";
import matter from "gray-matter";
import {
  upsertVectors,
  queryVectors,
  deleteVectorsByPath,
  resetIndex,
  indexHasItems,
} from "./vector";
import type { VectorMetadata } from "./vector";
import { getAllNotes, isServerlessMode } from "./vault";

const VAULT_PATH = process.env.VAULT_PATH!;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY!;
const CHUNK_SIZE = 500; // words per chunk
const CHUNK_OVERLAP = 50;

async function embedTexts(inputs: string[]): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: inputs, model: "voyage-3" }),
  });

  if (!res.ok) {
    throw new Error(`Voyage AI error: ${res.status} ${await res.text()}`);
  }

  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

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

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".")) {
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function buildIndex(): Promise<void> {
  // Clear existing index for a clean re-index
  await resetIndex();

  if (isServerlessMode()) {
    // Serverless: read vault content from Redis
    const notes = await getAllNotes();
    console.log(`Indexing ${notes.length} notes from Redis...`);

    let indexed = 0;
    const EMBED_BATCH_SIZE = 20;

    for (const note of notes) {
      const chunks = chunkText(note.content);
      if (chunks.length === 0) continue;

      // Embed in batches
      for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
        const embeddings = await embedTexts(batch);

        const items = batch.map((text, j) => ({
          id: `${note.path}#chunk${i + j}`,
          vector: embeddings[j],
          metadata: {
            path: note.path,
            name: note.name,
            chunk: i + j,
            text,
            tags: note.tags,
          } as VectorMetadata,
        }));

        await upsertVectors(items);
      }

      indexed++;
      if (indexed % 50 === 0) console.log(`  ${indexed}/${notes.length} notes indexed`);
    }

    console.log(`Done. ${indexed} notes indexed.`);
  } else {
    // Local: read from filesystem
    if (!VAULT_PATH) throw new Error("VAULT_PATH is not set in environment");

    const files = collectMarkdownFiles(VAULT_PATH);
    console.log(`Indexing ${files.length} notes from filesystem...`);

    let indexed = 0;

    for (const filePath of files) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const { content, data: frontmatter } = matter(raw);
      const relativePath = path.relative(VAULT_PATH, filePath);
      const noteName = path.basename(filePath, ".md");

      const chunks = chunkText(content);
      if (chunks.length === 0) continue;

      const embeddings = await embedTexts(chunks);

      const items = chunks.map((text, i) => ({
        id: `${relativePath}#chunk${i}`,
        vector: embeddings[i],
        metadata: {
          path: relativePath,
          name: noteName,
          chunk: i,
          text,
          tags: frontmatter.tags ?? [],
        } as VectorMetadata,
      }));

      await upsertVectors(items);

      indexed++;
      if (indexed % 50 === 0) console.log(`  ${indexed}/${files.length} notes indexed`);
    }

    console.log(`Done. ${indexed} notes indexed.`);
  }
}

export async function removeFileFromIndex(relativePath: string): Promise<void> {
  await deleteVectorsByPath(relativePath);
}

export async function indexSingleFile(filePathOrRelative: string): Promise<void> {
  if (isServerlessMode()) {
    // In serverless mode, the argument is a relative path — read from Redis
    const { getNote } = await import("./vault");
    const note = await getNote(filePathOrRelative);
    if (!note) return;

    await removeFileFromIndex(note.path);

    const chunks = chunkText(note.content);
    if (chunks.length === 0) return;

    const embeddings = await embedTexts(chunks);

    const items = chunks.map((text, i) => ({
      id: `${note.path}#chunk${i}`,
      vector: embeddings[i],
      metadata: {
        path: note.path,
        name: note.name,
        chunk: i,
        text,
        tags: note.tags,
      } as VectorMetadata,
    }));

    await upsertVectors(items);
  } else {
    if (!VAULT_PATH) throw new Error("VAULT_PATH is not set in environment");

    const relativePath = path.relative(VAULT_PATH, filePathOrRelative);

    await removeFileFromIndex(relativePath);

    const raw = fs.readFileSync(filePathOrRelative, "utf-8");
    const { content, data: frontmatter } = matter(raw);
    const noteName = path.basename(filePathOrRelative, ".md");

    const chunks = chunkText(content);
    if (chunks.length === 0) return;

    const embeddings = await embedTexts(chunks);

    const items = chunks.map((text, i) => ({
      id: `${relativePath}#chunk${i}`,
      vector: embeddings[i],
      metadata: {
        path: relativePath,
        name: noteName,
        chunk: i,
        text,
        tags: frontmatter.tags ?? [],
      } as VectorMetadata,
    }));

    await upsertVectors(items);
  }
}

export async function queryIndex(
  query: string,
  topK = 6
): Promise<Array<{ text: string; name: string; path: string; score: number }>> {
  const hasItems = await indexHasItems();
  if (!hasItems) {
    throw new Error("Index not built yet. Run /api/index first.");
  }

  const [queryVector] = await embedTexts([query]);
  const results = await queryVectors(queryVector, topK);

  return results.map((r) => ({
    text: r.metadata.text,
    name: r.metadata.name,
    path: r.metadata.path,
    score: r.score,
  }));
}

export async function indexExists(): Promise<boolean> {
  return indexHasItems();
}
