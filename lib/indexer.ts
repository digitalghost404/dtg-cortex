import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { LocalIndex } from "vectra";

const VAULT_PATH = process.env.VAULT_PATH!;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY!;
const INDEX_PATH = path.join(process.cwd(), ".cortex-index");
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
  if (!VAULT_PATH) throw new Error("VAULT_PATH is not set in environment");

  const index = new LocalIndex(INDEX_PATH);

  if (!(await index.isIndexCreated())) {
    await index.createIndex();
  } else {
    // Clear existing items for a clean re-index
    await index.deleteIndex();
    await index.createIndex();
  }

  const files = collectMarkdownFiles(VAULT_PATH);
  console.log(`Indexing ${files.length} notes...`);

  let indexed = 0;

  for (const filePath of files) {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { content, data: frontmatter } = matter(raw);
    const relativePath = path.relative(VAULT_PATH, filePath);
    const noteName = path.basename(filePath, ".md");

    const chunks = chunkText(content);
    if (chunks.length === 0) continue;

    const embeddings = await embedTexts(chunks);

    for (let i = 0; i < chunks.length; i++) {
      await index.insertItem({
        vector: embeddings[i],
        metadata: {
          path: relativePath,
          name: noteName,
          chunk: i,
          text: chunks[i],
          tags: frontmatter.tags ?? [],
        },
      });
    }

    indexed++;
    if (indexed % 50 === 0) console.log(`  ${indexed}/${files.length} notes indexed`);
  }

  console.log(`Done. ${indexed} notes indexed.`);
}

export async function removeFileFromIndex(relativePath: string): Promise<void> {
  const index = new LocalIndex(INDEX_PATH);

  if (!(await index.isIndexCreated())) {
    return;
  }

  const items = await index.listItems();
  const matching = items.filter((item) => item.metadata.path === relativePath);

  for (const item of matching) {
    await index.deleteItem(item.id);
  }
}

export async function indexSingleFile(filePath: string): Promise<void> {
  if (!VAULT_PATH) throw new Error("VAULT_PATH is not set in environment");

  const index = new LocalIndex(INDEX_PATH);

  if (!(await index.isIndexCreated())) {
    return;
  }

  const relativePath = path.relative(VAULT_PATH, filePath);

  // Remove any existing chunks for this file before re-inserting
  await removeFileFromIndex(relativePath);

  const raw = fs.readFileSync(filePath, "utf-8");
  const { content, data: frontmatter } = matter(raw);
  const noteName = path.basename(filePath, ".md");

  const chunks = chunkText(content);
  if (chunks.length === 0) return;

  const embeddings = await embedTexts(chunks);

  for (let i = 0; i < chunks.length; i++) {
    await index.insertItem({
      vector: embeddings[i],
      metadata: {
        path: relativePath,
        name: noteName,
        chunk: i,
        text: chunks[i],
        tags: frontmatter.tags ?? [],
      },
    });
  }
}

export async function queryIndex(
  query: string,
  topK = 6
): Promise<Array<{ text: string; name: string; path: string; score: number }>> {
  const index = new LocalIndex(INDEX_PATH);

  if (!(await index.isIndexCreated())) {
    throw new Error("Index not built yet. Run /api/index first.");
  }

  const [queryVector] = await embedTexts([query]);
  const results = await index.queryItems(queryVector, query, topK);

  return results.map((r) => ({
    text: r.item.metadata.text as string,
    name: r.item.metadata.name as string,
    path: r.item.metadata.path as string,
    score: r.score,
  }));
}

export function indexExists(): boolean {
  return fs.existsSync(path.join(INDEX_PATH, "index.json"));
}
