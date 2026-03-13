import { NextRequest, NextResponse } from "next/server";
import { getPhantomThreads, removePhantomThread } from "@/lib/phantom-threads";
import { getNote } from "@/lib/vault";
import * as kv from "@/lib/kv";

export async function GET() {
  try {
    const threads = await getPhantomThreads();
    return NextResponse.json({ threads });
  } catch (err) {
    console.error("[phantom-threads]", err);
    return NextResponse.json({ threads: [] });
  }
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get("forge") === "true") {
    try {
      const body = await req.json();
      const { sourcePath, targetPath } = body;

      if (!sourcePath || !targetPath) {
        return NextResponse.json({ error: "sourcePath and targetPath required" }, { status: 400 });
      }

      // Append wikilinks to both notes
      const sourceNote = await getNote(sourcePath);
      const targetNote = await getNote(targetPath);

      if (!sourceNote || !targetNote) {
        return NextResponse.json({ error: "Note not found" }, { status: 404 });
      }

      // Append [[target]] to source note
      const sourceContent = sourceNote.rawContent + `\n[[${targetNote.name}]]`;
      await kv.hset(`vault:note:${sourcePath}`, {
        rawContent: sourceContent,
        content: sourceNote.content + `\n[[${targetNote.name}]]`,
        outgoing: JSON.stringify([...sourceNote.outgoing, targetNote.name]),
      });

      // Append [[source]] to target note
      const targetContent = targetNote.rawContent + `\n[[${sourceNote.name}]]`;
      await kv.hset(`vault:note:${targetPath}`, {
        rawContent: targetContent,
        content: targetNote.content + `\n[[${sourceNote.name}]]`,
        outgoing: JSON.stringify([...targetNote.outgoing, sourceNote.name]),
      });

      // Mark both as pending creates so sync writes to disk
      await kv.sadd("vault:pending-creates", sourcePath, targetPath);

      // Remove from phantom cache
      await removePhantomThread(sourcePath, targetPath);

      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("[phantom-threads forge]", err);
      return NextResponse.json({ error: "Failed to forge connection" }, { status: 500 });
    }
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
