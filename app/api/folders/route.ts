import { NextResponse } from "next/server";
import { getAllNotes } from "@/lib/vault";

export async function GET() {
  try {
    const notes = await getAllNotes();
    const folderSet = new Set<string>();
    for (const note of notes) {
      if (note.folder && note.folder !== "(root)") {
        folderSet.add(note.folder);
        // Also add parent folders (e.g., "a/b/c" -> "a", "a/b", "a/b/c")
        const parts = note.folder.split("/");
        for (let i = 1; i <= parts.length; i++) {
          folderSet.add(parts.slice(0, i).join("/"));
        }
      }
    }
    const folders = [...folderSet].sort();
    return NextResponse.json({ folders });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
