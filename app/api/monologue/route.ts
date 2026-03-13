import { NextResponse } from "next/server";
import { getVaultMeta, getAllNotes } from "@/lib/vault";
import { getLineageStats } from "@/lib/lineage";
import { getJSON } from "@/lib/kv";
import type { MonologueStats } from "@/lib/monologue";
import type { PhantomThread } from "@/lib/phantom-threads";
import { computeMood } from "@/lib/mood";
import { detectDrift } from "@/lib/drift";
import { getCircadianPhase } from "@/lib/circadian";
import { getCuriosityGapData } from "@/lib/curiosity";
import { categorizeAbsence } from "@/lib/absence";

export async function GET() {
  try {
    const [meta, lineageStats, notes, phantoms, mood, drift, curiosityGaps, lastVisit] = await Promise.all([
      getVaultMeta(),
      getLineageStats(),
      getAllNotes(),
      getJSON<PhantomThread[]>("cortex:phantom-threads"),
      computeMood().catch(() => null),
      detectDrift().catch(() => null),
      getCuriosityGapData().catch(() => null),
      getJSON<string>("cortex:lastVisit"),
    ]);

    // Find oldest unreferenced note
    const allLinkedNames = new Set<string>();
    for (const note of notes) {
      for (const out of note.outgoing) {
        allLinkedNames.add(out);
      }
    }

    let oldestUnreferencedNote: string | null = null;
    let oldestUnreferencedDays = 0;
    const now = Date.now();

    for (const note of notes) {
      if (!allLinkedNames.has(note.name)) {
        const days = Math.floor((now - new Date(note.modifiedAt).getTime()) / (1000 * 60 * 60 * 24));
        if (days > oldestUnreferencedDays) {
          oldestUnreferencedDays = days;
          oldestUnreferencedNote = note.name;
        }
      }
    }

    // Recent queries (last 24h)
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const recentQueryCount = lineageStats.recentEntries.filter(
      (e) => e.timestamp > dayAgo
    ).length;

    const stats: MonologueStats = {
      totalNotes: meta?.totalNotes ?? notes.length,
      totalWords: meta?.totalWords ?? 0,
      totalQueries: lineageStats.totalQueries,
      orphanCount: notes.filter((n) => !allLinkedNames.has(n.name) && n.outgoing.length === 0).length,
      clusterCount: Math.max(1, Math.ceil(notes.length / 10)), // rough estimate
      mostReferencedNote: lineageStats.mostReferencedNotes[0]?.name ?? null,
      mostReferencedCount: lineageStats.mostReferencedNotes[0]?.count ?? 0,
      oldestUnreferencedNote,
      oldestUnreferencedDays,
      briefingResonances: 0,
      phantomThreadCount: phantoms?.length ?? 0,
      recentQueryCount,
    };

    // Build query histogram (24 hourly buckets for VaultHeartbeat)
    const queryHistogram: number[] = new Array(24).fill(0);
    const nowMs = Date.now();
    for (const entry of lineageStats.recentEntries) {
      const entryMs = new Date(entry.timestamp).getTime();
      const hoursAgo = Math.floor((nowMs - entryMs) / 3_600_000);
      if (hoursAgo >= 0 && hoursAgo < 24) {
        queryHistogram[23 - hoursAgo]++;
      }
    }

    // Circadian phase
    const circadian = getCircadianPhase(new Date().getHours());

    // Absence tier
    const absence = categorizeAbsence(lastVisit);

    return NextResponse.json({
      ...stats,
      mood: mood?.mood ?? null,
      moodIntensity: mood?.intensity ?? null,
      drift: drift ?? null,
      queryHistogram,
      circadianPhase: circadian.phase,
      scrollSpeedFactor: circadian.scrollSpeedFactor,
      curiosityGaps: curiosityGaps ?? null,
      absenceTier: absence?.tier ?? null,
      absenceDays: absence?.days ?? 0,
    });
  } catch (err) {
    console.error("[monologue]", err);
    return NextResponse.json(
      { error: "Failed to gather monologue stats" },
      { status: 500 }
    );
  }
}
