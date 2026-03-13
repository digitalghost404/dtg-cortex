import { NextRequest, NextResponse } from "next/server";
import { getAllNotes, isSecretPath } from "@/lib/vault";
import type { VaultNote } from "@/lib/vault";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RecentlyModifiedNote {
  name: string;
  path: string;
  modified: string;
}

interface TagEntry {
  tag: string;
  count: number;
}

interface FolderEntry {
  folder: string;
  count: number;
}

export interface VaultStats {
  totalNotes: number;
  totalFolders: number;
  totalWords: number;
  orphans: string[];
  brokenLinks: string[];
  recentlyModified: RecentlyModifiedNote[];
  topTags: TagEntry[];
  folderSizes: FolderEntry[];
  emptyNotes: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wikilinkTarget(raw: string): string {
  return raw.split(/[|#]/)[0].trim();
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

function computeVaultStats(notes: VaultNote[]): VaultStats {
  // ── Build lookup: note name → exists (case-insensitive) ──────────────────
  const nameSet = new Set(notes.map((n) => n.name.toLowerCase()));
  const pathSet = new Set(
    notes.map((n) => n.path.replace(/\.md$/, "").toLowerCase())
  );

  function resolves(target: string): boolean {
    const lower = target.toLowerCase();
    return nameSet.has(lower) || pathSet.has(lower);
  }

  // ── Broken links ─────────────────────────────────────────────────────────
  const brokenSet = new Set<string>();
  for (const note of notes) {
    for (const target of note.outgoing) {
      if (!resolves(target)) {
        brokenSet.add(`[[${target}]]`);
      }
    }
  }

  // ── Incoming link map ─────────────────────────────────────────────────────
  const incomingCount = new Map<string, number>();
  for (const note of notes) {
    for (const target of note.outgoing) {
      const lower = target.toLowerCase();
      const matched = notes.find((n) => n.name.toLowerCase() === lower);
      if (matched) {
        incomingCount.set(matched.name, (incomingCount.get(matched.name) ?? 0) + 1);
      }
    }
  }

  // ── Orphans: no incoming AND no outgoing resolved links ───────────────────
  const orphans = notes
    .filter((n) => {
      const hasIncoming = (incomingCount.get(n.name) ?? 0) > 0;
      const hasOutgoing = n.outgoing.some((t) => resolves(t));
      return !hasIncoming && !hasOutgoing;
    })
    .map((n) => n.name + ".md");

  // ── Recently modified (top 10) ────────────────────────────────────────────
  const recentlyModified: RecentlyModifiedNote[] = [...notes]
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
    .slice(0, 10)
    .map((n) => ({
      name: n.name + ".md",
      path: n.path,
      modified: n.modifiedAt,
    }));

  // ── Top tags ──────────────────────────────────────────────────────────────
  const tagCounts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const topTags: TagEntry[] = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // ── Folder sizes ──────────────────────────────────────────────────────────
  const folderCounts = new Map<string, number>();
  for (const note of notes) {
    folderCounts.set(note.folder, (folderCounts.get(note.folder) ?? 0) + 1);
  }
  const folderSizes: FolderEntry[] = [...folderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([folder, count]) => ({ folder, count }));

  // ── Total folders ─────────────────────────────────────────────────────────
  const uniqueDirs = new Set(
    notes
      .map((n) => {
        const dir = n.path.replace(/[/\\][^/\\]+$/, "");
        return dir === n.path ? "." : dir;
      })
      .filter((d) => d !== ".")
  );

  // ── Empty notes ───────────────────────────────────────────────────────────
  const emptyNotes = notes
    .filter((n) => n.content.trim().length === 0)
    .map((n) => n.name + ".md");

  // ── Total words ───────────────────────────────────────────────────────────
  const totalWords = notes.reduce((sum, n) => sum + n.words, 0);

  return {
    totalNotes: notes.length,
    totalFolders: uniqueDirs.size,
    totalWords,
    orphans,
    brokenLinks: [...brokenSet].sort(),
    recentlyModified,
    topTags,
    folderSizes,
    emptyNotes,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const isAuthed = !!req.cookies.get("cortex-token")?.value;
    const notes = isAuthed
      ? await getAllNotes()
      : (await getAllNotes()).filter((n) => !isSecretPath(n.path));
    if (notes.length === 0) {
      return NextResponse.json(
        { error: "No vault notes found. Ensure VAULT_PATH is set or sync has been run." },
        { status: 404 }
      );
    }
    const stats = computeVaultStats(notes);
    return NextResponse.json(stats);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
