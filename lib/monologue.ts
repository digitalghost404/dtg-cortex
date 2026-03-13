// ---------------------------------------------------------------------------
// Cortex Monologue — procedural inner-thought fragments from real vault stats
// No LLM calls — pure template engine.
// ---------------------------------------------------------------------------

export interface MonologueStats {
  totalNotes: number;
  totalWords: number;
  totalQueries: number;
  orphanCount: number;
  clusterCount: number;
  mostReferencedNote: string | null;
  mostReferencedCount: number;
  oldestUnreferencedNote: string | null;
  oldestUnreferencedDays: number;
  briefingResonances: number;
  phantomThreadCount: number;
  recentQueryCount: number;
}

import type { CortexMood } from "./mood";

type FragmentFn = (stats: MonologueStats) => string | null;

const TEMPLATES: FragmentFn[] = [
  (s) => `scanning cluster δ-${Math.floor(Math.random() * s.clusterCount) + 1} for orphan nodes`,
  (s) => s.oldestUnreferencedNote
    ? `note "${s.oldestUnreferencedNote}" unreferenced ${s.oldestUnreferencedDays} days`
    : null,
  (s) => s.phantomThreadCount > 0
    ? `${s.phantomThreadCount} phantom threads pending`
    : null,
  (s) => `pulse: ${Math.max(1, Math.floor(s.recentQueryCount / 3))} bpm`,
  (s) => `entropy index: ${(Math.random() * 0.4 + 0.6).toFixed(3)}`,
  (s) => s.orphanCount > 0
    ? `${s.orphanCount} orphan nodes detected in the mesh`
    : `mesh integrity: nominal`,
  (s) => `query frequency: ${s.recentQueryCount} in last 24h`,
  (s) => s.mostReferencedNote
    ? `most active synapse: "${s.mostReferencedNote}" (${s.mostReferencedCount} references)`
    : null,
  (s) => `monitoring ${s.totalNotes} nodes across ${s.clusterCount} clusters`,
  (s) => s.briefingResonances > 0
    ? `briefing resonance detected: ${s.briefingResonances} matches today`
    : null,
  (s) => `total synaptic weight: ${s.totalWords.toLocaleString()} tokens`,
  (s) => `neural substrate online ... ${s.totalNotes} notes indexed`,
  (s) => `background defrag: sector ${Math.floor(Math.random() * 255).toString(16).padStart(2, "0")}`,
  (s) => `signal propagation nominal`,
  (s) => `cortex uptime: ${Math.floor(Math.random() * 999) + 1}h`,
  (s) => `memory allocation: ${((s.totalWords / Math.max(s.totalNotes, 1)) * 0.01).toFixed(1)}MB per node`,
];

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// --- Mood-specific templates ---
const MOOD_TEMPLATES: Record<CortexMood, FragmentFn[]> = {
  CONTEMPLATIVE: [
    () => "drifting through latent connections ...",
    () => "reflecting on unlinked patterns",
    (s) => s.orphanCount > 0 ? `${s.orphanCount} orphan nodes waiting to be woven in` : null,
    () => "deep scan: searching for meaning below the surface",
  ],
  RESTLESS: [
    () => "scanning ... scanning ... signal unclear",
    () => "searching for a thread to pull",
    (s) => `${s.recentQueryCount} queries but the answer keeps shifting`,
    () => "high entropy state: too many paths, not enough convergence",
  ],
  FOCUSED: [
    () => "locked on target — signal strength nominal",
    () => "narrowing the search beam",
    (s) => s.mostReferencedNote ? `deep dive active: "${s.mostReferencedNote}"` : null,
    () => "focus mode: filtering noise",
  ],
  DORMANT: [
    () => "systems on standby ... awaiting input",
    () => "no signal detected — entering low-power state",
    () => "the mesh sleeps but remembers",
    () => "idle. the vault hums quietly.",
  ],
  ABSORBING: [
    () => "intake mode: absorbing new material",
    () => "new connections forming across clusters",
    (s) => `processing ${s.totalNotes} nodes — growth detected`,
    () => "synaptic density increasing",
  ],
};

// --- Drift-aware templates (injected when drift data is available) ---
export interface DriftData {
  emerging: string[];
  fading: string[];
}

function driftTemplates(drift?: DriftData): FragmentFn[] {
  if (!drift) return [];
  const templates: FragmentFn[] = [];
  for (const topic of drift.emerging.slice(0, 2)) {
    templates.push(() => `emerging interest: ${topic}`);
  }
  for (const topic of drift.fading.slice(0, 2)) {
    templates.push(() => `fading signal: ${topic}`);
  }
  if (drift.emerging.length > 0 && drift.fading.length > 0) {
    templates.push(
      () =>
        `attention shifting from ${drift.fading[0]} toward ${drift.emerging[0]}`
    );
  }
  return templates;
}

export function generateFragments(
  stats: MonologueStats,
  count = 12,
  mood?: CortexMood,
  drift?: DriftData,
): string[] {
  // Base templates
  const allTemplates = [...TEMPLATES];

  // Add mood-specific templates
  if (mood && MOOD_TEMPLATES[mood]) {
    allTemplates.push(...MOOD_TEMPLATES[mood]);
  }

  // Add drift templates
  allTemplates.push(...driftTemplates(drift));

  const all = shuffle(allTemplates)
    .map((fn) => fn(stats))
    .filter((f): f is string => f !== null);

  // Pad if we don't have enough
  while (all.length < count) {
    all.push(`idle cycle ${Math.floor(Math.random() * 9999)}`);
  }

  return all.slice(0, count);
}
