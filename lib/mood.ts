// ---------------------------------------------------------------------------
// Cortex Mood — computed disposition from vault activity patterns
// Pure computation, no LLM calls.
// ---------------------------------------------------------------------------

import { getVaultMeta } from "./vault";
import { getLineageStats } from "./lineage";
import { getJSON } from "./kv";

export type CortexMood =
  | "CONTEMPLATIVE"
  | "RESTLESS"
  | "FOCUSED"
  | "DORMANT"
  | "ABSORBING";

export interface MoodState {
  mood: CortexMood;
  intensity: number; // 0-1
}

/**
 * Compute the current Cortex mood from vault stats, query patterns, and activity recency.
 *
 * - CONTEMPLATIVE: low query rate + many notes modified recently
 * - RESTLESS: high query rate + few notes modified (searching but not finding)
 * - FOCUSED: queries concentrated on 1-2 topics
 * - DORMANT: no activity in 24h+
 * - ABSORBING: many new notes or links created recently
 */
export async function computeMood(): Promise<MoodState> {
  const [meta, lineageStats, lastVisit] = await Promise.all([
    getVaultMeta(),
    getLineageStats(),
    getJSON<string>("cortex:lastVisit"),
  ]);

  const now = Date.now();
  const totalNotes = meta?.totalNotes ?? 0;

  // --- Activity recency ---
  const lastVisitMs = lastVisit ? new Date(lastVisit).getTime() : 0;
  const hoursSinceVisit = lastVisitMs ? (now - lastVisitMs) / 3_600_000 : Infinity;

  // --- Recent query analysis ---
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const recentEntries = lineageStats.recentEntries.filter(
    (e) => e.timestamp > dayAgo
  );
  const recentQueryCount = recentEntries.length;

  // --- Topic concentration (are queries focused on few topics?) ---
  const topicCounts = new Map<string, number>();
  for (const entry of recentEntries) {
    for (const note of entry.sourceNotes) {
      topicCounts.set(note.name, (topicCounts.get(note.name) ?? 0) + 1);
    }
  }
  const topTopics = [...topicCounts.values()].sort((a, b) => b - a);
  const topTwoShare =
    topTopics.length > 0
      ? (topTopics.slice(0, 2).reduce((s, v) => s + v, 0) /
          Math.max(1, topTopics.reduce((s, v) => s + v, 0)))
      : 0;

  // --- Recent modifications (from queriesPerDay proxy) ---
  const recentDays = lineageStats.queriesPerDay.slice(-7);
  const weeklyQueries = recentDays.reduce((s, d) => s + d.count, 0);

  // --- Determine mood ---

  // DORMANT: no activity in 24h+
  if (hoursSinceVisit > 24) {
    return { mood: "DORMANT", intensity: Math.min(1, hoursSinceVisit / 72) };
  }

  // FOCUSED: top 2 topics account for >60% of recent query references
  if (recentQueryCount >= 3 && topTwoShare > 0.6) {
    return { mood: "FOCUSED", intensity: Math.min(1, topTwoShare) };
  }

  // RESTLESS: high query rate but few unique notes referenced
  if (recentQueryCount > 5 && topicCounts.size < 3) {
    return {
      mood: "RESTLESS",
      intensity: Math.min(1, recentQueryCount / 15),
    };
  }

  // ABSORBING: many queries spread across many topics (learning/intake mode)
  if (recentQueryCount > 3 && topicCounts.size > 5) {
    return {
      mood: "ABSORBING",
      intensity: Math.min(1, topicCounts.size / 10),
    };
  }

  // CONTEMPLATIVE: default — low activity, reflective
  return {
    mood: "CONTEMPLATIVE",
    intensity: Math.max(0.3, 1 - recentQueryCount / 10),
  };
}
