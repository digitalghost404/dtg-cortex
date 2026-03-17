// ---------------------------------------------------------------------------
// Cortex Curiosity — detect knowledge gaps and generate questions
// No LLM calls — pure graph analysis + template generation.
// ---------------------------------------------------------------------------

import { getAllNotes } from "./vault";
import { detectDrift } from "./drift";
import { getLineageStats } from "./lineage";
import { getJSON, setJSON } from "./kv";

const CACHE_KEY = "cortex:curiosity";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CachedCuriosity {
  questions: string[];
  generatedAt: number;
}

export async function getCuriosityQuestions(): Promise<string[]> {
  // Check cache
  const cached = await getJSON<CachedCuriosity>(CACHE_KEY);
  if (cached && Date.now() - cached.generatedAt < CACHE_TTL_MS) {
    return cached.questions;
  }

  const questions = await generateCuriosityQuestions();

  await setJSON(CACHE_KEY, {
    questions,
    generatedAt: Date.now(),
  });

  return questions;
}

async function generateCuriosityQuestions(): Promise<string[]> {
  const [notes, drift, lineageStats] = await Promise.all([
    getAllNotes(),
    detectDrift().catch(() => ({ emerging: [], fading: [], stable: [] })),
    getLineageStats(),
  ]);

  if (notes.length === 0) return [];

  const questions: string[] = [];

  // --- Build analysis structures ---

  // Tag frequency map
  const tagNotes = new Map<string, Set<string>>();
  // Folder → notes map
  const folderNotes = new Map<string, string[]>();
  // Outgoing link graph
  const incomingCount = new Map<string, number>();
  const noteByName = new Map<string, typeof notes[0]>();

  for (const note of notes) {
    noteByName.set(note.name, note);

    const folder = note.folder || "(root)";
    if (!folderNotes.has(folder)) folderNotes.set(folder, []);
    folderNotes.get(folder)!.push(note.name);

    for (const tag of note.tags) {
      if (!tagNotes.has(tag)) tagNotes.set(tag, new Set());
      tagNotes.get(tag)!.add(note.name);
    }

    for (const link of note.outgoing) {
      incomingCount.set(link, (incomingCount.get(link) ?? 0) + 1);
    }
  }

  // --- Gap detection ---

  // 1. Tag islands: tags in 5+ notes with zero cross-folder links
  for (const [tag, noteNames] of tagNotes) {
    if (noteNames.size < 5) continue;
    const folders = new Set<string>();
    for (const name of noteNames) {
      const n = noteByName.get(name);
      /* v8 ignore next */
      if (n) folders.add(n.folder || "(root)");
    }
    if (folders.size === 1) {
      const folder = [...folders][0];
      questions.push(
        `You have ${noteNames.size} notes tagged #${tag} but they're all in ${folder === "(root)" ? "the root" : folder}. No cross-pollination?`
      );
    }
  }

  // 2. Dead-end hubs: notes referenced by 3+ others that have no outgoing links
  for (const [name, count] of incomingCount) {
    if (count < 3) continue;
    const note = noteByName.get(name);
    if (note && note.outgoing.length === 0) {
      questions.push(
        `"${name}" is referenced by ${count} other notes but links to nothing. Dead-end hub?`
      );
    }
  }

  // 3. Drift gaps: emerging topics with no dedicated notes
  for (const topic of drift.emerging) {
    const hasNote = notes.some(
      (n) => n.name.toLowerCase().includes(topic) ||
        n.tags.some((t) => t.toLowerCase().includes(topic))
    );
    if (!hasNote) {
      questions.push(
        `Emerging interest in "${topic}" but no dedicated note exists. Worth capturing?`
      );
    }
  }

  // 4. Orphan clusters: folders with no inter-folder links
  const folderLinks = new Map<string, Set<string>>();
  for (const note of notes) {
    const srcFolder = note.folder || "(root)";
    for (const link of note.outgoing) {
      const target = noteByName.get(link);
      if (target) {
        const tgtFolder = target.folder || "(root)";
        if (tgtFolder !== srcFolder) {
          if (!folderLinks.has(srcFolder)) folderLinks.set(srcFolder, new Set());
          folderLinks.get(srcFolder)!.add(tgtFolder);
        }
      }
    }
  }

  for (const [folder, noteList] of folderNotes) {
    if (noteList.length < 3) continue;
    if (!folderLinks.has(folder) || folderLinks.get(folder)!.size === 0) {
      questions.push(
        `${folder === "(root)" ? "Root" : folder} has ${noteList.length} notes but zero links to other folders. Isolated cluster?`
      );
    }
  }

  // 5. Most referenced note never queried
  const mostRef = lineageStats.mostReferencedNotes[0];
  const queriedNames = new Set(
    lineageStats.recentEntries.flatMap((e) => e.sourceNotes.map((s) => s.name))
  );
  if (mostRef && !queriedNames.has(mostRef.name)) {
    questions.push(
      `"${mostRef.name}" is the most referenced note (${mostRef.count}x) but you've never queried about it. Blind spot?`
    );
  }

  // Shuffle and limit to 3-5
  const shuffled = questions.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(5, Math.max(3, shuffled.length)));
}

// --- Gap data for monologue templates ---

export interface CuriosityGapData {
  tagIslands: number;
  deadEndHubs: number;
  driftGaps: string[];
  orphanClusters: number;
}

export async function getCuriosityGapData(): Promise<CuriosityGapData | null> {
  const questions = await getCuriosityQuestions();
  if (questions.length === 0) return null;

  // Rough extraction from question patterns
  return {
    tagIslands: questions.filter((q) => q.includes("cross-pollination")).length,
    deadEndHubs: questions.filter((q) => q.includes("Dead-end hub")).length,
    driftGaps: questions
      .filter((q) => q.includes("Emerging interest"))
      .map((q) => {
        const match = q.match(/"([^"]+)"/);
        return match ? match[1] : "";
      })
      .filter(Boolean),
    orphanClusters: questions.filter((q) => q.includes("Isolated cluster")).length,
  };
}
