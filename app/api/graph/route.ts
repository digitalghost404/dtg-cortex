import { NextResponse } from "next/server";
import { getAllNotes } from "@/lib/vault";

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

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function extractWikilinks(content: string): string[] {
  const regex = new RegExp(WIKILINK_RE.source, "g");
  const targets: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    let inner = match[1];
    const pipeIdx = inner.indexOf("|");
    if (pipeIdx !== -1) inner = inner.slice(0, pipeIdx);
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
  try {
    const vaultNotes = await getAllNotes();

    if (vaultNotes.length === 0) {
      return NextResponse.json({ nodes: [], edges: [] } as GraphData);
    }

    // Pass 1: build node registry
    const nodeMap = new Map<string, GraphNode>();
    const idToContent = new Map<string, string>();

    for (const note of vaultNotes) {
      const id = note.name.toLowerCase();
      nodeMap.set(id, {
        id,
        name: note.name,
        folder: note.folder === "(root)" ? "/" : note.folder,
        wordCount: note.words,
      });
      idToContent.set(id, note.content);
    }

    // Pass 2: extract edges
    const edgeSet = new Set<string>();
    const edges: GraphEdge[] = [];

    for (const [id, content] of idToContent.entries()) {
      const links = extractWikilinks(content);
      for (const link of links) {
        const targetId = link.toLowerCase();
        if (targetId === id) continue;
        if (!nodeMap.has(targetId)) continue;
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
