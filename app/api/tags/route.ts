import { NextRequest, NextResponse } from "next/server";
import { getAllNotes, isSecretPath } from "@/lib/vault";

export async function GET(req: NextRequest) {
  try {
    const isAuthed = !!req.cookies.get("cortex-token")?.value;
    const notes = isAuthed
      ? await getAllNotes()
      : (await getAllNotes()).filter((n) => !isSecretPath(n.path));

    // Build a map: tag -> array of { name, path, words }
    const tagMap = new Map<string, { name: string; path: string; words: number }[]>();
    for (const note of notes) {
      for (const tag of note.tags) {
        if (!tagMap.has(tag)) tagMap.set(tag, []);
        tagMap.get(tag)!.push({ name: note.name, path: note.path, words: note.words });
      }
    }

    // Sort tags by count descending
    const tags = [...tagMap.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([tag, notes]) => ({ tag, count: notes.length, notes }));

    return NextResponse.json({ tags, totalTags: tags.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
