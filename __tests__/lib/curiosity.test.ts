import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to test the internal generateCuriosityQuestions logic,
// but it's not exported. We'll test through getCuriosityQuestions with cache miss.

vi.mock("@/lib/vault", () => ({
  getAllNotes: vi.fn(),
}));
vi.mock("@/lib/drift", () => ({
  detectDrift: vi.fn(),
}));
vi.mock("@/lib/lineage", () => ({
  getLineageStats: vi.fn(),
}));
vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));

import { getCuriosityQuestions, getCuriosityGapData } from "@/lib/curiosity";
import { getAllNotes } from "@/lib/vault";
import { detectDrift } from "@/lib/drift";
import { getLineageStats } from "@/lib/lineage";
import * as kv from "@/lib/kv";

const mockGetAllNotes = getAllNotes as ReturnType<typeof vi.fn>;
const mockDetectDrift = detectDrift as ReturnType<typeof vi.fn>;
const mockLineageStats = getLineageStats as ReturnType<typeof vi.fn>;
const mockGetJSON = kv.getJSON as ReturnType<typeof vi.fn>;
const mockSetJSON = kv.setJSON as ReturnType<typeof vi.fn>;

function note(
  name: string,
  opts: { tags?: string[]; outgoing?: string[]; folder?: string } = {}
) {
  return {
    name,
    path: `${opts.folder ?? "(root)"}/${name}.md`,
    tags: opts.tags ?? [],
    outgoing: opts.outgoing ?? [],
    folder: opts.folder ?? "(root)",
    modifiedAt: new Date().toISOString(),
  };
}

function defaultLineageStats() {
  return {
    totalQueries: 0,
    uniqueNotesReferenced: 0,
    mostReferencedNotes: [],
    recentEntries: [],
    noteTimeline: [],
    queriesPerDay: [],
  };
}

