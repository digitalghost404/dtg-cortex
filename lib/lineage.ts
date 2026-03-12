import fs from "fs";
import path from "path";

export interface LineageEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  query: string;
  sourceNotes: Array<{
    name: string;
    path: string;
    score: number;
  }>;
  webSources?: Array<{
    title: string;
    url: string;
  }>;
}

export interface LineageStore {
  entries: LineageEntry[];
}

const LINEAGE_FILE = path.join(process.cwd(), ".cortex-lineage.json");

export function loadLineage(): LineageStore {
  try {
    if (!fs.existsSync(LINEAGE_FILE)) {
      return { entries: [] };
    }
    const raw = fs.readFileSync(LINEAGE_FILE, "utf-8");
    return JSON.parse(raw) as LineageStore;
  } catch {
    return { entries: [] };
  }
}

export function saveLineageEntry(entry: LineageEntry): void {
  try {
    const store = loadLineage();
    store.entries.push(entry);
    fs.writeFileSync(LINEAGE_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[lineage saveLineageEntry]", err);
  }
}

export function getLineageStats(): {
  totalQueries: number;
  uniqueNotesReferenced: number;
  mostReferencedNotes: Array<{ name: string; path: string; count: number }>;
  recentEntries: LineageEntry[];
  noteTimeline: Array<{
    name: string;
    firstSeen: string;
    lastSeen: string;
    count: number;
  }>;
  queriesPerDay: Array<{ date: string; count: number }>;
} {
  const store = loadLineage();
  const { entries } = store;

  // --- Note reference counts ---
  const noteCountMap = new Map<
    string,
    { name: string; path: string; count: number; timestamps: string[] }
  >();

  for (const entry of entries) {
    for (const note of entry.sourceNotes) {
      const existing = noteCountMap.get(note.name);
      if (existing) {
        existing.count += 1;
        existing.timestamps.push(entry.timestamp);
      } else {
        noteCountMap.set(note.name, {
          name: note.name,
          path: note.path,
          count: 1,
          timestamps: [entry.timestamp],
        });
      }
    }
  }

  const allNoteStats = Array.from(noteCountMap.values()).sort(
    (a, b) => b.count - a.count
  );

  const mostReferencedNotes = allNoteStats
    .slice(0, 20)
    .map(({ name, path, count }) => ({ name, path, count }));

  const uniqueNotesReferenced = noteCountMap.size;

  // --- Recent entries ---
  const recentEntries = [...entries]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 50);

  // --- Note timeline: first and last seen ---
  const noteTimeline = allNoteStats.map(({ name, timestamps }) => {
    const sorted = [...timestamps].sort();
    return {
      name,
      firstSeen: sorted[0],
      lastSeen: sorted[sorted.length - 1],
      count: timestamps.length,
    };
  });

  // --- Queries per day (last 30 days) ---
  const now = new Date();
  const dayMap = new Map<string, number>();

  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dayMap.set(key, 0);
  }

  for (const entry of entries) {
    const day = entry.timestamp.slice(0, 10);
    if (dayMap.has(day)) {
      dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
    }
  }

  const queriesPerDay = Array.from(dayMap.entries()).map(([date, count]) => ({
    date,
    count,
  }));

  return {
    totalQueries: entries.length,
    uniqueNotesReferenced,
    mostReferencedNotes,
    recentEntries,
    noteTimeline,
    queriesPerDay,
  };
}
