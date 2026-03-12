import { NextResponse } from "next/server";
import { getAllNotes } from "@/lib/vault";
import { fetchAllVectors, indexHasItems } from "@/lib/vector";
import type { VaultNote } from "@/lib/vault";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DigestSection {
  type: "changes" | "connections" | "forgotten" | "questions" | "stats";
  title: string;
  items: Array<{ text: string; meta?: string }>;
}

export interface DigestResponse {
  generatedAt: string;
  sections: DigestSection[];
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dim = vectors[0].length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) {
      sum[i] += v[i];
    }
  }
  return sum.map((x) => x / vectors.length);
}

// ---------------------------------------------------------------------------
// Wikilink extraction
// ---------------------------------------------------------------------------

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function extractWikilinks(content: string): Set<string> {
  const targets = new Set<string>();
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, "g");
  while ((match = re.exec(content)) !== null) {
    const raw = match[1];
    const target = raw.split(/[|#]/)[0].trim();
    if (target) targets.add(target.toLowerCase());
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const THIRTY_DAYS_MS = 30 * DAY_MS;

function buildChangesSection(notes: VaultNote[], now: number): DigestSection {
  const recent = notes
    .filter((f) => now - new Date(f.modifiedAt).getTime() <= SEVEN_DAYS_MS)
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

  const items = recent.map((f) => {
    const daysAgo = Math.floor((now - new Date(f.modifiedAt).getTime()) / DAY_MS);
    const when =
      daysAgo === 0 ? "today" : daysAgo === 1 ? "yesterday" : `${daysAgo}d ago`;
    return {
      text: f.name,
      meta: `${when} · ${f.words} words · ${f.path}`,
    };
  });

  return {
    type: "changes",
    title: "RECENT CHANGES",
    items,
  };
}

function buildForgottenSection(notes: VaultNote[], now: number): DigestSection {
  const forgotten = notes
    .filter((f) => now - new Date(f.modifiedAt).getTime() > THIRTY_DAYS_MS)
    .sort((a, b) => new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime());

  const items = forgotten.slice(0, 10).map((f) => {
    const daysAgo = Math.floor((now - new Date(f.modifiedAt).getTime()) / DAY_MS);
    return {
      text: f.name,
      meta: `${daysAgo}d since last edit · ${f.path}`,
    };
  });

  return {
    type: "forgotten",
    title: "FORGOTTEN NOTES",
    items,
  };
}

const SIMILARITY_THRESHOLD = 0.75;
const DIGEST_TOP_CONNECTIONS = 5;

async function buildConnectionsSection(
  notes: VaultNote[]
): Promise<DigestSection> {
  const emptySection: DigestSection = {
    type: "connections",
    title: "MISSING CONNECTIONS",
    items: [],
  };

  const hasItems = await indexHasItems();
  if (!hasItems) return emptySection;

  const items = await fetchAllVectors();
  if (items.length === 0) return emptySection;

  // Build note → average vector map
  const noteMap = new Map<
    string,
    { name: string; path: string; vectors: number[][] }
  >();

  for (const item of items) {
    const { name, path: notePath } = item.metadata;
    if (typeof name !== "string" || typeof notePath !== "string") continue;
    const key = name.toLowerCase();
    if (!noteMap.has(key)) {
      noteMap.set(key, { name, path: notePath, vectors: [] });
    }
    noteMap.get(key)!.vectors.push(item.vector);
  }

  const noteVecs = [...noteMap.values()].map((entry) => ({
    name: entry.name,
    path: entry.path,
    avgVector: averageVectors(entry.vectors),
  }));

  // Build wikilink adjacency from vault notes
  const outgoing = new Map<string, Set<string>>();
  for (const note of notes) {
    outgoing.set(note.name.toLowerCase(), extractWikilinks(note.content));
  }

  function hasLink(nameA: string, nameB: string): boolean {
    const lA = nameA.toLowerCase();
    const lB = nameB.toLowerCase();
    const fromA = outgoing.get(lA);
    const fromB = outgoing.get(lB);
    return !!(
      (fromA && fromA.has(lB)) ||
      (fromB && fromB.has(lA))
    );
  }

  const suggestions: Array<{
    noteA: string;
    noteB: string;
    similarity: number;
    pathA: string;
    pathB: string;
  }> = [];

  for (let i = 0; i < noteVecs.length; i++) {
    for (let j = i + 1; j < noteVecs.length; j++) {
      const noteA = noteVecs[i];
      const noteB = noteVecs[j];
      if (noteA.avgVector.length === 0 || noteB.avgVector.length === 0) continue;

      const sim = cosineSimilarity(noteA.avgVector, noteB.avgVector);
      if (sim <= SIMILARITY_THRESHOLD) continue;
      if (hasLink(noteA.name, noteB.name)) continue;

      suggestions.push({
        noteA: noteA.name,
        noteB: noteB.name,
        similarity: sim,
        pathA: noteA.path,
        pathB: noteB.path,
      });
    }
  }

  suggestions.sort((a, b) => b.similarity - a.similarity);
  const top = suggestions.slice(0, DIGEST_TOP_CONNECTIONS);

  const sectionItems = top.map((s) => ({
    text: `${s.noteA} ←→ ${s.noteB}`,
    meta: JSON.stringify({
      similarity: s.similarity,
      pathA: s.pathA,
      pathB: s.pathB,
      noteA: s.noteA,
      noteB: s.noteB,
    }),
  }));

  return {
    type: "connections",
    title: "MISSING CONNECTIONS",
    items: sectionItems,
  };
}

function buildQuestionsSection(notes: VaultNote[]): DigestSection {
  const tagCount = new Map<string, number>();
  for (const f of notes) {
    for (const tag of f.tags) {
      const t = tag.toLowerCase().trim();
      if (t) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
    }
  }

  const allNames = notes.map((f) => f.name.toLowerCase());

  const topTags = [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([tag]) => tag);

  const questions: string[] = [];

  if (topTags.length >= 2) {
    const [tagA, tagB] = topTags;
    const countA = tagCount.get(tagA) ?? 0;
    const countB = tagCount.get(tagB) ?? 0;
    questions.push(
      `You have ${countA} notes tagged "${tagA}" and ${countB} tagged "${tagB}" — what is the relationship between these two themes?`
    );
  }

  for (const [tag, count] of tagCount.entries()) {
    if (count >= 3 && !allNames.includes(tag) && !allNames.includes(tag + "s")) {
      questions.push(
        `You have ${count} notes about "${tag}" but no dedicated overview note — what would a synthesis of these notes look like?`
      );
      if (questions.length >= 4) break;
    }
  }

  const forgotten = notes.filter(
    (f) => Date.now() - new Date(f.modifiedAt).getTime() > THIRTY_DAYS_MS
  );
  if (forgotten.length > 0) {
    const oldest = forgotten.sort((a, b) => new Date(a.modifiedAt).getTime() - new Date(b.modifiedAt).getTime())[0];
    questions.push(
      `"${oldest.name}" hasn't been touched in over ${Math.floor((Date.now() - new Date(oldest.modifiedAt).getTime()) / DAY_MS)} days — is it still relevant, or does it need to be updated or archived?`
    );
  }

  const folderCount = new Map<string, number>();
  for (const f of notes) {
    if (f.folder && f.folder !== "(root)") {
      folderCount.set(f.folder, (folderCount.get(f.folder) ?? 0) + 1);
    }
  }
  if (folderCount.size > 0) {
    const [busyFolder, count] = [...folderCount.entries()].sort(
      (a, b) => b[1] - a[1]
    )[0];
    const hasIndex = notes.some(
      (f) =>
        f.folder === busyFolder &&
        (f.name.toLowerCase() === "index" ||
          f.name.toLowerCase() === "readme" ||
          f.name.toLowerCase() === "_index")
    );
    if (!hasIndex) {
      questions.push(
        `The folder "${busyFolder}" has ${count} notes but no index — what overarching theme ties these notes together?`
      );
    }
  }

  const topTwo = [...notes]
    .sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())
    .slice(0, 2);
  if (topTwo.length === 2) {
    questions.push(
      `Your two most recently active notes are "${topTwo[0].name}" and "${topTwo[1].name}" — are there hidden connections worth exploring?`
    );
  }

  if (questions.length === 0) {
    questions.push(
      "What recurring theme appears across your notes that you haven't explicitly written about yet?"
    );
  }

  return {
    type: "questions",
    title: "SUGGESTED QUESTIONS",
    items: questions.slice(0, 5).map((q) => ({ text: q })),
  };
}

function buildStatsSection(notes: VaultNote[], now: number): DigestSection {
  const totalNotes = notes.length;
  const totalWords = notes.reduce((sum, f) => sum + f.words, 0);
  const notesThisWeek = notes.filter(
    (f) => now - new Date(f.modifiedAt).getTime() <= SEVEN_DAYS_MS
  ).length;

  const folderCount = new Map<string, number>();
  for (const f of notes) {
    const folder = f.folder || "(root)";
    folderCount.set(folder, (folderCount.get(folder) ?? 0) + 1);
  }
  const mostActiveFolder =
    folderCount.size > 0
      ? [...folderCount.entries()].sort((a, b) => b[1] - a[1])[0][0]
      : "(root)";

  return {
    type: "stats",
    title: "VAULT STATS",
    items: [
      { text: "Total notes", meta: String(totalNotes) },
      { text: "Total words", meta: totalWords.toLocaleString() },
      { text: "Modified this week", meta: String(notesThisWeek) },
      { text: "Most active folder", meta: mostActiveFolder },
    ],
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const notes = await getAllNotes();
    if (notes.length === 0) {
      return NextResponse.json(
        { error: "No vault notes found." },
        { status: 404 }
      );
    }

    const now = Date.now();

    const [connectionsSection] = await Promise.all([
      buildConnectionsSection(notes),
    ]);

    const sections: DigestSection[] = [
      buildStatsSection(notes, now),
      buildChangesSection(notes, now),
      connectionsSection,
      buildForgottenSection(notes, now),
      buildQuestionsSection(notes),
    ];

    const response: DigestResponse = {
      generatedAt: new Date().toISOString(),
      sections,
    };

    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
