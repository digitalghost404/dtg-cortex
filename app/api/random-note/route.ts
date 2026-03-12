import { NextResponse } from "next/server";
import { getAllNotes } from "@/lib/vault";

export async function GET() {
  try {
    const notes = await getAllNotes();
    if (notes.length === 0) {
      return NextResponse.json({ error: "No notes in vault" }, { status: 404 });
    }
    const note = notes[Math.floor(Math.random() * notes.length)];
    return NextResponse.json({
      name: note.name,
      path: note.path,
      content: note.rawContent.slice(0, 1200),
      tags: note.tags,
      words: note.words,
      folder: note.folder,
      outgoing: note.outgoing.slice(0, 10),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
