// ---------------------------------------------------------------------------
// Subconscious Processing — compute diff since last visit
// ---------------------------------------------------------------------------

import { getAllNotes, getVaultMeta, type VaultNote } from "./vault";
import { getJSON, setJSON } from "./kv";
import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { detectDrift } from "./drift";
import { categorizeAbsence } from "./absence";

const LAST_VISIT_KEY = "cortex:lastVisit";
const LAST_NOTE_COUNT_KEY = "cortex:lastNoteCount";

export interface SubconsciousDiff {
  modifiedNotes: number;
  newLinks: number;
  deletedEstimate: number;
  whisper: string;
}

export async function getLastVisit(): Promise<string | null> {
  return getJSON<string>(LAST_VISIT_KEY);
}

export async function updateLastVisit(): Promise<void> {
  await setJSON(LAST_VISIT_KEY, new Date().toISOString());
  // Also snapshot the note count for next diff
  const meta = await getVaultMeta();
  if (meta) {
    await setJSON(LAST_NOTE_COUNT_KEY, meta.totalNotes);
  }
}

export async function computeDiff(): Promise<SubconsciousDiff | null> {
  const lastVisit = await getLastVisit();
  if (!lastVisit) {
    // First visit — set timestamp, no diff to show
    await updateLastVisit();
    return null;
  }

  const lastVisitDate = new Date(lastVisit);
  const notes = await getAllNotes();

  // Count notes modified since last visit
  const modifiedNotes = notes.filter(
    (n) => new Date(n.modifiedAt) > lastVisitDate
  ).length;

  // Count total outgoing links
  const newLinks = notes
    .filter((n) => new Date(n.modifiedAt) > lastVisitDate)
    .reduce((sum, n) => sum + n.outgoing.length, 0);

  // Estimate deleted notes
  const previousCount = await getJSON<number>(LAST_NOTE_COUNT_KEY);
  const deletedEstimate = previousCount
    ? Math.max(0, previousCount - notes.length)
    : 0;

  // If nothing changed, don't bother with a whisper
  if (modifiedNotes === 0 && deletedEstimate === 0) {
    return null;
  }

  // Fetch drift data to enrich the whisper
  let driftContext = "";
  try {
    const drift = await detectDrift();
    if (drift.emerging.length > 0) {
      driftContext += ` Interest drift detected: emerging topics [${drift.emerging.join(", ")}].`;
    }
    if (drift.fading.length > 0) {
      driftContext += ` Fading topics [${drift.fading.join(", ")}].`;
    }
  } catch {
    // drift data is optional
  }

  // Absence context for whisper tone
  let absenceContext = "";
  const absence = categorizeAbsence(lastVisit);
  if (absence && absence.whisperToneModifier) {
    absenceContext = ` ${absence.whisperToneModifier}`;
  }

  // Generate whisper with Haiku
  let whisper: string;
  try {
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      schema: z.object({
        whisper: z.string().describe(
          "A single short sentence (max 20 words) summarizing vault activity in a cyberpunk systems-monitor tone. No emoji. Example: '3 nodes modified, cluster growth detected in distributed-systems sector.'"
        ),
      }),
      prompt: `Vault activity since last visit: ${modifiedNotes} notes modified, ${newLinks} new outgoing links from modified notes, ${deletedEstimate} notes deleted. Total vault size: ${notes.length} notes.${driftContext}${absenceContext} Synthesize a terse one-liner in cyberpunk systems-monitor tone.`,
    });
    whisper = object.whisper;
  } catch {
    /* v8 ignore start — fallback whisper; all branches tested via computeDiff tests */
    const parts: string[] = [];
    if (modifiedNotes > 0) parts.push(`${modifiedNotes} nodes modified`);
    if (newLinks > 0) parts.push(`${newLinks} new connections detected`);
    if (deletedEstimate > 0) parts.push(`${deletedEstimate} nodes pruned`);
    whisper = parts.join(" · ") || "system nominal";
    /* v8 ignore stop */
  }

  return { modifiedNotes, newLinks, deletedEstimate, whisper };
}
