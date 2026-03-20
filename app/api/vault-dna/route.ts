import { NextRequest, NextResponse } from "next/server";
import { getAllNotes, isSecretPath } from "@/lib/vault";
import type { VaultNote } from "@/lib/vault";
import { verifyJWT } from "@/lib/auth";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultDNA {
  noteCount: number;
  totalWords: number;
  linkDensity: number;
  topicSpread: number;
  tagDiversity: number;
  avgNoteLength: number;
  activityScore: number;
  topFolders: string[];
  topTags: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function softNorm(value: number, midpoint: number): number {
  if (midpoint <= 0) return clamp01(value);
  return clamp01(value / (value + midpoint));
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

function computeVaultDNA(notes: VaultNote[]): VaultDNA {
  const noteCount = notes.length;

  if (noteCount === 0) {
    return {
      noteCount: 0,
      totalWords: 0,
      linkDensity: 0,
      topicSpread: 0,
      tagDiversity: 0,
      avgNoteLength: 0,
      activityScore: 0,
      topFolders: [],
      topTags: [],
    };
  }

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  let totalWords = 0;
  let totalLinks = 0;
  let recentCount = 0;

  const tagCounts = new Map<string, number>();
  const folderCounts = new Map<string, number>();
  const topLevelFolders = new Set<string>();

  for (const note of notes) {
    totalWords += note.words;
    totalLinks += note.outgoing.length;

    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    // Top-level folder
    const parts = note.path.split(/[/\\]/);
    const topLevel = parts.length > 1 ? parts[0] : "(root)";
    topLevelFolders.add(topLevel);

    folderCounts.set(note.folder, (folderCounts.get(note.folder) ?? 0) + 1);

    if (note.modifiedAt && new Date(note.modifiedAt).getTime() > sevenDaysAgo) {
      recentCount++;
    }
  }

  const avgLinks = totalLinks / noteCount;
  const linkDensity = softNorm(avgLinks, 3);
  const rawTopicSpread = topLevelFolders.size / noteCount;
  const topicSpread = softNorm(rawTopicSpread, 0.15);
  const rawTagDiv = tagCounts.size / noteCount;
  const tagDiversity = softNorm(rawTagDiv, 0.3);
  const avgNoteLengthRaw = totalWords / noteCount;
  const avgNoteLength = softNorm(avgNoteLengthRaw, 200);
  const activityScore = clamp01(recentCount / noteCount);

  const topFolders = [...folderCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([folder]) => folder);

  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([tag]) => tag);

  return {
    noteCount,
    totalWords,
    linkDensity,
    topicSpread,
    tagDiversity,
    avgNoteLength,
    activityScore,
    topFolders,
    topTags,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("cortex-token")?.value;
    const isAuthed = token ? !!(await verifyJWT(token)) : false;
    const notes = isAuthed
      ? await getAllNotes()
      : (await getAllNotes()).filter((n) => !isSecretPath(n.path));
    const dna = computeVaultDNA(notes);
    return NextResponse.json(dna, {
      headers: {
        "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
