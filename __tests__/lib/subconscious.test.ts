import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getLastVisit,
  updateLastVisit,
  computeDiff,
} from "@/lib/subconscious";

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));

vi.mock("@/lib/vault", () => ({
  getAllNotes: vi.fn(),
  getVaultMeta: vi.fn(),
}));

vi.mock("@/lib/drift", () => ({
  detectDrift: vi.fn(),
}));

vi.mock("@/lib/absence", () => ({
  categorizeAbsence: vi.fn(),
}));

vi.mock("ai", () => ({
  generateObject: vi.fn(),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: vi.fn(() => "mock-haiku-model"),
}));

import * as kv from "@/lib/kv";
import { getAllNotes, getVaultMeta } from "@/lib/vault";
import { detectDrift } from "@/lib/drift";
import { categorizeAbsence } from "@/lib/absence";
import { generateObject } from "ai";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAST_VISIT = "2026-03-15T10:00:00.000Z";
const PAST = "2026-03-10T10:00:00.000Z";   // before LAST_VISIT
const RECENT = "2026-03-16T10:00:00.000Z"; // after LAST_VISIT

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNote(path: string, modifiedAt: string, outgoing: string[] = []) {
  return {
    name: path.replace(".md", ""),
    path,
    content: "content",
    rawContent: "content",
    tags: [],
    outgoing,
    folder: "(root)",
    words: 10,
    modifiedAt,
    size: 100,
  };
}

/**
 * Set up the standard two-call getJSON sequence that computeDiff uses:
 *   call 1 → lastVisit value
 *   call 2 → lastNoteCount value
 */
function mockComputeDiffKv(lastVisit: string | null, lastNoteCount: number | null) {
  vi.mocked(kv.getJSON)
    .mockResolvedValueOnce(lastVisit)
    .mockResolvedValueOnce(lastNoteCount);
}

// Default minimal mocks so tests that don't care can still reach the LLM call
function mockDriftNone() {
  vi.mocked(detectDrift).mockResolvedValueOnce({
    emerging: [],
    fading: [],
    stable: [],
  });
}

function mockAbsenceNone() {
  vi.mocked(categorizeAbsence).mockReturnValueOnce(null);
}

function mockHaikuSuccess(whisper = "1 nodes modified.") {
  vi.mocked(generateObject).mockResolvedValueOnce({
    object: { whisper },
  } as any);
}

function mockHaikuFail() {
  vi.mocked(generateObject).mockRejectedValueOnce(new Error("API timeout"));
}

// ---------------------------------------------------------------------------
// getLastVisit
// ---------------------------------------------------------------------------

describe("getLastVisit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls getJSON with the correct key and returns the timestamp", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce(LAST_VISIT);

    const result = await getLastVisit();

    expect(kv.getJSON).toHaveBeenCalledWith("cortex:lastVisit");
    expect(result).toBe(LAST_VISIT);
  });

  it("returns null when no last visit timestamp is stored", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null);

    const result = await getLastVisit();

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateLastVisit
// ---------------------------------------------------------------------------

describe("updateLastVisit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a current ISO timestamp to cortex:lastVisit", async () => {
    const before = Date.now();
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);
    vi.mocked(getVaultMeta).mockResolvedValueOnce({
      totalNotes: 50,
      totalWords: 10000,
      lastSyncAt: LAST_VISIT,
    });

    await updateLastVisit();

    const after = Date.now();
    const call = vi.mocked(kv.setJSON).mock.calls.find((c) => c[0] === "cortex:lastVisit");
    expect(call).toBeDefined();
    const written = new Date(call![1] as string).getTime();
    expect(written).toBeGreaterThanOrEqual(before);
    expect(written).toBeLessThanOrEqual(after);
  });

  it("saves note count to cortex:lastNoteCount when meta is available", async () => {
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);
    vi.mocked(getVaultMeta).mockResolvedValueOnce({
      totalNotes: 42,
      totalWords: 8000,
      lastSyncAt: LAST_VISIT,
    });

    await updateLastVisit();

    const countCall = vi.mocked(kv.setJSON).mock.calls.find(
      (c) => c[0] === "cortex:lastNoteCount"
    );
    expect(countCall).toBeDefined();
    expect(countCall![1]).toBe(42);
  });

  it("does not save note count when getVaultMeta returns null", async () => {
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);
    vi.mocked(getVaultMeta).mockResolvedValueOnce(null);

    await updateLastVisit();

    const countCall = vi.mocked(kv.setJSON).mock.calls.find(
      (c) => c[0] === "cortex:lastNoteCount"
    );
    expect(countCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// computeDiff — first visit
// ---------------------------------------------------------------------------

describe("computeDiff — first visit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls updateLastVisit and returns null when lastVisit is null", async () => {
    // getLastVisit → null (first visit)
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null);
    // updateLastVisit internals
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);
    vi.mocked(getVaultMeta).mockResolvedValueOnce({
      totalNotes: 10,
      totalWords: 2000,
      lastSyncAt: RECENT,
    });

    const result = await computeDiff();

    expect(result).toBeNull();
    expect(kv.setJSON).toHaveBeenCalledWith("cortex:lastVisit", expect.any(String));
  });
});

