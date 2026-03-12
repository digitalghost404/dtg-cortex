import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  id: string;
  name: string;
  folder: string;
  wordCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect all .md file paths under a directory. */
function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMarkdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Extract all [[wikilink]] targets from markdown content.
 * Handles:
 *   [[Note]]              → "Note"
 *   [[Note|Alias]]        → "Note"
 *   [[Note#Heading]]      → "Note"
 *   [[Note#Heading|Alias]]→ "Note"
 */
function extractWikilinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g;
  const targets: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    let inner = match[1];
    // Strip alias: "Note|Alias" → "Note"
    const pipeIdx = inner.indexOf("|");
    if (pipeIdx !== -1) inner = inner.slice(0, pipeIdx);
    // Strip heading: "Note#Heading" → "Note"
    const hashIdx = inner.indexOf("#");
    if (hashIdx !== -1) inner = inner.slice(0, hashIdx);
    const trimmed = inner.trim();
    if (trimmed) targets.push(trimmed);
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    return NextResponse.json({ error: "VAULT_PATH env var not set" }, { status: 500 });
  }
  if (!fs.existsSync(vaultPath)) {
    return NextResponse.json({ error: `Vault path not found: ${vaultPath}` }, { status: 500 });
  }

  const files = collectMarkdownFiles(vaultPath);

  // ---------------------------------------------------------------------------
  // Pass 1: build node registry (id = normalised lowercase name for lookups)
  // ---------------------------------------------------------------------------

  const nodes: GraphNode[] = [];
  // Map: lowercase name → node id (= lowercase name, stable key)
  const nameToId = new Map<string, string>();
  // Map: file path → node id
  const pathToId = new Map<string, string>();
  // Map: node id → raw content
  const idToContent = new Map<string, string>();

  for (const filePath of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    const { content } = matter(raw);
    const relativePath = path.relative(vaultPath, filePath);
    const nameParts = path.basename(filePath, ".md");
    const folderPart = path.dirname(relativePath) === "." ? "/" : path.dirname(relativePath);
    const wordCount = content
      .replace(/#+\s/g, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

    const id = nameParts.toLowerCase();
    // If two notes share the same lowercase name, skip duplicates (last writer wins)
    nameToId.set(id, id);
    pathToId.set(filePath, id);
    idToContent.set(id, content);

    nodes.push({
      id,
      name: nameParts,
      folder: folderPart,
      wordCount,
    });
  }

  // Deduplicate nodes by id (keep last occurrence if collision)
  const nodeMap = new Map<string, GraphNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  // ---------------------------------------------------------------------------
  // Pass 2: extract edges
  // ---------------------------------------------------------------------------

  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const [id, content] of idToContent.entries()) {
    const links = extractWikilinks(content);
    for (const link of links) {
      const targetId = link.toLowerCase();
      if (targetId === id) continue; // self-links
      if (!nodeMap.has(targetId)) continue; // unresolved links
      const key = `${id}→${targetId}`;
      const keyRev = `${targetId}→${id}`;
      if (edgeSet.has(key) || edgeSet.has(keyRev)) continue;
      edgeSet.add(key);
      edges.push({ source: id, target: targetId });
    }
  }

  const data: GraphData = {
    nodes: Array.from(nodeMap.values()),
    edges,
  };

  return NextResponse.json(data);
}
