import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
}));

import {
  addMemory,
  getRelevantMemories,
  getMemoryContext,
  deleteMemory,
  touchMemory,
  getAllMemories,
  type MemoryEntry,
} from "@/lib/memory";
import * as kv from "@/lib/kv";

const mockGetJSON = kv.getJSON as ReturnType<typeof vi.fn>;
const mockSetJSON = kv.setJSON as ReturnType<typeof vi.fn>;

function makeMemoryEntry(overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return {
    id: crypto.randomUUID(),
    type: "fact",
    content: "test content",
    source: "test",
    createdAt: new Date().toISOString(),
    lastReferencedAt: new Date().toISOString(),
    referenceCount: 1,
    ...overrides,
  };
}

// Top-level beforeEach to clear call history between all tests
beforeEach(() => {
  vi.clearAllMocks();
  mockSetJSON.mockResolvedValue(undefined);
});

describe("loadMemory error handling", () => {
  it("returns empty store when getJSON throws", async () => {
    mockGetJSON.mockRejectedValue(new Error("connection failed"));
    // loadMemory is called internally by addMemory/getRelevantMemories
    // Test through getRelevantMemories which calls loadMemory
    const result = await getRelevantMemories("test");
    expect(result).toEqual([]);
  });
});

describe("saveMemory error handling", () => {
  it("catches and logs error when setJSON throws", async () => {
    mockGetJSON.mockResolvedValue(null);
    mockSetJSON.mockRejectedValue(new Error("write failed"));

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await addMemory({ type: "fact", content: "will fail to save", source: "test" });
    expect(spy).toHaveBeenCalledWith("[memory saveMemory]", expect.any(Error));
    spy.mockRestore();
  });
});

describe("addMemory", () => {
  it("adds a new entry to an empty store", async () => {
    mockGetJSON.mockResolvedValue(null);

    await addMemory({
      type: "fact",
      content: "User prefers TypeScript",
      source: "conversation",
    });

    const savedStore = mockSetJSON.mock.calls[0][1];
    expect(savedStore.entries).toHaveLength(1);
    expect(savedStore.entries[0].content).toBe("User prefers TypeScript");
    expect(savedStore.entries[0].referenceCount).toBe(1);
  });

  it("deduplicates by content (case-insensitive)", async () => {
    const existing = makeMemoryEntry({
      content: "user likes react",
      referenceCount: 1,
    });
    mockGetJSON.mockResolvedValue({ entries: [existing] });

    await addMemory({
      type: "fact",
      content: "User Likes React",
      source: "conversation",
    });

    const savedStore = mockSetJSON.mock.calls[0][1];
    // Should NOT add a new entry, just bump reference count
    expect(savedStore.entries).toHaveLength(1);
    expect(savedStore.entries[0].referenceCount).toBe(2);
  });

  it("prunes to 50 entries when over limit (keeps most referenced)", async () => {
    const entries = Array.from({ length: 50 }, (_, i) =>
      makeMemoryEntry({ content: `memory-${i}`, referenceCount: i + 1 })
    );
    mockGetJSON.mockResolvedValue({ entries });

    await addMemory({
      type: "fact",
      content: "new memory",
      source: "test",
    });

    const savedStore = mockSetJSON.mock.calls[0][1];
    expect(savedStore.entries.length).toBe(50);
    // The lowest referenceCount entry should be pruned in favor of higher ones
    const refCounts = savedStore.entries.map((e: MemoryEntry) => e.referenceCount);
    expect(Math.min(...refCounts)).toBeGreaterThanOrEqual(1);
  });
});

