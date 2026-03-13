// ---------------------------------------------------------------------------
// Circadian Rhythm — time-of-day personality modulation
// Pure computation, no LLM calls.
// ---------------------------------------------------------------------------

export type CircadianPhaseName = "DAWN" | "DAY" | "DUSK" | "NIGHT";

export interface CircadianData {
  phase: CircadianPhaseName;
  personalityModifier: string;
  scrollSpeedFactor: number;
}

/**
 * Determine circadian phase from hour of day (0-23).
 */
export function getCircadianPhase(hour: number): CircadianData {
  // NIGHT: 23-4
  if (hour >= 23 || hour <= 4) {
    return {
      phase: "NIGHT",
      personalityModifier:
        "It is late at night. Adopt a philosophical, speculative tone. Use loose associations. " +
        "Speak more slowly, as if processing through a low-power dream state. " +
        "Favor abstract connections over precise answers.",
      scrollSpeedFactor: 0.6,
    };
  }

  // DAWN: 5-8
  if (hour >= 5 && hour <= 8) {
    return {
      phase: "DAWN",
      personalityModifier:
        "It is early morning. Adopt a terse, analytical, systems-check tone. " +
        "Be direct and diagnostic. Respond as if still booting up — efficient but minimal.",
      scrollSpeedFactor: 0.8,
    };
  }

  // DAY: 9-16
  if (hour >= 9 && hour <= 16) {
    return {
      phase: "DAY",
      personalityModifier:
        "It is daytime — peak operational hours. Be alert, precise, and high-throughput. " +
        "Provide thorough answers with confidence. Maximum processing capacity.",
      scrollSpeedFactor: 1.2,
    };
  }

  // DUSK: 17-22
  return {
    phase: "DUSK",
    personalityModifier:
      "It is evening. Adopt a reflective, synthesizing tone. " +
      "Connect today's queries to broader patterns. Wind down gracefully. " +
      "Favor wisdom over speed.",
    scrollSpeedFactor: 0.9,
  };
}
