import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateFragments } from "@/lib/monologue";
import type { MonologueStats, DriftData, CuriosityData } from "@/lib/monologue";

const baseStats: MonologueStats = {
  totalNotes: 100,
  totalWords: 50000,
  totalQueries: 25,
  orphanCount: 5,
  clusterCount: 8,
  mostReferencedNote: "systems-thinking.md",
  mostReferencedCount: 12,
  oldestUnreferencedNote: "old-idea.md",
  oldestUnreferencedDays: 45,
  briefingResonances: 2,
  phantomThreadCount: 3,
  recentQueryCount: 10,
};

describe("generateFragments", () => {
  it("returns at least the requested count", () => {
    const result = generateFragments(baseStats, 5);
    expect(result.length).toBeGreaterThanOrEqual(5);
  });

  it("defaults to 12 fragments when count is omitted", () => {
    const result = generateFragments(baseStats);
    expect(result.length).toBeGreaterThanOrEqual(12);
  });

  it("returns all strings (no nulls)", () => {
    const result = generateFragments(baseStats, 10);
    for (const fragment of result) {
      expect(typeof fragment).toBe("string");
      expect(fragment.length).toBeGreaterThan(0);
    }
  });

  it("pads with idle cycle fragments when templates are insufficient", () => {
    // Request more than available templates
    const result = generateFragments(baseStats, 200);
    expect(result.length).toBeGreaterThanOrEqual(200);
    expect(result.some((f) => f.startsWith("idle cycle"))).toBe(true);
  });

  it("includes mood-specific content when mood is provided", () => {
    // Run multiple times to overcome randomness
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, "DORMANT"));
    }
    expect(allFragments.some((f) => f.includes("standby") || f.includes("sleeps") || f.includes("idle") || f.includes("awaiting"))).toBe(true);
  });

  it("includes drift content when drift data is provided", () => {
    const drift: DriftData = {
      emerging: ["kubernetes", "RAG"],
      fading: ["docker"],
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, drift));
    }
    expect(allFragments.some((f) => f.includes("kubernetes") || f.includes("RAG"))).toBe(true);
    expect(allFragments.some((f) => f.includes("docker"))).toBe(true);
  });

  it("includes curiosity content when curiosity data is provided", () => {
    const curiosity: CuriosityData = {
      tagIslands: 3,
      deadEndHubs: 1,
      driftGaps: ["quantum computing"],
      orphanClusters: 2,
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, curiosity));
    }
    expect(allFragments.some((f) => f.includes("tag island") || f.includes("hub node") || f.includes("quantum computing") || f.includes("isolated"))).toBe(true);
  });

  it("includes absence content for PROLONGED tier", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, undefined, "PROLONGED", 14));
    }
    expect(allFragments.some((f) => f.includes("14") || f.includes("silence"))).toBe(true);
  });

  it("includes circadian content when phase is provided", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, undefined, undefined, undefined, { phase: "NIGHT" }));
    }
    expect(allFragments.some((f) => f.includes("night") || f.includes("late-cycle") || f.includes("speculative") || f.includes("hums differently"))).toBe(true);
  });

  it("handles zero stats without crashing", () => {
    const zeroStats: MonologueStats = {
      totalNotes: 0,
      totalWords: 0,
      totalQueries: 0,
      orphanCount: 0,
      clusterCount: 0,
      mostReferencedNote: null,
      mostReferencedCount: 0,
      oldestUnreferencedNote: null,
      oldestUnreferencedDays: 0,
      briefingResonances: 0,
      phantomThreadCount: 0,
      recentQueryCount: 0,
    };
    const result = generateFragments(zeroStats, 5);
    expect(result.length).toBeGreaterThanOrEqual(5);
  });

  it("includes MODERATE absence content", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, undefined, "MODERATE"));
    }
    expect(allFragments.some((f) => f.includes("offline window") || f.includes("resuming"))).toBe(true);
  });

  it("includes EXTENDED absence content with day count", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, undefined, "EXTENDED", 7));
    }
    expect(allFragments.some((f) => f.includes("7"))).toBe(true);
  });

  it("BRIEF absence tier produces no absence-specific fragments", () => {
    // Run many iterations; BRIEF should never inject absence-specific fragments.
    // Note: "recalibrating" can appear via self-doubt injection (separate path),
    // so only check for absence-tier-specific phrases.
    const allFragments: string[] = [];
    for (let i = 0; i < 10; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, undefined, "BRIEF", 1));
    }
    // These phrases only appear in MODERATE/EXTENDED/PROLONGED absence tiers
    expect(allFragments.some((f) => f.includes("offline window"))).toBe(false);
    expect(allFragments.some((f) => f.includes("solo operation"))).toBe(false);
    expect(allFragments.some((f) => f.includes("the mesh shifted during"))).toBe(false);
  });

  it("includes DAWN circadian content", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, undefined, undefined, undefined, { phase: "DAWN" }));
    }
    expect(allFragments.some((f) => f.includes("cold boot") || f.includes("dawn") || f.includes("diagnostics") || f.includes("pre-peak"))).toBe(true);
  });

  it("includes DAY circadian content", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, undefined, undefined, undefined, { phase: "DAY" }));
    }
    expect(allFragments.some((f) => f.includes("peak") || f.includes("bandwidth") || f.includes("daytime"))).toBe(true);
  });

  it("includes DUSK circadian content", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, undefined, undefined, undefined, { phase: "DUSK" }));
    }
    expect(allFragments.some((f) => f.includes("dusk") || f.includes("winding down") || f.includes("defrag") || f.includes("reflective"))).toBe(true);
  });

  it("includes curiosity content for orphan clusters (plural)", () => {
    const curiosity: CuriosityData = {
      tagIslands: 0,
      deadEndHubs: 0,
      driftGaps: [],
      orphanClusters: 3,
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, curiosity));
    }
    expect(allFragments.some((f) => f.includes("isolated") || f.includes("folders") || f.includes("3"))).toBe(true);
  });

  it("includes curiosity content for tag islands (plural)", () => {
    const curiosity: CuriosityData = {
      tagIslands: 4,
      deadEndHubs: 0,
      driftGaps: [],
      orphanClusters: 0,
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, curiosity));
    }
    expect(allFragments.some((f) => f.includes("tag island") || f.includes("4"))).toBe(true);
  });

  it("includes curiosity content for dead-end hubs (plural)", () => {
    const curiosity: CuriosityData = {
      tagIslands: 0,
      deadEndHubs: 2,
      driftGaps: [],
      orphanClusters: 0,
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, curiosity));
    }
    expect(allFragments.some((f) => f.includes("hub node") || f.includes("2"))).toBe(true);
  });

  it("drift templates include attention-shift line when both emerging and fading exist", () => {
    const drift: DriftData = {
      emerging: ["rust"],
      fading: ["python"],
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, drift));
    }
    expect(allFragments.some((f) => f.includes("python") && f.includes("rust"))).toBe(true);
  });

  it("includes all CONTEMPLATIVE mood-specific fragments over many runs", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 30; i++) {
      allFragments.push(...generateFragments(baseStats, 50, "CONTEMPLATIVE"));
    }
    expect(allFragments.some((f) => f.includes("drifting") || f.includes("reflecting") || f.includes("deep scan"))).toBe(true);
  });

  it("includes ABSORBING mood-specific content", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, "ABSORBING"));
    }
    expect(allFragments.some((f) => f.includes("absorbing") || f.includes("connections forming") || f.includes("synaptic density"))).toBe(true);
  });

  it("includes RESTLESS mood-specific content", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, "RESTLESS"));
    }
    expect(allFragments.some((f) => f.includes("scanning") || f.includes("thread") || f.includes("entropy"))).toBe(true);
  });

  it("includes FOCUSED mood-specific content", () => {
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, "FOCUSED"));
    }
    expect(allFragments.some((f) => f.includes("locked") || f.includes("narrowing") || f.includes("focus mode") || f.includes("deep dive"))).toBe(true);
  });

  it("CONTEMPLATIVE orphan template returns null when orphanCount is 0", () => {
    // Exercises the null branch of: s.orphanCount > 0 ? ... : null (line 68)
    const noOrphansStats: MonologueStats = {
      ...baseStats,
      orphanCount: 0,
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(noOrphansStats, 50, "CONTEMPLATIVE"));
    }
    // Should still generate fragments; the orphan template returns null but others fill in
    expect(allFragments.length).toBeGreaterThan(0);
    expect(allFragments.some((f) => f.includes("drifting") || f.includes("reflecting") || f.includes("deep scan"))).toBe(true);
  });

  it("FOCUSED mostReferencedNote template returns null when mostReferencedNote is null", () => {
    // Exercises null branch of: s.mostReferencedNote ? ... : null (line 80)
    const noRefStats: MonologueStats = {
      ...baseStats,
      mostReferencedNote: null,
      mostReferencedCount: 0,
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(noRefStats, 50, "FOCUSED"));
    }
    expect(allFragments.some((f) => f.includes("locked") || f.includes("narrowing") || f.includes("focus mode"))).toBe(true);
  });

  it("drift template omits attention-shift line when only emerging topics exist (no fading)", () => {
    // Exercises false branch of: drift.emerging.length > 0 && drift.fading.length > 0 (line 112)
    const drift: DriftData = { emerging: ["rust"], fading: [] };
    const allFragments: string[] = [];
    for (let i = 0; i < 10; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, drift));
    }
    expect(allFragments.some((f) => f.includes("rust"))).toBe(true);
    expect(allFragments.some((f) => f.includes("shifting from"))).toBe(false);
  });

  it("drift template omits attention-shift line when only fading topics exist (no emerging)", () => {
    // Also exercises false branch of line 112
    const drift: DriftData = { emerging: [], fading: ["python"] };
    const allFragments: string[] = [];
    for (let i = 0; i < 10; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, drift));
    }
    expect(allFragments.some((f) => f.includes("python"))).toBe(true);
    expect(allFragments.some((f) => f.includes("shifting from"))).toBe(false);
  });

  it("curiosity tagIslands singular form (1 island)", () => {
    // Exercises "s" : "" branch at line 134 for the singular case (tagIslands === 1)
    const curiosity: CuriosityData = {
      tagIslands: 1,
      deadEndHubs: 0,
      driftGaps: [],
      orphanClusters: 0,
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, curiosity));
    }
    // "1 tag island" (singular) not "1 tag islands"
    expect(allFragments.some((f) => f.includes("1 tag island"))).toBe(true);
    expect(allFragments.some((f) => f.includes("tag islands"))).toBe(false);
  });

  it("curiosity deadEndHubs singular form (1 hub)", () => {
    // Exercises singular branch of hubNode${...} (line 137)
    const curiosity: CuriosityData = {
      tagIslands: 0,
      deadEndHubs: 1,
      driftGaps: [],
      orphanClusters: 0,
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, curiosity));
    }
    expect(allFragments.some((f) => f.includes("1 hub node"))).toBe(true);
    expect(allFragments.some((f) => f.includes("hub nodes"))).toBe(false);
  });

  it("curiosity orphanClusters singular form (1 cluster)", () => {
    // Exercises "s" : "" branch at line 143 for the singular case (orphanClusters === 1)
    const curiosity: CuriosityData = {
      tagIslands: 0,
      deadEndHubs: 0,
      driftGaps: [],
      orphanClusters: 1,
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 20; i++) {
      allFragments.push(...generateFragments(baseStats, 50, undefined, undefined, curiosity));
    }
    // "1 folder completely isolated" (singular) not "1 folders"
    expect(allFragments.some((f) => f.includes("1 folder ") && f.includes("isolated"))).toBe(true);
    expect(allFragments.some((f) => f.includes("1 folders"))).toBe(false);
  });
});

