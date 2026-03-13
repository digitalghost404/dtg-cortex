import { NextResponse } from "next/server";
import { getVaultMeta } from "@/lib/vault";
import { computeMood } from "@/lib/mood";
import { getPhantomThreads } from "@/lib/phantom-threads";
import { getScars } from "@/lib/scars";
import { getJSON } from "@/lib/kv";
import { indexExists } from "@/lib/indexer";
import { categorizeAbsence } from "@/lib/absence";
import { getCircadianPhase } from "@/lib/circadian";

export async function GET() {
  try {
    const [meta, mood, phantoms, scars, lastVisit, indexed] = await Promise.all([
      getVaultMeta(),
      computeMood().catch(() => ({ mood: "DORMANT" as const, intensity: 0.5 })),
      getPhantomThreads().catch(() => []),
      getScars().catch(() => []),
      getJSON<string>("cortex:lastVisit"),
      indexExists().catch(() => false),
    ]);

    const noteCount = meta?.totalNotes ?? 0;
    const totalWords = meta?.totalWords ?? 0;

    // Compute last sync age
    let lastSyncAgo = "unknown";
    if (lastVisit) {
      const ms = Date.now() - new Date(lastVisit).getTime();
      const hours = Math.floor(ms / 3_600_000);
      const minutes = Math.floor((ms % 3_600_000) / 60_000);
      if (hours > 24) {
        lastSyncAgo = `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
      } else if (hours > 0) {
        lastSyncAgo = `${hours}h ${minutes}m ago`;
      } else {
        lastSyncAgo = `${minutes}m ago`;
      }
    }

    // Fragment count (template count in monologue.ts)
    const fragmentCount = 15; // base template count

    // Absence recognition
    const absence = categorizeAbsence(lastVisit);

    // Circadian phase
    const circadian = getCircadianPhase(new Date().getHours());

    // Build dynamic boot lines
    const absenceLines = absence && absence.tier !== "BRIEF"
      ? absence.bootLines
      : [];

    const circadianLines: string[] = [];
    if (circadian.phase === "NIGHT") {
      circadianLines.push("NIGHT MODE ACTIVE — dream processing enabled");
    } else if (circadian.phase === "DAWN") {
      circadianLines.push("DAWN SEQUENCE — running diagnostics");
    }

    return NextResponse.json({
      noteCount,
      totalWords,
      indexedCount: indexed ? noteCount : 0,
      phantomCount: phantoms.length,
      scarCount: scars.length,
      lastSyncAgo,
      currentMood: mood.mood,
      moodIntensity: mood.intensity,
      fragmentCount,
      absenceLines,
      circadianLines,
      absenceTier: absence?.tier ?? null,
    });
  } catch (err) {
    console.error("[boot]", err);
    return NextResponse.json({ error: "Boot stats unavailable" }, { status: 500 });
  }
}