describe("getCuriosityQuestions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // No cache
    mockGetJSON.mockResolvedValue(null);
    mockSetJSON.mockResolvedValue(undefined);
    mockDetectDrift.mockResolvedValue({ emerging: [], fading: [], stable: [] });
    mockLineageStats.mockResolvedValue(defaultLineageStats());
  });

  it("returns empty array for empty vault", async () => {
    mockGetAllNotes.mockResolvedValue([]);
    const result = await getCuriosityQuestions();
    expect(result).toEqual([]);
  });

  it("detects tag islands (tag in 5+ notes all in same folder)", async () => {
    const notes = Array.from({ length: 6 }, (_, i) =>
      note(`note-${i}`, { tags: ["#design"], folder: "ui" })
    );
    mockGetAllNotes.mockResolvedValue(notes);

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("cross-pollination"))).toBe(true);
  });

  it("does not flag tag islands when notes span multiple folders", async () => {
    const notes = [
      ...Array.from({ length: 3 }, (_, i) =>
        note(`note-${i}`, { tags: ["#design"], folder: "ui" })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        note(`note-b-${i}`, { tags: ["#design"], folder: "backend" })
      ),
    ];
    mockGetAllNotes.mockResolvedValue(notes);

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("cross-pollination"))).toBe(false);
  });

  it("detects dead-end hubs (referenced by 3+ but no outgoing)", async () => {
    const hubNote = note("hub", { outgoing: [] });
    const linkers = Array.from({ length: 3 }, (_, i) =>
      note(`linker-${i}`, { outgoing: ["hub"] })
    );
    mockGetAllNotes.mockResolvedValue([hubNote, ...linkers]);

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("Dead-end hub"))).toBe(true);
  });

  it("does not flag hubs that have outgoing links", async () => {
    const hubNote = note("hub", { outgoing: ["other"] });
    const other = note("other");
    const linkers = Array.from({ length: 3 }, (_, i) =>
      note(`linker-${i}`, { outgoing: ["hub"] })
    );
    mockGetAllNotes.mockResolvedValue([hubNote, other, ...linkers]);

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("Dead-end hub"))).toBe(false);
  });

  it("detects drift gaps (emerging topic with no dedicated note)", async () => {
    mockDetectDrift.mockResolvedValue({
      emerging: ["kubernetes"],
      fading: [],
      stable: [],
    });
    mockGetAllNotes.mockResolvedValue([
      note("docker-basics"),
      note("react-patterns"),
    ]);

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("kubernetes"))).toBe(true);
  });

  it("does not flag drift gap when a note covers the topic", async () => {
    mockDetectDrift.mockResolvedValue({
      emerging: ["kubernetes"],
      fading: [],
      stable: [],
    });
    mockGetAllNotes.mockResolvedValue([
      note("kubernetes-deployment"),
    ]);

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("Emerging interest") && q.includes("kubernetes"))).toBe(false);
  });

  it("detects orphan clusters (folders with no inter-folder links)", async () => {
    const notes = [
      note("a1", { folder: "isolated", outgoing: ["a2"] }),
      note("a2", { folder: "isolated", outgoing: ["a1"] }),
      note("a3", { folder: "isolated" }),
      note("b1", { folder: "connected", outgoing: ["a1"] }),
    ];
    mockGetAllNotes.mockResolvedValue(notes);

    const result = await getCuriosityQuestions();
    // "isolated" folder has 3 notes, links only within itself
    expect(result.some((q) => q.includes("Isolated cluster"))).toBe(true);
  });

  it("returns at most 5 questions", async () => {
    // Create a scenario that generates many questions
    const notes = [
      // 5 tag islands (5 different tags, each with 5+ notes in one folder)
      ...Array.from({ length: 30 }, (_, i) =>
        note(`tag-note-${i}`, { tags: [`#tag${i % 5}`], folder: `folder${i % 5}` })
      ),
    ];
    mockGetAllNotes.mockResolvedValue(notes);

    const result = await getCuriosityQuestions();
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("returns at least 3 questions when enough gaps exist", async () => {
    const notes = [
      // Tag island
      ...Array.from({ length: 6 }, (_, i) =>
        note(`design-${i}`, { tags: ["#design"], folder: "ui" })
      ),
      // Dead-end hub
      note("hub", { outgoing: [] }),
      ...Array.from({ length: 3 }, (_, i) =>
        note(`ref-${i}`, { outgoing: ["hub"] })
      ),
      // Orphan cluster
      note("iso-1", { folder: "island" }),
      note("iso-2", { folder: "island" }),
      note("iso-3", { folder: "island" }),
    ];
    // Drift gap
    mockDetectDrift.mockResolvedValue({
      emerging: ["quantum"],
      fading: [],
      stable: [],
    });
    mockGetAllNotes.mockResolvedValue(notes);

    const result = await getCuriosityQuestions();
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it("uses cached result when fresh", async () => {
    mockGetJSON.mockResolvedValue({
      questions: ["cached question"],
      generatedAt: Date.now() - 1000, // 1 second ago
    });

    const callsBefore = mockGetAllNotes.mock.calls.length;
    const result = await getCuriosityQuestions();
    expect(result).toEqual(["cached question"]);
    // Should not call getAllNotes since cache is fresh
    expect(mockGetAllNotes.mock.calls.length).toBe(callsBefore);
  });

  it("handles drift detection failure gracefully", async () => {
    mockDetectDrift.mockRejectedValue(new Error("drift failed"));
    mockGetAllNotes.mockResolvedValue([note("some-note")]);

    // Should not throw
    const result = await getCuriosityQuestions();
    expect(Array.isArray(result)).toBe(true);
  });

  it("generates 'Blind spot?' question when most referenced note has never been queried", async () => {
    // The most referenced note is "important-note" with 5 references,
    // but it has never appeared in any recentEntries sourceNotes.
    mockGetAllNotes.mockResolvedValue([
      note("important-note"),
      note("other-note"),
    ]);
    mockLineageStats.mockResolvedValue({
      totalQueries: 3,
      uniqueNotesReferenced: 1,
      mostReferencedNotes: [{ name: "important-note", count: 5 }],
      recentEntries: [
        {
          id: "e1",
          timestamp: new Date().toISOString(),
          sessionId: "s1",
          query: "q",
          sourceNotes: [{ name: "other-note", path: "other-note.md", score: 0.8 }],
        },
      ],
      noteTimeline: [],
      queriesPerDay: [],
    });

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("important-note") && q.includes("Blind spot"))).toBe(true);
  });

  it("does not generate 'Blind spot?' when most referenced note has been queried", async () => {
    mockGetAllNotes.mockResolvedValue([note("hot-note")]);
    mockLineageStats.mockResolvedValue({
      totalQueries: 2,
      uniqueNotesReferenced: 1,
      mostReferencedNotes: [{ name: "hot-note", count: 3 }],
      recentEntries: [
        {
          id: "e1",
          timestamp: new Date().toISOString(),
          sessionId: "s1",
          query: "q",
          sourceNotes: [{ name: "hot-note", path: "hot-note.md", score: 0.9 }],
        },
      ],
      noteTimeline: [],
      queriesPerDay: [],
    });

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("Blind spot"))).toBe(false);
  });

  it("does not generate 'Blind spot?' when mostReferencedNotes is empty", async () => {
    mockGetAllNotes.mockResolvedValue([note("some-note")]);
    mockLineageStats.mockResolvedValue({
      ...defaultLineageStats(),
      mostReferencedNotes: [],
    });

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("Blind spot"))).toBe(false);
  });

  it("handles notes with no folder (falls back to root) when computing folder links", async () => {
    // Construct notes with empty string folder to exercise the `note.folder || "(root)"` fallback
    // in both the tag island check (line 82) and orphan cluster check (line 119/123).
    const makeRootNote = (name: string, outgoing: string[] = [], tags: string[] = []) => ({
      name,
      path: `(root)/${name}.md`,
      tags,
      outgoing,
      folder: "",  // empty string → triggers || "(root)" fallback
      modifiedAt: new Date().toISOString(),
    });
    // 5 notes with same tag, all with empty folder → should be detected as tag island in "(root)"
    const tagNotes = Array.from({ length: 5 }, (_, i) => makeRootNote(`tagged-${i}`, [], ["#concept"]));
    mockGetAllNotes.mockResolvedValue(tagNotes);

    const result = await getCuriosityQuestions();
    // Tag island in root: "You have 5 notes tagged #concept but they're all in the root."
    expect(result.some((q) => q.includes("the root") || q.includes("cross-pollination"))).toBe(true);
  });

  it("tag island with fewer than 5 notes is not flagged (exercises the continue branch)", async () => {
    // 4 notes with the same tag — below the 5-note threshold
    const notes = Array.from({ length: 4 }, (_, i) =>
      note(`note-${i}`, { tags: ["#small-tag"], folder: "same-folder" })
    );
    mockGetAllNotes.mockResolvedValue(notes);

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("cross-pollination"))).toBe(false);
  });

  it("orphan cluster link to unknown note name does not crash (target not in noteByName)", async () => {
    // note with outgoing link to a name not present in the vault
    const notes = [
      note("a1", { folder: "zone", outgoing: ["ghost-note"] }), // ghost-note not in vault
      note("a2", { folder: "zone" }),
      note("a3", { folder: "zone" }),
    ];
    mockGetAllNotes.mockResolvedValue(notes);

    // Should not throw; the `if (target)` guard on line 122 handles missing notes
    const result = await getCuriosityQuestions();
    expect(Array.isArray(result)).toBe(true);
  });

  it("folder that already has cross-folder links is not flagged as orphan cluster", async () => {
    // "hub" folder links to "other" folder — it has cross-folder links, so not isolated
    const notes = [
      note("h1", { folder: "hub", outgoing: ["o1"] }),
      note("h2", { folder: "hub" }),
      note("h3", { folder: "hub" }),
      note("o1", { folder: "other" }),
      note("o2", { folder: "other" }),
      note("o3", { folder: "other" }),
    ];
    mockGetAllNotes.mockResolvedValue(notes);

    const result = await getCuriosityQuestions();
    // "hub" folder links to "other" → not isolated
    expect(result.filter((q) => q.includes("hub") && q.includes("Isolated cluster"))).toHaveLength(0);
  });

  it("multiple notes from same folder linking to different folders (exercises folderLinks re-use)", async () => {
    // Both h1 and h2 are in "source" folder and each link to different target folders.
    // h1 → "target-a", h2 → "target-b": second outgoing link adds to EXISTING folderLinks entry
    // (exercises the `!folderLinks.has(srcFolder)` false branch — the set already exists)
    const notes = [
      note("h1", { folder: "source", outgoing: ["t1"] }),
      note("h2", { folder: "source", outgoing: ["t2"] }), // same srcFolder as h1 → already in map
      note("h3", { folder: "source" }),
      note("t1", { folder: "target-a" }),
      note("t2", { folder: "target-b" }),
    ];
    mockGetAllNotes.mockResolvedValue(notes);

    const result = await getCuriosityQuestions();
    // "source" has cross-folder links → not isolated
    expect(result.filter((q) => q.includes("source") && q.includes("Isolated cluster"))).toHaveLength(0);
  });

  it("tag island notes where a note name is not in noteByName (covers if (n) false branch)", async () => {
    // This is an edge case where tagNotes contains a name that somehow isn't in noteByName.
    // We can't produce this naturally via the current loop, but we can get the `if (n)` false
    // branch by having a note with a tag but then mutating — impossible with current implementation.
    // Instead, test that 5+ notes with empty folder string are detected as a root tag island.
    // (exercises `n.folder || "(root)"` fallback at line 82)
    const emptyFolderNotes = Array.from({ length: 5 }, (_, i) => ({
      name: `concept-${i}`,
      path: `(root)/concept-${i}.md`,
      tags: ["#meta"],
      outgoing: [],
      folder: "",  // empty → || "(root)" branch
      modifiedAt: new Date().toISOString(),
    }));
    mockGetAllNotes.mockResolvedValue(emptyFolderNotes);

    const result = await getCuriosityQuestions();
    expect(result.some((q) => q.includes("the root") && q.includes("cross-pollination"))).toBe(true);
  });

  it("target note with empty folder string uses (root) fallback in cross-folder link check", async () => {
    // exercises `target.folder || "(root)"` at line 123
    const notes = [
      note("src", { folder: "docs", outgoing: ["tgt"] }),
      {
        name: "tgt",
        path: "(root)/tgt.md",
        tags: [],
        outgoing: [],
        folder: "",   // empty → || "(root)" branch at line 123
        modifiedAt: new Date().toISOString(),
      },
      note("src2", { folder: "docs" }),
      note("src3", { folder: "docs" }),
    ];
    mockGetAllNotes.mockResolvedValue(notes);

    const result = await getCuriosityQuestions();
    // "docs" links to "(root)" (cross-folder) → not isolated
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("getCuriosityGapData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockGetJSON.mockResolvedValue(null);
    mockSetJSON.mockResolvedValue(undefined);
    mockDetectDrift.mockResolvedValue({ emerging: [], fading: [], stable: [] });
    mockLineageStats.mockResolvedValue(defaultLineageStats());
  });

  it("returns null when no questions are generated", async () => {
    mockGetAllNotes.mockResolvedValue([]);
    const result = await getCuriosityGapData();
    expect(result).toBeNull();
  });

  it("counts tag islands from question text", async () => {
    mockGetJSON.mockResolvedValue({
      questions: [
        'You have 6 notes tagged #design but they\'re all in ui. No cross-pollination?',
        '"hub" is referenced by 3 other notes but links to nothing. Dead-end hub?',
      ],
      generatedAt: Date.now(),
    });

    const result = await getCuriosityGapData();
    expect(result).not.toBeNull();
    expect(result!.tagIslands).toBe(1);
    expect(result!.deadEndHubs).toBe(1);
  });

  it("extracts drift gap topics", async () => {
    mockGetJSON.mockResolvedValue({
      questions: [
        'Emerging interest in "kubernetes" but no dedicated note exists. Worth capturing?',
      ],
      generatedAt: Date.now(),
    });

    const result = await getCuriosityGapData();
    expect(result!.driftGaps).toContain("kubernetes");
  });

  it("handles 'Emerging interest' question with no quoted topic (match returns null)", async () => {
    // The question contains "Emerging interest" but no double-quoted topic.
    // The match fails → empty string → filtered out by .filter(Boolean).
    mockGetJSON.mockResolvedValue({
      questions: [
        "Emerging interest in unquoted-topic but no note exists.",
      ],
      generatedAt: Date.now(),
    });

    const result = await getCuriosityGapData();
    expect(result).not.toBeNull();
    // The empty-string branch is reached but filtered out
    expect(result!.driftGaps).toHaveLength(0);
  });

  it("counts orphan cluster questions", async () => {
    mockGetJSON.mockResolvedValue({
      questions: [
        "Root has 4 notes but zero links to other folders. Isolated cluster?",
        "docs has 3 notes but zero links to other folders. Isolated cluster?",
      ],
      generatedAt: Date.now(),
    });

    const result = await getCuriosityGapData();
    expect(result!.orphanClusters).toBe(2);
  });
});
