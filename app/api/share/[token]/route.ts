import { NextResponse } from "next/server";
import * as kv from "@/lib/kv";
import { getNote, isSecretPath } from "@/lib/vault";

interface ShareData {
  notePath: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * GET /api/share/{token} — PUBLIC endpoint, returns shared note content.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Look up share data
  const raw = await kv.getJSON<string>(`share:${token}`);
  if (!raw) {
    return NextResponse.json(
      { error: "Share not found or expired" },
      { status: 404 }
    );
  }

  let data: ShareData;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return NextResponse.json({ error: "Invalid share data" }, { status: 500 });
  }

  // Check expiration
  if (new Date(data.expiresAt) < new Date()) {
    // Clean up expired share
    await kv.deleteKey(`share:${token}`);
    await kv.srem("share:index", token);
    return NextResponse.json(
      { error: "Share has expired" },
      { status: 404 }
    );
  }

  // Block secrets from being served via share links
  if (isSecretPath(data.notePath)) {
    return NextResponse.json(
      { error: "Share not found or expired" },
      { status: 404 }
    );
  }

  // Fetch note content
  const note = await getNote(data.notePath);
  if (!note) {
    return NextResponse.json(
      { error: "Note not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    name: note.name,
    content: note.content,
    tags: note.tags,
  });
}
