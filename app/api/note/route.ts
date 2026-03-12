import { NextRequest, NextResponse } from "next/server";
import { getNote } from "@/lib/vault";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const notePath = searchParams.get("path");

  if (!notePath) {
    return NextResponse.json({ error: "path parameter is required" }, { status: 400 });
  }

  // Basic path traversal protection
  if (notePath.includes("..")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const note = await getNote(notePath);
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const full = searchParams.get("full") === "true";
    const content = full ? note.rawContent : note.rawContent.slice(0, 800);
    return NextResponse.json({ name: note.name, content });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