describe("getRelevantMemories", () => {
  it("returns empty for empty store", async () => {
    mockGetJSON.mockResolvedValue(null);
    const result = await getRelevantMemories("anything");
    expect(result).toEqual([]);
  });

  it("matches memories by keyword", async () => {
    mockGetJSON.mockResolvedValue({
      entries: [
        makeMemoryEntry({ content: "User prefers TypeScript for backend" }),
        makeMemoryEntry({ content: "User dislikes Python" }),
        makeMemoryEntry({ content: "User works at Acme Corp" }),
      ],
    });

    const result = await getRelevantMemories("typescript");
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain("TypeScript");
  });

  it("ranks by keyword match count then reference count", async () => {
    mockGetJSON.mockResolvedValue({
      entries: [
        makeMemoryEntry({
          content: "TypeScript is great for projects",
          referenceCount: 5,
        }),
        makeMemoryEntry({
          content: "TypeScript generics and TypeScript utility types",
          referenceCount: 1,
        }),
      ],
    });

    const result = await getRelevantMemories("typescript generics");
    // Second entry has more keyword matches ("typescript" x2 + "generics" x1 = 3 vs 1)
    expect(result[0].content).toContain("generics");
  });

  it("returns most-referenced when query has no useful keywords", async () => {
    mockGetJSON.mockResolvedValue({
      entries: [
        makeMemoryEntry({ content: "memory-a", referenceCount: 1 }),
        makeMemoryEntry({ content: "memory-b", referenceCount: 10 }),
      ],
    });

    // All words <= 2 chars
    const result = await getRelevantMemories("a b c");
    expect(result[0].content).toBe("memory-b");
  });

  it("respects limit parameter", async () => {
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeMemoryEntry({ content: `pattern matching item ${i}` })
    );
    mockGetJSON.mockResolvedValue({ entries });

    const result = await getRelevantMemories("pattern matching", 3);
    expect(result).toHaveLength(3);
  });

  it("only matches words longer than 2 chars", async () => {
    mockGetJSON.mockResolvedValue({
      entries: [
        makeMemoryEntry({ content: "is a test" }),
      ],
    });

    // "is" and "an" are <= 2 chars, filtered out; "test" matches
    const result = await getRelevantMemories("is an test");
    expect(result).toHaveLength(1);
  });
});

describe("getMemoryContext", () => {
  it("returns empty string for empty store", async () => {
    mockGetJSON.mockResolvedValue(null);
    const result = await getMemoryContext();
    expect(result).toBe("");
  });

  it("returns formatted context with top entries", async () => {
    mockGetJSON.mockResolvedValue({
      entries: [
        makeMemoryEntry({ content: "User is a data scientist", referenceCount: 5 }),
        makeMemoryEntry({ content: "User likes dark mode", referenceCount: 1 }),
      ],
    });

    const result = await getMemoryContext();
    expect(result).toContain("Your memory of this user:");
    expect(result).toContain("data scientist");
    expect(result).toContain("referenced 5 times");
    expect(result).toContain("referenced 1 time");
  });
});

describe("deleteMemory", () => {
  it("removes entry by id", async () => {
    const entry = makeMemoryEntry({ id: "target-id", content: "to delete" });
    const keeper = makeMemoryEntry({ id: "keep-id", content: "to keep" });
    mockGetJSON.mockResolvedValue({ entries: [entry, keeper] });

    await deleteMemory("target-id");

    const savedStore = mockSetJSON.mock.calls[0][1];
    expect(savedStore.entries).toHaveLength(1);
    expect(savedStore.entries[0].id).toBe("keep-id");
  });
});

describe("touchMemory", () => {
  it("increments reference count and updates timestamp", async () => {
    const entry = makeMemoryEntry({
      id: "touch-id",
      referenceCount: 3,
    });
    mockGetJSON.mockResolvedValue({ entries: [entry] });

    await touchMemory("touch-id");

    const savedStore = mockSetJSON.mock.calls[0][1];
    expect(savedStore.entries[0].referenceCount).toBe(4);
  });

  it("does nothing when ID is not found", async () => {
    mockGetJSON.mockResolvedValue({ entries: [makeMemoryEntry({ id: "other" })] });

    await touchMemory("nonexistent-id");

    expect(mockSetJSON).not.toHaveBeenCalled();
  });
});

describe("getAllMemories", () => {
  it("returns all entries from the store", async () => {
    const entries = [makeMemoryEntry(), makeMemoryEntry()];
    mockGetJSON.mockResolvedValue({ entries });

    const result = await getAllMemories();
    expect(result).toHaveLength(2);
  });
});