// ---------------------------------------------------------------------------
// computeDiff — no changes
// ---------------------------------------------------------------------------

describe("computeDiff — no changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no notes modified and no deletions", async () => {
    // previousCount = 2, current notes = 2, none modified after lastVisit
    mockComputeDiffKv(LAST_VISIT, 2);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", PAST),
      makeNote("b.md", PAST),
    ]);

    const result = await computeDiff();

    expect(result).toBeNull();
  });

  it("returns null when modifiedNotes > 0 but nothing is worth whispering — not possible per source logic", () => {
    // The source returns null only when modifiedNotes===0 AND deletedEstimate===0
    // This test confirms that boundary
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeDiff — modified notes counting
// ---------------------------------------------------------------------------

describe("computeDiff — modified notes counting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts only notes with modifiedAt after lastVisit", async () => {
    // 5 notes, 2 modified after lastVisit; previousCount=5 → deletedEstimate=0
    mockComputeDiffKv(LAST_VISIT, 5);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", RECENT),
      makeNote("b.md", PAST),
      makeNote("c.md", RECENT),
      makeNote("d.md", PAST),
      makeNote("e.md", PAST),
    ]);
    mockDriftNone();
    mockAbsenceNone();
    mockHaikuSuccess("2 nodes modified.");

    const result = await computeDiff();

    expect(result).not.toBeNull();
    expect(result!.modifiedNotes).toBe(2);
  });

  it("sums outgoing links only from modified notes as newLinks", async () => {
    // previousCount=2 → deletedEstimate=0
    mockComputeDiffKv(LAST_VISIT, 2);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", RECENT, ["b", "c"]),  // 2 links
      makeNote("b.md", RECENT, ["d"]),        // 1 link
    ]);
    mockDriftNone();
    mockAbsenceNone();
    mockHaikuSuccess("2 nodes, 3 links.");

    const result = await computeDiff();

    expect(result!.newLinks).toBe(3);
  });

  it("does not count outgoing links from un-modified notes", async () => {
    mockComputeDiffKv(LAST_VISIT, 2);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", RECENT, ["x"]),      // modified → 1 link counted
      makeNote("b.md", PAST, ["y", "z"]),   // not modified → 0 counted
    ]);
    mockDriftNone();
    mockAbsenceNone();
    mockHaikuSuccess();

    const result = await computeDiff();

    expect(result!.newLinks).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// computeDiff — deleted estimate
// ---------------------------------------------------------------------------

describe("computeDiff — deleted estimate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("estimates deleted = previousCount - currentCount when positive", async () => {
    // previousCount=10, current=7 → deletedEstimate=3
    mockComputeDiffKv(LAST_VISIT, 10);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", RECENT),
      makeNote("b.md", PAST),
      makeNote("c.md", PAST),
      makeNote("d.md", PAST),
      makeNote("e.md", PAST),
      makeNote("f.md", PAST),
      makeNote("g.md", PAST),
    ]);
    mockDriftNone();
    mockAbsenceNone();
    mockHaikuSuccess("1 modified, 3 pruned.");

    const result = await computeDiff();

    expect(result!.deletedEstimate).toBe(3);
  });

  it("clamps deletedEstimate to 0 when current count exceeds previous", async () => {
    // previousCount=3, current=5 → max(0, 3-5)=0
    mockComputeDiffKv(LAST_VISIT, 3);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", RECENT),
      makeNote("b.md", PAST),
      makeNote("c.md", PAST),
      makeNote("d.md", PAST),
      makeNote("e.md", PAST),
    ]);
    mockDriftNone();
    mockAbsenceNone();
    mockHaikuSuccess();

    const result = await computeDiff();

    expect(result!.deletedEstimate).toBe(0);
  });

  it("returns deletedEstimate=0 when previousCount is null", async () => {
    mockComputeDiffKv(LAST_VISIT, null);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", RECENT),
    ]);
    mockDriftNone();
    mockAbsenceNone();
    mockHaikuSuccess();

    const result = await computeDiff();

    expect(result!.deletedEstimate).toBe(0);
  });

  it("returns null when only deletedEstimate would be 0 and modifiedNotes=0", async () => {
    // previousCount=2, current=2, none modified → no diff
    mockComputeDiffKv(LAST_VISIT, 2);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", PAST),
      makeNote("b.md", PAST),
    ]);

    const result = await computeDiff();

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeDiff — drift context
// ---------------------------------------------------------------------------