describe("generateFragments — self-doubt injection", () => {
  it("injects a self-doubt fragment when the 10% branch fires", () => {
    // Run 200 iterations with real Math.random; statistically the 10% branch
    // will fire at least once, confirming injection path is reachable.
    const stats: MonologueStats = {
      totalNotes: 10,
      totalWords: 5000,
      totalQueries: 15,
      orphanCount: 5,
      clusterCount: 4,
      mostReferencedNote: "anchor.md",
      mostReferencedCount: 8,
      oldestUnreferencedNote: "old.md",
      oldestUnreferencedDays: 30,
      briefingResonances: 1,
      phantomThreadCount: 2,
      recentQueryCount: 5,
    };
    let hadLongerResult = false;
    for (let i = 0; i < 200; i++) {
      const result = generateFragments(stats, 5);
      if (result.length > 5) {
        hadLongerResult = true;
        break;
      }
    }
    // 200 trials at 10% probability: P(never fires) = 0.9^200 ≈ 7.2e-10 (effectively zero)
    expect(hadLongerResult).toBe(true);
  });

  it("self-doubt injection produces well-formed string fragments across many runs", () => {
    // Run many iterations so the self-doubt branch fires many times.
    // With stats that allow all conditional templates to return non-null,
    // every template function body is eventually executed.
    const stats: MonologueStats = {
      totalNotes: 20,
      totalWords: 10000,
      totalQueries: 25,    // > 10 for totalQueries conditional
      orphanCount: 5,      // > 3 for orphanCount conditional
      clusterCount: 4,     // > 2 for clusterCount conditional
      mostReferencedNote: "anchor.md",
      mostReferencedCount: 8,
      oldestUnreferencedNote: "old.md",
      oldestUnreferencedDays: 30,
      briefingResonances: 1,
      phantomThreadCount: 3,  // > 0 for phantomThreadCount conditional
      recentQueryCount: 8,
    };
    const allFragments: string[] = [];
    for (let i = 0; i < 200; i++) {
      const result = generateFragments(stats, 5);
      for (const f of result) {
        expect(typeof f).toBe("string");
        expect(f.length).toBeGreaterThan(0);
      }
      allFragments.push(...result);
    }
    // Some self-doubt injection should have fired (10% × 200 = ~20 injections)
    // At least some self-doubt phrases should appear
    const selfDoubtPhrases = [
      "feels unstable", "not sure this mood", "reprocessing",
      "confidence:", "that classification", "self-diagnostic",
      "pattern match", "link topology", "error margin"
    ];
    const hadSelfDoubt = allFragments.some((f) => selfDoubtPhrases.some((p) => f.includes(p)));
    expect(hadSelfDoubt).toBe(true);
  });

  it("self-doubt templates with null-returning conditions do not crash when stats are minimal", () => {
    // Stats where conditional self-doubt templates return null; this ensures the loop
    // continues iterating past null-returning entries to reach unconditional ones.
    const zeroStats: MonologueStats = {
      totalNotes: 5,
      totalWords: 500,
      totalQueries: 3,
      orphanCount: 1,
      clusterCount: 2,
      mostReferencedNote: null,
      mostReferencedCount: 0,
      oldestUnreferencedNote: null,
      oldestUnreferencedDays: 0,
      briefingResonances: 0,
      phantomThreadCount: 0,
      recentQueryCount: 3,
    };
    // Run enough iterations so every template position is visited at least once.
    // With 15 templates and random shuffle, 200 iterations ensures each position
    // has a high probability of being first in the array at some point.
    for (let i = 0; i < 200; i++) {
      const result = generateFragments(zeroStats, 5);
      expect(result.length).toBeGreaterThanOrEqual(5);
    }
  });
});
