import { NextRequest, NextResponse } from "next/server";
import { getNote, isSecretPath, getVaultPath, isServerlessMode, saveNoteToKV } from "@/lib/vault";
import { verifyJWT, COOKIE_NAME } from "@/lib/auth";
import { deleteKey } from "@/lib/kv";
import { extractTags, wikilinkTarget } from "@/lib/text-utils";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const notePath = searchParams.get("path");

  if (!notePath) {
    return NextResponse.json({ error: "path parameter is required" }, { status: 400 });
  }

  // Reject absolute paths and enforce safe character/extension rules
  if (notePath.startsWith("/") || !/^[a-zA-Z0-9_\-\/\.\s]+\.md$/.test(notePath)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Block guest access to secrets folder (require valid JWT)
  if (isSecretPath(notePath)) {
    const token = req.cookies.get(COOKIE_NAME)?.value;
    const isAuthed = token ? !!(await verifyJWT(token)) : false;
    if (!isAuthed) {
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

    if (notePath.startsWith("/") || !/^[a-zA-Z0-9_\-\/\.\s]+\.md$/.test(notePath)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const token = req.cookies.get(COOKIE_NAME)?.value;
    const payload = token ? await verifyJWT(token) : null;
    if (!payload) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    if (isSecretPath(notePath)) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    const note = await getNote(notePath);
    if (!note) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Append wikilink
    const newContent = note.content + `\n[[${appendLink}]]`;
    const newRawContent = note.rawContent + `\n[[${appendLink}]]`;
    const newOutgoing = [...note.outgoing, appendLink];

    await saveNoteToKV(notePath, {
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

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { path: notePath, content: newRawContent } = body;

    if (!notePath || typeof newRawContent !== "string") {
      return NextResponse.json({ error: "path and content required" }, { status: 400 });
    }

    if (notePath.startsWith("/") || !/^[a-zA-Z0-9_\-\/\.\s]+\.md$/.test(notePath)) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    if (isSecretPath(notePath)) {
      const token = req.cookies.get(COOKIE_NAME)?.value;
      const isAuthed = token ? !!(await verifyJWT(token)) : false;
      if (!isAuthed) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    }

    const existing = await getNote(notePath);
    if (!existing) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    // Parse the new raw content to extract frontmatter, content, tags, outgoing links
    const { data, content: parsedContent } = matter(newRawContent);

    const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
    const outgoing: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = WIKILINK_RE.exec(parsedContent)) !== null) {
      const target = wikilinkTarget(match[1]);
      if (target) outgoing.push(target);
    }

    const tags = extractTags(data);
    const words = parsedContent.trim() ? parsedContent.trim().split(/\s+/).length : 0;

    // Update KV store
    await saveNoteToKV(notePath, {
      content: parsedContent,
      rawContent: newRawContent,
      outgoing: JSON.stringify(outgoing),
      tags: JSON.stringify(tags),
      words,
      size: Buffer.byteLength(newRawContent, "utf8"),
      modifiedAt: new Date().toISOString(),
    });

    // Also write to disk if in filesystem mode
    const vaultPath = getVaultPath();
    if (vaultPath && !isServerlessMode()) {
      const fullPath = path.resolve(vaultPath, notePath);
      if (fullPath.startsWith(path.resolve(vaultPath))) {
        fs.writeFileSync(fullPath, newRawContent, "utf8");
      }
    }

    // Invalidate cached clusters since note content changed
    deleteKey("cache:clusters").catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
