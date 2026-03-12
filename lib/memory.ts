import fs from "fs";
import path from "path";

export interface MemoryEntry {
  id: string;
  type: "preference" | "interest" | "fact" | "pattern";
  content: string;
  source: string;
  createdAt: string;
  lastReferencedAt: string;
  referenceCount: number;
}

export interface MemoryStore {
  entries: MemoryEntry[];
}

const MEMORY_FILE = path.join(process.cwd(), ".cortex-memory.json");
const MAX_ENTRIES = 50;

export function loadMemory(): MemoryStore {
  try {
    if (!fs.existsSync(MEMORY_FILE)) {
      return { entries: [] };
    }
    const raw = fs.readFileSync(MEMORY_FILE, "utf-8");
    return JSON.parse(raw) as MemoryStore;
  } catch {
    return { entries: [] };
  }
}

export function saveMemory(store: MemoryStore): void {
  try {
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[memory saveMemory]", err);
  }
}

export function addMemory(
  entry: Omit<MemoryEntry, "id" | "createdAt" | "lastReferencedAt" | "referenceCount">
): void {
  const store = loadMemory();
  const now = new Date().toISOString();

  // Deduplicate: skip if near-identical content already exists (case-insensitive)
  const normalised = entry.content.toLowerCase().trim();
  const duplicate = store.entries.find(
    (e) => e.content.toLowerCase().trim() === normalised
  );
  if (duplicate) {
    duplicate.referenceCount += 1;
    duplicate.lastReferencedAt = now;
    saveMemory(store);
    return;
  }

  const newEntry: MemoryEntry = {
    id: crypto.randomUUID(),
    ...entry,
    createdAt: now,
    lastReferencedAt: now,
    referenceCount: 1,
  };

  store.entries.push(newEntry);

  // Prune to MAX_ENTRIES — remove least-referenced entries first
  if (store.entries.length > MAX_ENTRIES) {
    store.entries.sort((a, b) => b.referenceCount - a.referenceCount);
    store.entries = store.entries.slice(0, MAX_ENTRIES);
  }

  saveMemory(store);
}

export function getRelevantMemories(query: string, limit = 10): MemoryEntry[] {
  const store = loadMemory();
  if (store.entries.length === 0) return [];

  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);

  if (words.length === 0) {
    // Return most-referenced entries when no keywords to match
    return [...store.entries]
      .sort((a, b) => b.referenceCount - a.referenceCount)
      .slice(0, limit);
  }

  const scored = store.entries.map((entry) => {
    const contentLower = entry.content.toLowerCase();
    let score = 0;
    for (const word of words) {
      if (contentLower.includes(word)) score += 1;
    }
    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.referenceCount - a.entry.referenceCount)
    .slice(0, limit)
    .map((s) => s.entry);
}

export function getMemoryContext(): string {
  const store = loadMemory();
  if (store.entries.length === 0) return "";

  // Take top 10 by reference count for the system prompt
  const top = [...store.entries]
    .sort((a, b) => b.referenceCount - a.referenceCount)
    .slice(0, 10);

  const lines = top.map(
    (e) => `- ${e.content} (referenced ${e.referenceCount} time${e.referenceCount === 1 ? "" : "s"})`
  );

  return `Your memory of this user:\n${lines.join("\n")}`;
}

export function getAllMemories(): MemoryEntry[] {
  return loadMemory().entries;
}

export function deleteMemory(id: string): void {
  const store = loadMemory();
  store.entries = store.entries.filter((e) => e.id !== id);
  saveMemory(store);
}

export function touchMemory(id: string): void {
  const store = loadMemory();
  const entry = store.entries.find((e) => e.id === id);
  if (entry) {
    entry.referenceCount += 1;
    entry.lastReferencedAt = new Date().toISOString();
    saveMemory(store);
  }
}