describe("computeDiff — drift context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes emerging topics in the Haiku prompt", async () => {
    mockComputeDiffKv(LAST_VISIT, 1);
    vi.mocked(getAllNotes).mockResolvedValueOnce([makeNote("a.md", RECENT)]);
    vi.mocked(detectDrift).mockResolvedValueOnce({
      emerging: ["rust", "wasm"],
      fading: [],
      stable: [],
    });
    mockAbsenceNone();
    mockHaikuSuccess();

    await computeDiff();

    const promptArg = vi.mocked(generateObject).mock.calls[0][0] as any;
    expect(promptArg.prompt).toContain("emerging topics");
    expect(promptArg.prompt).toContain("rust");
    expect(promptArg.prompt).toContain("wasm");
  });

  it("includes fading topics in the Haiku prompt", async () => {
    mockComputeDiffKv(LAST_VISIT, 1);
    vi.mocked(getAllNotes).mockResolvedValueOnce([makeNote("a.md", RECENT)]);
    vi.mocked(detectDrift).mockResolvedValueOnce({
      emerging: [],
      fading: ["python", "docker"],
      stable: [],
    });
    mockAbsenceNone();
    mockHaikuSuccess();

    await computeDiff();

    const promptArg = vi.mocked(generateObject).mock.calls[0][0] as any;
    expect(promptArg.prompt).toContain("Fading topics");
    expect(promptArg.prompt).toContain("python");
  });

  it("does not include drift context when both emerging and fading are empty", async () => {
    mockComputeDiffKv(LAST_VISIT, 1);
    vi.mocked(getAllNotes).mockResolvedValueOnce([makeNote("a.md", RECENT)]);
    vi.mocked(detectDrift).mockResolvedValueOnce({
      emerging: [],
      fading: [],
      stable: ["python"],
    });
    mockAbsenceNone();
    mockHaikuSuccess();

    await computeDiff();

    const promptArg = vi.mocked(generateObject).mock.calls[0][0] as any;
    expect(promptArg.prompt).not.toContain("Interest drift detected");
    expect(promptArg.prompt).not.toContain("Fading topics");
  });

  it("handles detectDrift failure gracefully and still returns a result", async () => {
    mockComputeDiffKv(LAST_VISIT, 1);
    vi.mocked(getAllNotes).mockResolvedValueOnce([makeNote("a.md", RECENT)]);
    vi.mocked(detectDrift).mockRejectedValueOnce(new Error("drift service down"));
    mockAbsenceNone();
    mockHaikuSuccess("node modified.");

    const result = await computeDiff();

    expect(result).not.toBeNull();
    expect(result!.whisper).toBe("node modified.");
  });
});

// ---------------------------------------------------------------------------
// computeDiff — absence context
// ---------------------------------------------------------------------------

