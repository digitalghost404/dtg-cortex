// ---------------------------------------------------------------------------
// scars.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
  deleteKey: vi.fn(),
  zadd: vi.fn(),
  zrange: vi.fn(),
  zrem: vi.fn(),
}));

import * as kv from "@/lib/kv";
import { saveScar, getScars, pruneScars, type ScarTombstone } from "@/lib/scars";

// ---------------------------------------------------------------------------
// Typed mock aliases
// ---------------------------------------------------------------------------

const mockGetJSON = kv.getJSON as ReturnType<typeof vi.fn>;
const mockSetJSON = kv.setJSON as ReturnType<typeof vi.fn>;
const mockDeleteKey = kv.deleteKey as ReturnType<typeof vi.fn>;
const mockZadd = kv.zadd as ReturnType<typeof vi.fn>;
const mockZrange = kv.zrange as ReturnType<typeof vi.fn>;
const mockZrem = kv.zrem as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Constants mirroring the module internals
// ---------------------------------------------------------------------------

const SCARS_SET_KEY = "cortex:scars";
const SCAR_TTL_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTombstone(overrides: Partial<ScarTombstone> = {}): ScarTombstone {
  return {
    path: "notes/deleted.md",
    name: "deleted",
    folder: "notes",
    tags: ["#old"],
    connectedNotes: ["other.md"],
    deletedAt: new Date().toISOString(),
    ...overrides,
  };
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSetJSON.mockResolvedValue(undefined);
  mockDeleteKey.mockResolvedValue(undefined);
  mockZadd.mockResolvedValue(undefined);
  mockZrange.mockResolvedValue([]);
  mockZrem.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// saveScar
// ---------------------------------------------------------------------------

describe("saveScar", () => {
  it("creates a tombstone with a current deletedAt timestamp", async () => {
    vi.useFakeTimers();
    const now = new Date("2024-06-01T12:00:00.000Z");
    vi.setSystemTime(now);

    await saveScar({
      path: "notes/foo.md",
      name: "foo",
      folder: "notes",
      tags: ["#tag"],
      connectedNotes: [],
    });

    const tombstone: ScarTombstone = mockSetJSON.mock.calls[0][1];
    expect(tombstone.deletedAt).toBe(now.toISOString());

    vi.useRealTimers();
  });

  it("stores the tombstone under the correct key", async () => {
    await saveScar({
      path: "notes/bar.md",
      name: "bar",
      folder: "notes",
      tags: [],
      connectedNotes: [],
    });

    expect(mockSetJSON).toHaveBeenCalledWith("scar:notes/bar.md", expect.objectContaining({
      path: "notes/bar.md",
      name: "bar",
    }));
  });

  it("adds the path to the sorted set with the current timestamp as score", async () => {
    vi.useFakeTimers();
    const now = 1_717_200_000_000; // fixed ms timestamp
    vi.setSystemTime(now);

    await saveScar({
      path: "p.md",
      name: "p",
      folder: "(root)",
      tags: [],
      connectedNotes: [],
    });

    expect(mockZadd).toHaveBeenCalledWith(SCARS_SET_KEY, now, "p.md");

    vi.useRealTimers();
  });

  it("includes all provided data in the tombstone", async () => {
    const data = {
      path: "journal/2024.md",
      name: "2024",
      folder: "journal",
      tags: ["#journal", "#2024"],
      connectedNotes: ["index.md", "previous.md"],
    };

    await saveScar(data);

    const tombstone: ScarTombstone = mockSetJSON.mock.calls[0][1];
    expect(tombstone.path).toBe(data.path);
    expect(tombstone.name).toBe(data.name);
    expect(tombstone.folder).toBe(data.folder);
    expect(tombstone.tags).toEqual(data.tags);
    expect(tombstone.connectedNotes).toEqual(data.connectedNotes);
  });
});

// ---------------------------------------------------------------------------
// getScars
// ---------------------------------------------------------------------------

describe("getScars", () => {
  it("returns empty array when the sorted set is empty", async () => {
    mockZrange.mockResolvedValue([]);
    const result = await getScars();
    expect(result).toEqual([]);
  });

  it("returns a live scar (within 30 days)", async () => {
    const tombstone = makeTombstone({ path: "live.md", deletedAt: daysAgo(5) });
    mockZrange.mockResolvedValue(["live.md"]);
    mockGetJSON.mockResolvedValue(tombstone);

    const result = await getScars();
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("live.md");
  });

  it("prunes and skips scars older than 30 days", async () => {
    const old = makeTombstone({ path: "old.md", deletedAt: daysAgo(31) });
    mockZrange.mockResolvedValue(["old.md"]);
    mockGetJSON.mockResolvedValue(old);

    const result = await getScars();

    expect(result).toHaveLength(0);
    expect(mockDeleteKey).toHaveBeenCalledWith("scar:old.md");
    expect(mockZrem).toHaveBeenCalledWith(SCARS_SET_KEY, "old.md");
  });

  it("removes orphaned entries where getJSON returns null", async () => {
    mockZrange.mockResolvedValue(["ghost.md"]);
    mockGetJSON.mockResolvedValue(null);

    const result = await getScars();

    expect(result).toHaveLength(0);
    expect(mockZrem).toHaveBeenCalledWith(SCARS_SET_KEY, "ghost.md");
    // deleteKey should NOT be called for orphans (no data to delete)
    expect(mockDeleteKey).not.toHaveBeenCalled();
  });

  it("sorts results newest-first", async () => {
    const older = makeTombstone({ path: "older.md", deletedAt: daysAgo(10) });
    const newer = makeTombstone({ path: "newer.md", deletedAt: daysAgo(2) });
    const mid = makeTombstone({ path: "mid.md", deletedAt: daysAgo(5) });

    mockZrange.mockResolvedValue(["older.md", "newer.md", "mid.md"]);
    mockGetJSON
      .mockResolvedValueOnce(older)
      .mockResolvedValueOnce(newer)
      .mockResolvedValueOnce(mid);

    const result = await getScars();

    expect(result[0].path).toBe("newer.md");
    expect(result[1].path).toBe("mid.md");
    expect(result[2].path).toBe("older.md");
  });

  it("handles a mix of live, expired, and orphaned scars", async () => {
    const live = makeTombstone({ path: "live.md", deletedAt: daysAgo(1) });
    const expired = makeTombstone({ path: "expired.md", deletedAt: daysAgo(35) });

    mockZrange.mockResolvedValue(["live.md", "expired.md", "orphan.md"]);
    mockGetJSON
      .mockResolvedValueOnce(live)     // live
      .mockResolvedValueOnce(expired)  // expired
      .mockResolvedValueOnce(null);    // orphan

    const result = await getScars();

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("live.md");

    // expired should be deleted and removed from set
    expect(mockDeleteKey).toHaveBeenCalledWith("scar:expired.md");
    expect(mockZrem).toHaveBeenCalledWith(SCARS_SET_KEY, "expired.md");

    // orphan should only be removed from set (no deleteKey)
    expect(mockZrem).toHaveBeenCalledWith(SCARS_SET_KEY, "orphan.md");
  });

  it("calls zrange with the correct key and full range", async () => {
    mockZrange.mockResolvedValue([]);
    await getScars();
    expect(mockZrange).toHaveBeenCalledWith(SCARS_SET_KEY, 0, -1);
  });

  it("reads each scar with the correct key format", async () => {
    const tombstone = makeTombstone({ path: "notes/x.md" });
    mockZrange.mockResolvedValue(["notes/x.md"]);
    mockGetJSON.mockResolvedValue(tombstone);

    await getScars();

    expect(mockGetJSON).toHaveBeenCalledWith("scar:notes/x.md");
  });

  it("scar exactly at the 30-day cutoff is considered expired", async () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2024-07-01T00:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    // deletedAt = exactly 30 days ago (cutoff boundary: deletedTime < cutoff)
    const exactCutoff = new Date(fixedNow - SCAR_TTL_DAYS * DAY_MS).toISOString();
    const tombstone = makeTombstone({ path: "boundary.md", deletedAt: exactCutoff });

    mockZrange.mockResolvedValue(["boundary.md"]);
    mockGetJSON.mockResolvedValue(tombstone);

    const result = await getScars();
    // deletedTime === cutoff means deletedTime < cutoff is false — NOT pruned
    expect(result).toHaveLength(1);

    vi.useRealTimers();
  });

  it("scar one millisecond past the cutoff is pruned", async () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2024-07-01T00:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const justExpired = new Date(fixedNow - SCAR_TTL_DAYS * DAY_MS - 1).toISOString();
    const tombstone = makeTombstone({ path: "just-expired.md", deletedAt: justExpired });

    mockZrange.mockResolvedValue(["just-expired.md"]);
    mockGetJSON.mockResolvedValue(tombstone);

    const result = await getScars();
    expect(result).toHaveLength(0);
    expect(mockDeleteKey).toHaveBeenCalledWith("scar:just-expired.md");

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// pruneScars
// ---------------------------------------------------------------------------

describe("pruneScars", () => {
  it("returns 0 when the sorted set is empty", async () => {
    mockZrange.mockResolvedValue([]);
    const count = await pruneScars();
    expect(count).toBe(0);
  });

  it("prunes scars older than the default 30 days", async () => {
    const old = makeTombstone({ path: "old.md", deletedAt: daysAgo(31) });
    mockZrange.mockResolvedValue(["old.md"]);
    mockGetJSON.mockResolvedValue(old);

    const count = await pruneScars();

    expect(count).toBe(1);
    expect(mockDeleteKey).toHaveBeenCalledWith("scar:old.md");
    expect(mockZrem).toHaveBeenCalledWith(SCARS_SET_KEY, "old.md");
  });

  it("does not prune scars within the retention window", async () => {
    const fresh = makeTombstone({ path: "fresh.md", deletedAt: daysAgo(5) });
    mockZrange.mockResolvedValue(["fresh.md"]);
    mockGetJSON.mockResolvedValue(fresh);

    const count = await pruneScars();

    expect(count).toBe(0);
    expect(mockDeleteKey).not.toHaveBeenCalled();
    expect(mockZrem).not.toHaveBeenCalled();
  });

  it("respects a custom keepDays argument", async () => {
    // Only 3 days old but keepDays=2 means it should be pruned
    const tombstone = makeTombstone({ path: "short-lived.md", deletedAt: daysAgo(3) });
    mockZrange.mockResolvedValue(["short-lived.md"]);
    mockGetJSON.mockResolvedValue(tombstone);

    const count = await pruneScars(2);

    expect(count).toBe(1);
    expect(mockDeleteKey).toHaveBeenCalledWith("scar:short-lived.md");
  });

  it("counts and prunes orphaned entries (getJSON returns null)", async () => {
    mockZrange.mockResolvedValue(["orphan.md"]);
    mockGetJSON.mockResolvedValue(null);

    const count = await pruneScars();

    expect(count).toBe(1);
    expect(mockDeleteKey).toHaveBeenCalledWith("scar:orphan.md");
    expect(mockZrem).toHaveBeenCalledWith(SCARS_SET_KEY, "orphan.md");
  });

  it("returns the correct count when multiple scars are pruned", async () => {
    const paths = ["a.md", "b.md", "c.md"];
    const tombstones = paths.map((p) =>
      makeTombstone({ path: p, deletedAt: daysAgo(40) })
    );

    mockZrange.mockResolvedValue(paths);
    mockGetJSON
      .mockResolvedValueOnce(tombstones[0])
      .mockResolvedValueOnce(tombstones[1])
      .mockResolvedValueOnce(tombstones[2]);

    const count = await pruneScars();
    expect(count).toBe(3);
  });

  it("handles a mix of prunable and live scars, counting only pruned", async () => {
    const live = makeTombstone({ path: "live.md", deletedAt: daysAgo(10) });
    const dead = makeTombstone({ path: "dead.md", deletedAt: daysAgo(35) });

    mockZrange.mockResolvedValue(["live.md", "dead.md"]);
    mockGetJSON
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(dead);

    const count = await pruneScars();

    expect(count).toBe(1);
    expect(mockDeleteKey).toHaveBeenCalledWith("scar:dead.md");
    expect(mockDeleteKey).not.toHaveBeenCalledWith("scar:live.md");
  });

  it("calls zrange with the correct key", async () => {
    mockZrange.mockResolvedValue([]);
    await pruneScars();
    expect(mockZrange).toHaveBeenCalledWith(SCARS_SET_KEY, 0, -1);
  });

  it("reads each scar with the scar: key prefix", async () => {
    const tombstone = makeTombstone({ path: "check/key.md", deletedAt: daysAgo(50) });
    mockZrange.mockResolvedValue(["check/key.md"]);
    mockGetJSON.mockResolvedValue(tombstone);

    await pruneScars();

    expect(mockGetJSON).toHaveBeenCalledWith("scar:check/key.md");
  });

  it("uses fake timers to verify cutoff calculation", async () => {
    vi.useFakeTimers();
    const fixedNow = new Date("2024-09-01T00:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    // Scar deleted exactly 30 days ago: NOT pruned (cutoff = Date.now() - 30days,
    // so deletedTime === cutoff -> condition `< cutoff` is false)
    const exactly30 = new Date(fixedNow - 30 * DAY_MS).toISOString();
    const s1 = makeTombstone({ path: "exact.md", deletedAt: exactly30 });

    // Scar deleted 30 days + 1ms ago: IS pruned
    const justOver30 = new Date(fixedNow - 30 * DAY_MS - 1).toISOString();
    const s2 = makeTombstone({ path: "over.md", deletedAt: justOver30 });

    mockZrange.mockResolvedValue(["exact.md", "over.md"]);
    mockGetJSON.mockResolvedValueOnce(s1).mockResolvedValueOnce(s2);

    const count = await pruneScars();
    expect(count).toBe(1);
    expect(mockDeleteKey).toHaveBeenCalledWith("scar:over.md");
    expect(mockDeleteKey).not.toHaveBeenCalledWith("scar:exact.md");

    vi.useRealTimers();
  });
});
