import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));

import { personalityToPrompt, DEFAULT_PERSONALITY, loadPersonality, savePersonality } from "@/lib/personality";
import * as kv from "@/lib/kv";

const mockGetJSON = kv.getJSON as ReturnType<typeof vi.fn>;
const mockSetJSON = kv.setJSON as ReturnType<typeof vi.fn>;

describe("personalityToPrompt", () => {
  it("returns a string containing all four dimensions", () => {
    const result = personalityToPrompt(DEFAULT_PERSONALITY);
    expect(result).toContain("Tone:");
    expect(result).toContain("Length:");
    expect(result).toContain("Engagement:");
    expect(result).toContain("Creativity:");
  });

  it("uses casual language at formality=0", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, formality: 0 });
    expect(result).toContain("casual");
  });

  it("uses formal language at formality=100", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, formality: 100 });
    expect(result).toContain("formal");
  });

  it("uses concise instruction at length=0", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, length: 0 });
    expect(result).toContain("concise");
  });

  it("uses thorough instruction at length=100", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, length: 100 });
    expect(result).toContain("thorough");
  });

  it("uses supportive instruction at challenge=0", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, challenge: 0 });
    expect(result).toContain("encouraging");
  });

  it("uses Socratic instruction at challenge=100", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, challenge: 100 });
    expect(result).toContain("Socratic");
  });

  it("uses factual instruction at creativity=0", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, creativity: 0 });
    expect(result).toContain("facts");
  });

  it("uses exploratory instruction at creativity=100", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, creativity: 100 });
    expect(result).toContain("speculate");
  });

  it("uses mid-range instructions for default personality", () => {
    const result = personalityToPrompt(DEFAULT_PERSONALITY);
    // Default formality=50 should give mid instruction
    expect(result).toContain("balanced");
  });

  it("boundary: value=20 uses low instruction", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, formality: 20 });
    expect(result).toContain("casual");
  });

  it("boundary: value=21 uses mid instruction", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, formality: 21 });
    expect(result).toContain("balanced");
  });

  it("boundary: value=80 uses high instruction", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, formality: 80 });
    expect(result).toContain("formal");
  });

  it("boundary: value=79 uses mid instruction", () => {
    const result = personalityToPrompt({ ...DEFAULT_PERSONALITY, formality: 79 });
    expect(result).toContain("balanced");
  });
});

describe("loadPersonality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns DEFAULT_PERSONALITY when KV has no stored value", async () => {
    mockGetJSON.mockResolvedValue(null);
    const result = await loadPersonality();
    expect(result).toEqual(DEFAULT_PERSONALITY);
  });

  it("returns fully stored personality when all fields are present", async () => {
    const stored = { formality: 10, length: 90, challenge: 60, creativity: 75 };
    mockGetJSON.mockResolvedValue(stored);
    const result = await loadPersonality();
    expect(result).toEqual(stored);
  });

  it("fills in missing fields with DEFAULT_PERSONALITY values", async () => {
    // Only formality is stored; others should fall back to defaults
    mockGetJSON.mockResolvedValue({ formality: 10 });
    const result = await loadPersonality();
    expect(result.formality).toBe(10);
    expect(result.length).toBe(DEFAULT_PERSONALITY.length);
    expect(result.challenge).toBe(DEFAULT_PERSONALITY.challenge);
    expect(result.creativity).toBe(DEFAULT_PERSONALITY.creativity);
  });

  it("ignores non-number values and uses defaults instead", async () => {
    mockGetJSON.mockResolvedValue({ formality: "high", length: null, challenge: true, creativity: 50 });
    const result = await loadPersonality();
    expect(result.formality).toBe(DEFAULT_PERSONALITY.formality);
    expect(result.length).toBe(DEFAULT_PERSONALITY.length);
    expect(result.challenge).toBe(DEFAULT_PERSONALITY.challenge);
    expect(result.creativity).toBe(50);
  });

  it("returns DEFAULT_PERSONALITY when getJSON throws", async () => {
    mockGetJSON.mockRejectedValue(new Error("KV error"));
    const result = await loadPersonality();
    expect(result).toEqual(DEFAULT_PERSONALITY);
  });
});

describe("savePersonality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetJSON.mockResolvedValue(undefined);
  });

  it("calls setJSON with the 'personality' key and provided settings", async () => {
    const settings = { formality: 20, length: 80, challenge: 50, creativity: 60 };
    await savePersonality(settings);
    expect(mockSetJSON).toHaveBeenCalledWith("personality", settings);
  });

  it("calls setJSON exactly once", async () => {
    await savePersonality(DEFAULT_PERSONALITY);
    expect(mockSetJSON).toHaveBeenCalledTimes(1);
  });
});