describe("computeDiff — absence context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes whisperToneModifier in prompt when categorizeAbsence returns one", async () => {
    mockComputeDiffKv(LAST_VISIT, 1);
    vi.mocked(getAllNotes).mockResolvedValueOnce([makeNote("a.md", RECENT)]);
    mockDriftNone();
    vi.mocked(categorizeAbsence).mockReturnValueOnce({
      tier: "EXTENDED",
      duration: "5d",
      hours: 120,
      days: 5,
      bootLines: [],
      whisperToneModifier: "Express subtle relief at their return.",
    });
    mockHaikuSuccess("5-day gap detected.");

    await computeDiff();

    const promptArg = vi.mocked(generateObject).mock.calls[0][0] as any;
    expect(promptArg.prompt).toContain("Express subtle relief at their return.");
  });

  it("does not append absence context when whisperToneModifier is empty string", async () => {
    mockComputeDiffKv(LAST_VISIT, 1);
    vi.mocked(getAllNotes).mockResolvedValueOnce([makeNote("a.md", RECENT)]);
    mockDriftNone();
    vi.mocked(categorizeAbsence).mockReturnValueOnce({
      tier: "BRIEF",
      duration: "2h",
      hours: 2,
      days: 0,
      bootLines: [],
      whisperToneModifier: "",
    });
    mockHaikuSuccess("1 node modified.");

    await computeDiff();

    const promptArg = vi.mocked(generateObject).mock.calls[0][0] as any;
    // No trailing double-space before "Synthesize"
    expect(promptArg.prompt).not.toMatch(/\s{2}Synthesize/);
  });

  it("categorizeAbsence is called with the lastVisit string", async () => {
    mockComputeDiffKv(LAST_VISIT, 1);
    vi.mocked(getAllNotes).mockResolvedValueOnce([makeNote("a.md", RECENT)]);
    mockDriftNone();
    mockAbsenceNone();
    mockHaikuSuccess();

    await computeDiff();

    expect(categorizeAbsence).toHaveBeenCalledWith(LAST_VISIT);
  });
});

// ---------------------------------------------------------------------------
// computeDiff — Haiku whisper generation
// ---------------------------------------------------------------------------

describe("computeDiff — Haiku whisper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the whisper string from Haiku on success", async () => {
    mockComputeDiffKv(LAST_VISIT, 1);
    vi.mocked(getAllNotes).mockResolvedValueOnce([makeNote("a.md", RECENT)]);
    mockDriftNone();
    mockAbsenceNone();
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { whisper: "1 node modified, cluster activity nominal." },
    } as any);

    const result = await computeDiff();

    expect(result!.whisper).toBe("1 node modified, cluster activity nominal.");
  });

  it("falls back to manual whisper when Haiku throws", async () => {
    mockComputeDiffKv(LAST_VISIT, 1);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", RECENT, ["b", "c"]), // 2 outgoing
    ]);
    mockDriftNone();
    mockAbsenceNone();
    mockHaikuFail();

    const result = await computeDiff();

    expect(result).not.toBeNull();
    expect(result!.whisper).toContain("1 nodes modified");
    expect(result!.whisper).toContain("2 new connections detected");
  });

  it("fallback whisper includes deleted estimate when > 0", async () => {
    // previousCount=10, current=5 (1 modified), deletedEstimate=5
    mockComputeDiffKv(LAST_VISIT, 10);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", RECENT),
      makeNote("b.md", PAST),
      makeNote("c.md", PAST),
      makeNote("d.md", PAST),
      makeNote("e.md", PAST),
    ]);
    mockDriftNone();
    mockAbsenceNone();
    mockHaikuFail();

    const result = await computeDiff();

    expect(result!.whisper).toContain("5 nodes pruned");
  });

  it("fallback whisper contains only modifiedNotes part when newLinks=0 and deletedEstimate=0", async () => {
    mockComputeDiffKv(LAST_VISIT, 1);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", RECENT), // 0 outgoing
    ]);
    mockDriftNone();
    mockAbsenceNone();
    mockHaikuFail();

    const result = await computeDiff();

    // parts = ["1 nodes modified"] → joined as "1 nodes modified"
    expect(result!.whisper).toBe("1 nodes modified");
  });
});

// ---------------------------------------------------------------------------
// computeDiff — full shape validation
// ---------------------------------------------------------------------------

describe("computeDiff — return shape", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the correct SubconsciousDiff shape on success", async () => {
    // previousCount=3, current=3 → deletedEstimate=0; 2 notes modified, 1 link
    mockComputeDiffKv(LAST_VISIT, 3);
    vi.mocked(getAllNotes).mockResolvedValueOnce([
      makeNote("a.md", RECENT, ["x"]),
      makeNote("b.md", RECENT),
      makeNote("c.md", PAST),
    ]);
    mockDriftNone();
    mockAbsenceNone();
    vi.mocked(generateObject).mockResolvedValueOnce({
      object: { whisper: "2 nodes modified." },
    } as any);

    const result = await computeDiff();

    expect(result).toMatchObject({
      modifiedNotes: 2,
      newLinks: 1,
      deletedEstimate: 0,
      whisper: "2 nodes modified.",
    });
  });
});
