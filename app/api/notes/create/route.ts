import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import * as kv from "@/lib/kv";
import { isServerlessMode, getVaultPath } from "@/lib/vault";

interface CreateNoteRequest {
  title: string;
  content: string;
  sourcePaths?: string[];
  sessionId?: string;
  folder?: string;   // vault-relative folder path
  tags?: string[];   // custom tags
}

function sanitizeTitle(title: string): string {
  return title
    .replace(/[/\\:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function sanitizeFolder(raw: string): string {
  return raw
    .replace(/\.\./g, "")
    .replace(/[<>"|?*:]/g, "")
    .replace(/\/+/g, "/")
    .replace(/^\/|\/$/g, "")
    .trim()
    .slice(0, 200);
}

function buildFrontmatter(title: string, tags: string[], sessionId?: string): string {
  const created = new Date().toISOString().slice(0, 10);
  const lines = [
    "---",
    `title: "${title.replace(/"/g, '\\"')}"`,
    `created: ${created}`,
    `source: cortex-chat`,
  ];
  if (sessionId) {
    lines.push(`session: "${sessionId}"`);
  }
  lines.push("tags:");
  for (const tag of tags) {
    lines.push(`  - ${tag.replace(/^#/, "")}`);
  }
  lines.push("---");
  return lines.join("\n");
}

function buildSourcesSection(sourcePaths: string[]): string {
  if (sourcePaths.length === 0) return "";
  const links = sourcePaths.map((p) => {
    const name = path.basename(p, ".md");
    return `- [[${name}]]`;
  });
  return "\n\n---\n\n## Sources\n\n" + links.join("\n");
}

export async function POST(req: NextRequest) {
  let body: CreateNoteRequest;
  try {
    body = (await req.json()) as CreateNoteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, content, sourcePaths: rawSourcePaths = [], sessionId } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  // Validate sourcePaths: must be an array of strings, capped at 50
  const sourcePaths = (Array.isArray(rawSourcePaths) ? rawSourcePaths : [])
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .slice(0, 50)
    .map((p) => p.replace(/[<>"|?*]/g, ""));

  const safeTitle = sanitizeTitle(title);
  if (!safeTitle) {
    return NextResponse.json({ error: "title is invalid after sanitization" }, { status: 400 });
  }

  // Resolve target folder
  const folder = body.folder ? sanitizeFolder(body.folder) : "cortex-notes";

  const filename = `${safeTitle}.md`;
  const relativePath = folder ? `${folder}/${filename}` : filename;

  // Merge custom tags with the default tag
  const customTags = (Array.isArray(body.tags) ? body.tags : [])
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .slice(0, 20)
    .map((t) => (t.startsWith("#") ? t : `#${t}`));
  const tags = ["#cortex-generated", ...customTags.filter((t) => t !== "#cortex-generated")];

  const frontmatter = buildFrontmatter(safeTitle, tags, sessionId);
  const sourcesSection = buildSourcesSection(sourcePaths);
  const noteContent = `${frontmatter}\n\n${content}${sourcesSection}\n`;

  if (isServerlessMode()) {
    // Write to Redis + add to pending-creates set
    const noteKey = `vault:note:${relativePath}`;

    // Check if already exists
    const existing = await kv.hgetall(noteKey);
    if (existing && Object.keys(existing).length > 0) {
      return NextResponse.json(
        { error: `Note already exists: ${relativePath}` },
        { status: 409 }
      );
    }

    // Extract outgoing links from content
    const outgoing: string[] = [];
    const wikiRe = /\[\[([^\]]+)\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikiRe.exec(content)) !== null) {
      const target = match[1].split(/[|#]/)[0].trim();
      if (target) outgoing.push(target);
    }

    const words = content.trim().split(/\s+/).length;

    await kv.hset(noteKey, {
      name: safeTitle,
      content,
      rawContent: noteContent,
      tags: JSON.stringify(tags),
      outgoing: JSON.stringify(outgoing),
      folder,
      words: String(words),
      modifiedAt: new Date().toISOString(),
      size: String(noteContent.length),
    });

    await kv.sadd("vault:notes:index", relativePath);

    // Also write to filesystem if VAULT_PATH is available (hybrid mode)
    const hybridVaultPath = getVaultPath();
    if (hybridVaultPath) {
      try {
        const noteDir = path.join(hybridVaultPath, folder);
        const filePath = path.join(noteDir, filename);
        const resolvedVault = path.resolve(hybridVaultPath);
        const resolvedFile = path.resolve(filePath);
        if (resolvedFile.startsWith(resolvedVault)) {
          await fs.mkdir(noteDir, { recursive: true });
          await fs.writeFile(filePath, noteContent, "utf-8");
        }
      } catch {
        // Filesystem write failed but KV succeeded — note is still available
        await kv.sadd("vault:pending-creates", relativePath);
      }
    } else {
      await kv.sadd("vault:pending-creates", relativePath);
    }

    return NextResponse.json({ success: true, path: relativePath }, { status: 201 });
  }

  // Filesystem mode
  const vaultPath = getVaultPath();
  if (!vaultPath) {
    return NextResponse.json({ error: "VAULT_PATH is not configured" }, { status: 500 });
  }

  const noteDir = path.join(vaultPath, folder);
  const filePath = path.join(noteDir, filename);

  // Ensure path stays within vault
  const resolvedVault = path.resolve(vaultPath);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedVault)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    await fs.mkdir(noteDir, { recursive: true });
  } catch {
    return NextResponse.json({ error: "Failed to create note directory" }, { status: 500 });
  }

  try {
    await fs.access(filePath);
    return NextResponse.json(
      { error: `Note already exists: ${relativePath}` },
      { status: 409 }
    );
  } catch {
    // File does not exist — proceed
  }

  try {
    await fs.writeFile(filePath, noteContent, "utf-8");
  } catch {
    return NextResponse.json({ error: "Failed to write note file" }, { status: 500 });
  }

  return NextResponse.json({ success: true, path: relativePath }, { status: 201 });
}
