import { NextResponse } from "next/server";
import { getAllNotes } from "@/lib/vault";

export interface TreeNote {
  name: string;
  path: string;
  folder: string;
  words: number;
  tags: string[];
  modifiedAt: string;
}

/**
 * GET /api/vault/tree — returns all notes with folder/path info for building a file tree.
 * Auth required (protected by middleware).
 */
export async function GET() {
  try {
    const notes = await getAllNotes();

    const tree: TreeNote[] = notes
      .map((n) => ({
        name: n.name,
        path: n.path,
        folder: n.folder,
        words: n.words,
        tags: n.tags,
        modifiedAt: n.modifiedAt,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));

    return NextResponse.json({ notes: tree });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
