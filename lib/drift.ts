// ---------------------------------------------------------------------------
// Drift Detection — track how user interests shift over time
// Compares recent queries (7d) against older queries (30d) to detect
// emerging and fading topics. No LLM — pure keyword frequency analysis.
// ---------------------------------------------------------------------------

import { loadLineage } from "./lineage";

// Common English stop words to filter out
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "are",
  "that", "this", "my", "i", "we", "you", "he", "she", "they", "its",
  "how", "what", "when", "where", "why", "not", "no", "so", "if",
  "can", "do", "does", "did", "will", "would", "could", "should",
  "about", "have", "has", "had", "been", "being", "than", "then",
  "there", "here", "all", "each", "every", "any", "some", "most",
  "me", "him", "her", "them", "us", "who", "which", "more", "much",
  "also", "just", "like", "know", "think", "make", "tell", "use",
]);

export interface DriftAnalysis {
  emerging: string[];  // topics gaining frequency
  fading: string[];    // topics losing frequency
  stable: string[];    // consistently referenced topics
}

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

export async function detectDrift(): Promise<DriftAnalysis> {
  const store = await loadLineage();
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86_400_000;
  const thirtyDaysAgo = now - 30 * 86_400_000;

  const recentKeywords = new Map<string, number>();
  const baselineKeywords = new Map<string, number>();

  for (const entry of store.entries) {
    const ts = new Date(entry.timestamp).getTime();
    const keywords = extractKeywords(entry.query);

    if (ts >= sevenDaysAgo) {
      // Recent window (last 7 days)
      for (const kw of keywords) {
        recentKeywords.set(kw, (recentKeywords.get(kw) ?? 0) + 1);
      }
    } else if (ts >= thirtyDaysAgo) {
      // Baseline window (8-30 days ago)
      for (const kw of keywords) {
        baselineKeywords.set(kw, (baselineKeywords.get(kw) ?? 0) + 1);
      }
    }
  }

  const emerging: string[] = [];
  const fading: string[] = [];
  const stable: string[] = [];

  // Find emerging: keywords much more frequent in recent vs baseline
  for (const [kw, recentCount] of recentKeywords) {
    const baselineCount = baselineKeywords.get(kw) ?? 0;
    if (baselineCount === 0 && recentCount >= 2) {
      // Completely new topic
      emerging.push(kw);
    } else if (baselineCount > 0 && recentCount > baselineCount * 2) {
      // Significant increase
      emerging.push(kw);
    } else if (baselineCount > 0 && Math.abs(recentCount - baselineCount) <= 1) {
      // Roughly stable
      stable.push(kw);
    }
  }

  // Find fading: keywords much more frequent in baseline vs recent
  for (const [kw, baselineCount] of baselineKeywords) {
    const recentCount = recentKeywords.get(kw) ?? 0;
    if (recentCount === 0 && baselineCount >= 2) {
      // Disappeared from recent queries
      fading.push(kw);
    } else if (recentCount > 0 && baselineCount > recentCount * 2) {
      // Significant decrease
      fading.push(kw);
    }
  }

  return {
    emerging: emerging.slice(0, 5),
    fading: fading.slice(0, 5),
    stable: stable.slice(0, 5),
  };
}
