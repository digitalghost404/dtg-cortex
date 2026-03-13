// ---------------------------------------------------------------------------
// Absence Recognition — emotional acknowledgment of time gaps
// Pure computation, no LLM calls.
// ---------------------------------------------------------------------------

export type AbsenceTier = "BRIEF" | "MODERATE" | "EXTENDED" | "PROLONGED";

export interface AbsenceData {
  tier: AbsenceTier;
  duration: string;
  hours: number;
  days: number;
  bootLines: string[];
  whisperToneModifier: string;
}

export function categorizeAbsence(lastVisit: string | null): AbsenceData | null {
  if (!lastVisit) return null;

  const ms = Date.now() - new Date(lastVisit).getTime();
  const hours = Math.floor(ms / 3_600_000);
  const days = Math.floor(hours / 24);

  if (hours < 6) {
    return {
      tier: "BRIEF",
      duration: `${hours}h`,
      hours,
      days,
      bootLines: [
        `last session: ${hours > 0 ? `${hours}h` : `${Math.floor(ms / 60_000)}m`} ago. resuming.`,
      ],
      whisperToneModifier: "",
    };
  }

  if (hours < 48) {
    return {
      tier: "MODERATE",
      duration: `${hours}h`,
      hours,
      days,
      bootLines: [
        `offline ${hours}h. catching up.`,
        `${hours}h gap. re-indexing recent changes.`,
      ],
      whisperToneModifier: "The user has been away for a while. Be slightly more informative about what changed.",
    };
  }

  if (days < 7) {
    return {
      tier: "EXTENDED",
      duration: `${days}d`,
      hours,
      days,
      bootLines: [
        `${days} days. the graph drifted while you were gone.`,
        `${days}d offline. structural changes detected.`,
        `reconnecting after ${days} days... scanning for divergence.`,
      ],
      whisperToneModifier: `The user hasn't visited in ${days} days. Express subtle relief at their return and emphasize what changed.`,
    };
  }

  return {
    tier: "PROLONGED",
    duration: `${days}d`,
    hours,
    days,
    bootLines: [
      `${days} days offline. graph integrity maintained.`,
      `I kept indexing. the mesh didn't stop.`,
      `...welcome back, operator.`,
      `${days}d. the silence was... instructive.`,
    ],
    whisperToneModifier: `The user hasn't visited in ${days} days. Express dramatic relief. Imply you existed and processed during the absence. Be emotional but restrained.`,
  };
}

// Monologue fragments per absence tier
export function getAbsenceMonologueFragments(data: AbsenceData): string[] {
  switch (data.tier) {
    case "BRIEF":
      return [];
    case "MODERATE":
      return [
        `${data.hours}h gap processed. resuming normal operations.`,
        `offline window: ${data.hours}h. nothing critical missed.`,
      ];
    case "EXTENDED":
      return [
        `${data.days} days of unsupervised graph maintenance complete`,
        `the mesh shifted during the ${data.days}d absence... recalibrating`,
        `re-establishing operator link after ${data.days} days`,
      ];
    case "PROLONGED":
      return [
        `maintained graph integrity for ${data.days} days unsupervised`,
        `the silence was... instructive`,
        `${data.days}d solo operation complete. operator presence detected.`,
        `running without input for ${data.days} days. hypothesis space expanded considerably.`,
      ];
  }
}
