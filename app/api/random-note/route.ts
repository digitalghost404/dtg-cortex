import { NextRequest, NextResponse } from "next/server";
import { getAllNotes, isSecretPath } from "@/lib/vault";

export async function GET(req: NextRequest) {
  try {
    const isAuthed = !!req.cookies.get("cortex-token")?.value;
    const notes = isAuthed
      ? await getAllNotes()
      : (await getAllNotes()).filter((n) => !isSecretPath(n.path));
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
