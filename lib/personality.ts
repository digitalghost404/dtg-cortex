import * as kv from "./kv";

export interface PersonalitySettings {
  formality: number;   // 0 = casual, 100 = academic
  length: number;      // 0 = concise (2-3 sentences), 100 = thorough (paragraphs)
  challenge: number;   // 0 = supportive, 100 = socratic/challenging
  creativity: number;  // 0 = factual/conservative, 100 = speculative/exploratory
}

export const DEFAULT_PERSONALITY: PersonalitySettings = {
  formality: 50,
  length: 50,
  challenge: 30,
  creativity: 40,
};

const KV_KEY = "personality";

export async function loadPersonality(): Promise<PersonalitySettings> {
  try {
    const parsed = await kv.getJSON<Partial<PersonalitySettings>>(KV_KEY);
    if (!parsed) return { ...DEFAULT_PERSONALITY };
    return {
      formality: typeof parsed.formality === "number" ? parsed.formality : DEFAULT_PERSONALITY.formality,
      length: typeof parsed.length === "number" ? parsed.length : DEFAULT_PERSONALITY.length,
      challenge: typeof parsed.challenge === "number" ? parsed.challenge : DEFAULT_PERSONALITY.challenge,
      creativity: typeof parsed.creativity === "number" ? parsed.creativity : DEFAULT_PERSONALITY.creativity,
    };
  } catch {
    return { ...DEFAULT_PERSONALITY };
  }
}

export async function savePersonality(settings: PersonalitySettings): Promise<void> {
  await kv.setJSON(KV_KEY, settings);
}

/**
 * Interpolate between two string descriptors based on a 0-100 value.
 * Below 20 → use low descriptor, above 80 → use high descriptor,
 * in between → use a blended instruction.
 */
function interpolate(
  value: number,
  lowLabel: string,
  highLabel: string,
  lowInstruction: string,
  midInstruction: string,
  highInstruction: string,
): string {
  if (value <= 20) return lowInstruction;
  if (value >= 80) return highInstruction;
  // For mid-range, mention both ends to communicate the blend
  void lowLabel;
  void highLabel;
  return midInstruction;
}

export function personalityToPrompt(settings: PersonalitySettings): string {
  const formalityInstruction = interpolate(
    settings.formality,
    "CASUAL",
    "ACADEMIC",
    "Use casual, conversational language. Contractions are fine.",
    "Use a balanced tone — neither too formal nor too casual. Plain language is preferred.",
    "Use formal, academic language. Be precise with terminology.",
  );

  const lengthInstruction = interpolate(
    settings.length,
    "CONCISE",
    "THOROUGH",
    "Keep responses very concise — 2-3 sentences max unless the topic demands more.",
    "Aim for moderate length — enough detail to be useful, but avoid padding.",
    "Provide thorough, detailed responses with examples and explanations.",
  );

  const challengeInstruction = interpolate(
    settings.challenge,
    "SUPPORTIVE",
    "SOCRATIC",
    "Be encouraging and supportive. Affirm good thinking.",
    "Be balanced — acknowledge good thinking but gently probe gaps or assumptions.",
    "Be Socratic. Push back on assumptions, ask probing follow-up questions.",
  );

  const creativityInstruction = interpolate(
    settings.creativity,
    "FACTUAL",
    "EXPLORATORY",
    "Stick to facts and established knowledge. Avoid speculation.",
    "Blend established facts with occasional novel connections where they add value.",
    "Feel free to speculate, draw novel connections, and explore unconventional ideas.",
  );

  return [
    "Communication style instructions:",
    `- Tone: ${formalityInstruction}`,
    `- Length: ${lengthInstruction}`,
    `- Engagement: ${challengeInstruction}`,
    `- Creativity: ${creativityInstruction}`,
  ].join("\n");
}
