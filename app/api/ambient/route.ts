import { NextResponse } from "next/server";
import { getAllNotes } from "@/lib/vault";
import type { VaultNote } from "@/lib/vault";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AmbientCard {
  type: "quote" | "stat" | "connection" | "forgotten" | "tag_cloud" | "on_this_day";
  title: string;
  content: string;
  meta?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pickRandom<T>(arr: T[], count: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function extractQuote(content: string): string {
  const cleaned = content
    .replace(/#+\s+/g, "")
    .replace(/\*\*?([^*]+)\*\*?/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`[^`]+`/g, "")
    .trim();

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && s.length < 300);

  if (sentences.length === 0) return cleaned.slice(0, 200);

  const count = Math.min(4, Math.max(2, sentences.length));
  const start = Math.floor(Math.random() * Math.max(1, sentences.length - count));
  return sentences.slice(start, start + count).join(" ");
}

function firstLine(content: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.length > 10) {
      return trimmed.slice(0, 160);
    }
  }
  return "(no excerpt)";
}

// ---------------------------------------------------------------------------
// Card generators
// ---------------------------------------------------------------------------

function makeQuoteCard(notes: VaultNote[]): AmbientCard | null {
  const candidates = notes.filter((n) => n.content.trim().length > 100);
  if (candidates.length === 0) return null;
  const note = candidates[Math.floor(Math.random() * candidates.length)];
  const quote = extractQuote(note.content);
  return {
    type: "quote",
    title: "VAULT EXCERPT",
    content: quote,
    meta: note.name,
  };
}

function makeStatCard(notes: VaultNote[]): AmbientCard {
  const stats = [
    () => {
      const folders = new Set(notes.map((n) => n.folder).filter((f) => f !== "(root)"));
      return {
        title: "VAULT SCOPE",
        content: `${notes.length}`,
        meta: `notes across ${Math.max(1, folders.size)} folder${folders.size !== 1 ? "s" : ""}`,
      };
    },
    () => {
      const totalWords = notes.reduce((sum, n) => sum + n.words, 0);
      return {
        title: "TOTAL WORDS",
        content: totalWords.toLocaleString(),
        meta: "words written across all notes",
      };
    },
    () => {
      const withLinks = notes.filter((n) => n.outgoing.length > 0).length;
      return {
        title: "LINKED NOTES",
        content: `${withLinks}`,
        meta: `of ${notes.length} notes have outgoing links`,
      };
    },
    () => {
      const tagSet = new Set<string>();
      notes.forEach((n) => n.tags.forEach((t) => tagSet.add(t)));
      return {
        title: "UNIQUE TAGS",
        content: `${tagSet.size}`,
        meta: "distinct tags catalogued",
      };
    },
    () => {
      const avgWords = Math.round(
        notes.reduce((sum, n) => sum + n.words, 0) / Math.max(1, notes.length)
      );
      return {
        title: "AVG NOTE LENGTH",
        content: `${avgWords}`,
        meta: "average words per note",
      };
    },
  ];
  const fn = stats[Math.floor(Math.random() * stats.length)];
  return { type: "stat", ...fn() };
}

function makeConnectionCard(notes: VaultNote[]): AmbientCard | null {
  const nameSet = new Set(notes.map((n) => n.name.toLowerCase()));
  const pairs: Array<{ from: string; to: string }> = [];
  for (const note of notes) {
    for (const target of note.outgoing) {
      if (nameSet.has(target.toLowerCase()) && target.toLowerCase() !== note.name.toLowerCase()) {
        pairs.push({ from: note.name, to: target });
      }
    }
  }
  if (pairs.length === 0) return null;
  const pair = pairs[Math.floor(Math.random() * pairs.length)];
  return {
    type: "connection",
    title: "KNOWLEDGE LINK",
    content: `${pair.from} → ${pair.to}`,
    meta: `[[${pair.from}]] links to [[${pair.to}]]`,
  };
}

function makeForgottenCard(notes: VaultNote[]): AmbientCard | null {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const old = notes.filter((n) => new Date(n.modifiedAt).getTime() < cutoff);
  if (old.length === 0) return null;
  const note = old[Math.floor(Math.random() * old.length)];
  const daysSince = Math.floor((Date.now() - new Date(note.modifiedAt).getTime()) / (24 * 60 * 60 * 1000));
  return {
    type: "forgotten",
    title: "MEMORY FADING",
    content: firstLine(note.content),
    meta: `${note.name} · last modified ${daysSince} days ago`,
  };
}

function makeTagCloudCard(notes: VaultNote[]): AmbientCard | null {
  const tagCounts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  if (tagCounts.size === 0) return null;
  const top5 = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const content = top5.map(([tag, count]) => `${tag}:${count}`).join(" ");
  return {
    type: "tag_cloud",
    title: "TAG FREQUENCY",
    content,
    meta: `${tagCounts.size} total tags`,
  };
}

function makeOnThisDayCard(notes: VaultNote[]): AmbientCard | null {
  const now = new Date();
  const month = now.getMonth();
  const day = now.getDate();
  const currentYear = now.getFullYear();

  const matches = notes.filter((n) => {
    const d = new Date(n.modifiedAt);
    return d.getMonth() === month && d.getDate() === day && d.getFullYear() < currentYear;
  });
  if (matches.length === 0) return null;

  const names = matches.map((n) => n.name).join(", ");
  return {
    type: "on_this_day",
    title: "ON THIS DAY",
    content: names,
    meta: `${matches.length} note${matches.length !== 1 ? "s" : ""} touched on this date in previous years`,
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const notes = await getAllNotes();
    if (notes.length === 0) {
      return NextResponse.json({ cards: [] });
    }

    const pool: AmbientCard[] = [];

    for (let i = 0; i < 4; i++) {
      const c = makeQuoteCard(notes);
      if (c) pool.push(c);
    }
    for (let i = 0; i < 3; i++) {
      pool.push(makeStatCard(notes));
    }
    for (let i = 0; i < 3; i++) {
      const c = makeConnectionCard(notes);
      if (c) pool.push(c);
    }
    {
      const c = makeForgottenCard(notes);
      if (c) pool.push(c);
    }
    {
      const c = makeTagCloudCard(notes);
      if (c) pool.push(c);
    }
    {
      const c = makeOnThisDayCard(notes);
      if (c) pool.push(c);
    }

    const count = Math.floor(Math.random() * 4) + 5;
    const cards = pickRandom(pool, Math.min(count, pool.length));

    return NextResponse.json({ cards });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
