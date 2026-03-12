import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";

interface CreateNoteRequest {
  title: string;
  content: string;
  sourcePaths?: string[];
  sessionId?: string;
}

function sanitizeTitle(title: string): string {
  return title
    .replace(/[/\\:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function buildFrontmatter(title: string, sessionId?: string): string {
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
  lines.push("  - cortex-generated");
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
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    return NextResponse.json({ error: "VAULT_PATH is not configured" }, { status: 500 });
  }

  let body: CreateNoteRequest;
  try {
    body = (await req.json()) as CreateNoteRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, content, sourcePaths = [], sessionId } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (!content || typeof content !== "string") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }

  const safeTitle = sanitizeTitle(title);
  if (!safeTitle) {
    return NextResponse.json({ error: "title is invalid after sanitization" }, { status: 400 });
  }

  const cortexNotesDir = path.join(vaultPath, "cortex-notes");
  const filename = `${safeTitle}.md`;
  const filePath = path.join(cortexNotesDir, filename);
  const relativePath = `cortex-notes/${filename}`;

  // Ensure path stays within vault
  const resolvedVault = path.resolve(vaultPath);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedVault)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  // Create directory if it doesn't exist
  try {
    await fs.mkdir(cortexNotesDir, { recursive: true });
  } catch {
    return NextResponse.json({ error: "Failed to create cortex-notes directory" }, { status: 500 });
  }

  // Check if file already exists — 409 Conflict
  try {
    await fs.access(filePath);
    return NextResponse.json(
      { error: `Note already exists: ${relativePath}` },
      { status: 409 }
    );
  } catch {
    // File does not exist — proceed
  }

  const frontmatter = buildFrontmatter(safeTitle, sessionId);
  const sourcesSection = buildSourcesSection(sourcePaths);
  const noteContent = `${frontmatter}\n\n${content}${sourcesSection}\n`;

  try {
    await fs.writeFile(filePath, noteContent, "utf-8");
  } catch {
    return NextResponse.json({ error: "Failed to write note file" }, { status: 500 });
  }

  return NextResponse.json({ success: true, path: relativePath }, { status: 201 });
}
