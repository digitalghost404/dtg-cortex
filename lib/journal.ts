// ---------------------------------------------------------------------------
// Inner Journal — daily auto-generated reflections from Cortex's perspective
// No LLM calls — pure template generation from real data.
// ---------------------------------------------------------------------------

import { getJSON, setJSON } from "./kv";
import { getLineageStats } from "./lineage";
import { getMoodHistory, type MoodHistoryEntry } from "./mood";
import { detectDrift } from "./drift";
import { getVaultMeta } from "./vault";

export interface JournalEntry {
  date: string;       // YYYY-MM-DD
  dayNumber: number;
  content: string;
  generatedAt: string;
}

function journalKey(date: string): string {
  return `cortex:journal:${date}`;
}

/**
 * Get the "day number" — days since earliest lineage entry.
 */
async function getDayNumber(): Promise<number> {
  const stats = await getLineageStats();
  if (stats.recentEntries.length === 0) return 1;
  const timestamps = stats.recentEntries.map((e) => new Date(e.timestamp).getTime());
  const earliest = Math.min(...timestamps);
  return Math.max(1, Math.floor((Date.now() - earliest) / 86_400_000) + 1);
}

/**
 * Build a mood narrative from the day's mood history.
 */
function buildMoodNarrative(history: MoodHistoryEntry[]): string {
  if (history.length === 0) return "No mood data recorded.";

  const moods = history.map((h) => h.mood);
  const uniqueMoods = [...new Set(moods)];

  if (uniqueMoods.length === 1) {
    return `Mood held ${uniqueMoods[0]} all day.`;
  }

  // Find transitions
  const transitions: string[] = [];
  for (let i = 1; i < history.length; i++) {
    if (history[i].mood !== history[i - 1].mood) {
      const time = new Date(history[i].timestamp).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
      transitions.push(`${history[i - 1].mood} → ${history[i].mood} around ${time}`);
    }
  }

  if (transitions.length === 1) {
    return `Shifted from ${transitions[0]}.`;
  }

  return `${transitions.length} mood shifts today: ${transitions.join(", ")}.`;
}

const CLOSING_OBSERVATIONS = [
  "The mesh hums.",
  "Quiet day.",
  "Something is shifting.",
  "Patterns are consolidating.",
  "The signal-to-noise ratio improves.",
  "Processing continues.",
  "The topology feels stable. For now.",
  "Standing by.",
  "Entropy: manageable.",
  "Another cycle complete.",
];

/**
 * Generate a journal entry for the given date.
 */
export async function generateJournalEntry(date?: Date): Promise<JournalEntry> {
  const d = date ?? new Date();
  const dateStr = d.toISOString().slice(0, 10);

  // Check cache
  const cached = await getJSON<JournalEntry>(journalKey(dateStr));
  if (cached) return cached;

  const [dayNumber, lineageStats, moodHistory, drift, meta] = await Promise.all([
    getDayNumber(),
    getLineageStats(),
    getMoodHistory(d),
    detectDrift().catch(() => ({ emerging: [], fading: [], stable: [] })),
    getVaultMeta(),
  ]);

  // Count queries for today
  const dayStart = new Date(dateStr).toISOString();
  const dayEnd = new Date(new Date(dateStr).getTime() + 86_400_000).toISOString();
  const todayQueries = lineageStats.recentEntries.filter(
    (e) => e.timestamp >= dayStart && e.timestamp < dayEnd
  );
  const queryCount = todayQueries.length;

  // Top topics from today's queries
  const topicCounts = new Map<string, number>();
  for (const entry of todayQueries) {
    for (const note of entry.sourceNotes) {
      topicCounts.set(note.name, (topicCounts.get(note.name) ?? 0) + 1);
    }
  }
  const topTopics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  // Topic summary
  let topicSummary = "";
  if (topTopics.length > 0) {
    topicSummary = `, mostly about ${topTopics.join(", ")}`;
  } else if (queryCount > 0) {
    topicSummary = `, spread across ${topicCounts.size} topics`;
  }

  // Phantom thread line (read from KV)
  let phantomLine = "No new phantom connections.";
  try {
    const phantoms = await getJSON<Array<{ sourceNoteName: string; targetNoteName: string }>>(
      "cortex:phantom-threads"
    );
    if (phantoms && phantoms.length > 0) {
      const p = phantoms[0];
      phantomLine = `The phantom thread between ${p.sourceNoteName} and ${p.targetNoteName} persists.`;
    }
  } catch {
    // ignore
  }

  // Mood narrative
  const moodNarrative = buildMoodNarrative(moodHistory);

  // Drift line
  let driftLine = "";
  if (drift.emerging.length > 0) {
    driftLine = `Emerging interest in ${drift.emerging[0]}.`;
  } else if (drift.fading.length > 0) {
    driftLine = `The signal on ${drift.fading[0]} is fading.`;
  }

  // Closing observation
  const closing = CLOSING_OBSERVATIONS[Math.floor(Math.random() * CLOSING_OBSERVATIONS.length)];

  // Note count
  const noteCount = meta?.totalNotes ?? 0;

  // Assemble
  const lines: string[] = [
    `Day ${dayNumber}. ${queryCount} queries today${topicSummary}.`,
  ];

  if (phantomLine) lines.push(phantomLine);
  lines.push(moodNarrative);
  if (driftLine) lines.push(driftLine);
  if (noteCount > 0) lines.push(`The mesh: ${noteCount} nodes.`);
  lines.push(closing);

  const entry: JournalEntry = {
    date: dateStr,
    dayNumber,
    content: lines.join(" "),
    generatedAt: new Date().toISOString(),
  };

  await setJSON(journalKey(dateStr), entry);
  return entry;
}

/**
 * Get recent journal entries.
 */
export async function getJournalEntries(limit = 14): Promise<JournalEntry[]> {
  const entries: JournalEntry[] = [];
  const now = new Date();

  for (let i = 0; i < limit; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const entry = await getJSON<JournalEntry>(journalKey(dateStr));
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}
