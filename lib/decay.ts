// ---------------------------------------------------------------------------
// Decay Visualization — visual freshness gradient based on note age
// Purely visual: no data is modified, only rendering hints.
// ---------------------------------------------------------------------------

export interface DecayScore {
  path: string;
  decayScore: number; // 0 = fresh (modified today), 1 = fully decayed (90+ days)
}

const DECAY_WINDOW_DAYS = 90;

/**
 * Compute decay scores for a set of notes based on their modifiedAt timestamps.
 * Returns a Map from note path to decay score (0-1).
 */
export function computeDecayScores(
  notes: Array<{ path: string; modifiedAt: string }>
): Map<string, number> {
  const now = Date.now();
  const scores = new Map<string, number>();

  for (const note of notes) {
    const modifiedTime = new Date(note.modifiedAt).getTime();
    const daysSinceModified = (now - modifiedTime) / 86_400_000;
    const decayScore = Math.min(1, Math.max(0, daysSinceModified / DECAY_WINDOW_DAYS));
    scores.set(note.path, decayScore);
  }

  return scores;
}
