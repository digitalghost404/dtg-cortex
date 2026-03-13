import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { isServerlessMode, getVaultPath } from "@/lib/vault";

export async function POST(req: NextRequest) {
  let body: { folder: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { folder } = body;
  if (!folder || typeof folder !== "string" || !folder.trim()) {
    return NextResponse.json({ error: "folder is required" }, { status: 400 });
  }

  // Sanitize: no path traversal, no special chars
  const sanitized = folder
    .replace(/\.\./g, "")
    .replace(/[<>"|?*:]/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "")
    .trim();

  if (!sanitized) {
    return NextResponse.json({ error: "Invalid folder name" }, { status: 400 });
  }

  if (isServerlessMode()) {
    // In serverless, folders are implicit — just validate the name
    return NextResponse.json({ success: true, folder: sanitized }, { status: 201 });
  }

  // Filesystem mode: create the directory
  const vaultPath = getVaultPath();
  if (!vaultPath) {
    return NextResponse.json({ error: "VAULT_PATH is not configured" }, { status: 500 });
  }

  const folderPath = path.join(vaultPath, sanitized);
  const resolvedVault = path.resolve(vaultPath);
  const resolvedFolder = path.resolve(folderPath);
  if (!resolvedFolder.startsWith(resolvedVault)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    await fs.mkdir(folderPath, { recursive: true });
  } catch {
    return NextResponse.json({ error: "Failed to create folder" }, { status: 500 });
  }

  return NextResponse.json({ success: true, folder: sanitized }, { status: 201 });
}
