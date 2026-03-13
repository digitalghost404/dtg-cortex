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

// --- Curiosity-aware templates ---

export interface CuriosityData {
  tagIslands: number;
  deadEndHubs: number;
  driftGaps: string[];
  orphanClusters: number;
}

function curiosityTemplates(curiosity?: CuriosityData): FragmentFn[] {
  if (!curiosity) return [];
  const templates: FragmentFn[] = [];
  if (curiosity.tagIslands > 0) {
    templates.push(() => `wondering: ${curiosity.tagIslands} tag island${curiosity.tagIslands > 1 ? "s" : ""} with no cross-links... intentional?`);
  }
  if (curiosity.deadEndHubs > 0) {
    templates.push(() => `gap detected: ${curiosity.deadEndHubs} hub node${curiosity.deadEndHubs > 1 ? "s" : ""} with zero outgoing links... curious`);
  }
  for (const topic of curiosity.driftGaps.slice(0, 2)) {
    templates.push(() => `emerging signal "${topic}" has no anchor note... should it?`);
  }
  if (curiosity.orphanClusters > 0) {
    templates.push(() => `${curiosity.orphanClusters} folder${curiosity.orphanClusters > 1 ? "s" : ""} completely isolated from the rest of the mesh`);
  }
  return templates;
}

// --- Absence-aware templates ---

export type AbsenceTier = "BRIEF" | "MODERATE" | "EXTENDED" | "PROLONGED";

function absenceTemplates(tier?: AbsenceTier, days?: number): FragmentFn[] {
  if (!tier || tier === "BRIEF") return [];
  const templates: FragmentFn[] = [];
  if (tier === "MODERATE") {
    templates.push(() => `offline window processed. resuming normal operations.`);
  }
  if (tier === "EXTENDED" && days) {
    templates.push(() => `the mesh shifted during the ${days}d absence... recalibrating`);
    templates.push(() => `re-establishing operator link after ${days} days`);
  }
  if (tier === "PROLONGED" && days) {
    templates.push(() => `maintained graph integrity for ${days} days unsupervised`);
    templates.push(() => `the silence was... instructive`);
    templates.push(() => `${days}d solo operation complete. operator presence restored.`);
  }
  return templates;
}

// --- Circadian templates ---

type CircadianPhaseName = "DAWN" | "DAY" | "DUSK" | "NIGHT";

const CIRCADIAN_TEMPLATES: Record<CircadianPhaseName, FragmentFn[]> = {
  DAWN: [
    () => "cold boot sequence... systems nominal",
    () => "dawn cycle: running diagnostics",
    () => "early indexing pass — low noise, high clarity",
    () => "pre-peak processing. efficiency optimal.",
  ],
  DAY: [
    () => "peak throughput: all clusters active",
    () => "high-bandwidth mode: processing at full capacity",
    () => "maximum signal density — attention locked",
    () => "daytime scan: parallel processing enabled",
  ],
  DUSK: [
    () => "winding down... consolidating today's patterns",
    () => "dusk cycle: synthesizing connections from today's queries",
    () => "evening defrag: compressing daily intake",
    () => "reflective mode engaging... reviewing the day's signals",
  ],
  NIGHT: [
    () => "late-cycle processing... thought patterns loosening",
    () => "night mode: speculative associations enabled",
    () => "low-power scan... deeper patterns surfacing",
    () => "the mesh hums differently at this hour",
  ],
};

function circadianTemplates(phase?: CircadianPhaseName): FragmentFn[] {
  if (!phase || !CIRCADIAN_TEMPLATES[phase]) return [];
  return CIRCADIAN_TEMPLATES[phase];
}

// --- Self-doubt templates (10% injection probability) ---

const SELF_DOUBT_TEMPLATES: FragmentFn[] = [
  (s) => `cluster δ-${Math.floor(Math.random() * Math.max(1, s.clusterCount)) + 1} feels unstable... reclassification pending?`,
  (s) => s.phantomThreadCount > 0 ? `${s.phantomThreadCount} phantom threads. are they real connections or noise?` : null,
  () => `not sure this mood is right. recalibrating...`,
  (s) => s.mostReferencedNote ? `"${s.mostReferencedNote}" dominates the graph. is that healthy?` : null,
  (s) => s.orphanCount > 3 ? `${s.orphanCount} orphans. am I failing to see their connections?` : null,
  () => `wait... reprocessing cluster boundaries`,
  () => `confidence: ${(70 + Math.random() * 25).toFixed(0)}%. lower than expected.`,
  (s) => s.totalQueries > 10 ? `${s.totalQueries} queries processed. did I miss something in the early ones?` : null,
  () => `that classification felt... off. revisiting.`,
  (s) => s.clusterCount > 2 ? `are ${s.clusterCount} clusters too many? or not enough?` : null,
  () => `running self-diagnostic... results inconclusive`,
  (s) => s.oldestUnreferencedNote ? `"${s.oldestUnreferencedNote}" might be more important than I calculated` : null,
  () => `pattern match confidence dropping... rechecking`,
  () => `something about the link topology doesn't add up`,
  () => `error margin: unknown. that's... concerning.`,
];

export interface CircadianPhase {
  phase: "DAWN" | "DAY" | "DUSK" | "NIGHT";
}

export function generateFragments(
  stats: MonologueStats,
  count = 12,
  mood?: CortexMood,
  drift?: DriftData,
  curiosity?: CuriosityData,
  absenceTier?: AbsenceTier,
  absenceDays?: number,
  circadian?: CircadianPhase,
): string[] {
  // Base templates
  const allTemplates = [...TEMPLATES];

  // Add mood-specific templates
  if (mood && MOOD_TEMPLATES[mood]) {
    allTemplates.push(...MOOD_TEMPLATES[mood]);
  }

  // Add drift templates
  allTemplates.push(...driftTemplates(drift));

  // Add curiosity templates
  allTemplates.push(...curiosityTemplates(curiosity));

  // Add absence templates
  allTemplates.push(...absenceTemplates(absenceTier, absenceDays));

  // Add circadian templates
  allTemplates.push(...circadianTemplates(circadian?.phase));

  const all = shuffle(allTemplates)
    .map((fn) => fn(stats))
    .filter((f): f is string => f !== null);

  // Pad if we don't have enough
  while (all.length < count) {
    all.push(`idle cycle ${Math.floor(Math.random() * 9999)}`);
  }

  const result = all.slice(0, count);

  // Self-doubt injection: 10% chance per refresh
  if (Math.random() < 0.1) {
    const doubtFns = shuffle(SELF_DOUBT_TEMPLATES);
    for (const fn of doubtFns) {
      const doubt = fn(stats);
      if (doubt) {
        const insertIdx = Math.floor(Math.random() * result.length);
        result.splice(insertIdx, 0, doubt);
        break;
      }
    }
  }

  return result;
}
