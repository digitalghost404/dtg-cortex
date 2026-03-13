// ---------------------------------------------------------------------------
// Resonance Events — find semantic matches between briefing stories and vault
// ---------------------------------------------------------------------------

import { queryIndex } from "./indexer";
import type { BriefingStory } from "./briefing";

export interface Resonance {
  noteName: string;
  notePath: string;
  score: number;
}

export interface StoryWithResonances extends BriefingStory {
  resonances?: Resonance[];
}

const RESONANCE_THRESHOLD = 0.7;

export async function findResonances(
  stories: BriefingStory[]
): Promise<Map<number, Resonance[]>> {
  const resonanceMap = new Map<number, Resonance[]>();

  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    const query = `${story.title} ${story.snippet}`;

    try {
      const results = await queryIndex(query, 3);
      const matches = results
        .filter((r) => r.score > RESONANCE_THRESHOLD)
        .map((r) => ({
          noteName: r.name,
          notePath: r.path,
          score: r.score,
        }));

      // Deduplicate by note path
      const seen = new Set<string>();
      const deduped = matches.filter((m) => {
        if (seen.has(m.notePath)) return false;
        seen.add(m.notePath);
        return true;
      });

      if (deduped.length > 0) {
        resonanceMap.set(i, deduped);
      }
    } catch {
      // Index not available — skip resonances
    }
  }

  return resonanceMap;
}
