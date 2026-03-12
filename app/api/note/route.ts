import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const notePath = searchParams.get("path");

  if (!notePath) {
    return NextResponse.json({ error: "path parameter is required" }, { status: 400 });
  }

  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    return NextResponse.json({ error: "VAULT_PATH is not configured" }, { status: 500 });
  }

  // Resolve the absolute path and ensure it stays within the vault root
  const resolved = path.resolve(vaultPath, notePath);
  if (!resolved.startsWith(path.resolve(vaultPath))) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const raw = await fs.readFile(resolved, "utf-8");
    const name = path.basename(notePath, ".md");
    const full = searchParams.get("full") === "true";
    const content = full ? raw : raw.slice(0, 800);
    return NextResponse.json({ name, content });
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }
    const message = err instanceof Error ? err.message : "Failed to read note";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
