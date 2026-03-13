import { NextRequest, NextResponse } from "next/server";
import { getNote, isSecretPath } from "@/lib/vault";
import * as kv from "@/lib/kv";

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

  // Block guest access to secrets folder (authenticated users can access)
  if (isSecretPath(notePath)) {
    const token = req.cookies.get("cortex-token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
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

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { path: notePath, appendLink } = body;

    if (!notePath || !appendLink) {
      return NextResponse.json({ error: "path and appendLink required" }, { status: 400 });
    }

    if (notePath.includes("..")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const note = await getNote(notePath);
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Append wikilink
    const newContent = note.content + `\n[[${appendLink}]]`;
    const newRawContent = note.rawContent + `\n[[${appendLink}]]`;
    const newOutgoing = [...note.outgoing, appendLink];

    await kv.hset(`vault:note:${notePath}`, {
      content: newContent,
      rawContent: newRawContent,
      outgoing: JSON.stringify(newOutgoing),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to patch note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
