// ---------------------------------------------------------------------------
// sessions.test.ts
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
  deleteKey: vi.fn(),
  zadd: vi.fn(),
  zrange: vi.fn(),
  zrem: vi.fn(),
  mget: vi.fn(),
}));

import * as kv from "@/lib/kv";
import {
  getSessions,
  getSession,
  createSession,
  saveSession,
  deleteSession,
  type Session,
} from "@/lib/sessions";

// ---------------------------------------------------------------------------
// Typed mock aliases
// ---------------------------------------------------------------------------

const mockGetJSON = kv.getJSON as ReturnType<typeof vi.fn>;
const mockSetJSON = kv.setJSON as ReturnType<typeof vi.fn>;
const mockDeleteKey = kv.deleteKey as ReturnType<typeof vi.fn>;
const mockZadd = kv.zadd as ReturnType<typeof vi.fn>;
const mockZrange = kv.zrange as ReturnType<typeof vi.fn>;
const mockZrem = kv.zrem as ReturnType<typeof vi.fn>;
const mockMget = kv.mget as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "test-id",
    title: "Test Session",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    messages: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSetJSON.mockResolvedValue(undefined);
  mockDeleteKey.mockResolvedValue(undefined);
  mockZadd.mockResolvedValue(undefined);
  mockZrem.mockResolvedValue(undefined);
  mockZrange.mockResolvedValue([]);
  mockMget.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// getSessions
// ---------------------------------------------------------------------------

describe("getSessions", () => {
  it("returns empty array when the sorted set is empty", async () => {
    mockZrange.mockResolvedValue([]);
    const result = await getSessions();
    expect(result).toEqual([]);
    expect(mockMget).not.toHaveBeenCalled();
  });

  it("fetches sessions by ID and returns them", async () => {
    const s1 = makeSession({ id: "id-1", updatedAt: "2024-01-02T00:00:00.000Z" });
    const s2 = makeSession({ id: "id-2", updatedAt: "2024-01-01T00:00:00.000Z" });

    mockZrange.mockResolvedValue(["id-1", "id-2"]);
    mockMget.mockResolvedValue([s1, s2]);

    const result = await getSessions();
    expect(result).toHaveLength(2);
  });

  it("maps IDs to session: keys when calling mget", async () => {
    mockZrange.mockResolvedValue(["abc"]);
    mockMget.mockResolvedValue([makeSession({ id: "abc" })]);

    await getSessions();

    expect(mockMget).toHaveBeenCalledWith("session:abc");
  });

  it("filters out null entries from mget results", async () => {
    const valid = makeSession({ id: "x" });
    mockZrange.mockResolvedValue(["x", "y"]);
    mockMget.mockResolvedValue([valid, null]);

    const result = await getSessions();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("x");
  });

  it("sorts sessions by updatedAt descending (most recent first)", async () => {
    const older = makeSession({ id: "old", updatedAt: "2024-01-01T00:00:00.000Z" });
    const newer = makeSession({ id: "new", updatedAt: "2024-06-01T00:00:00.000Z" });
    const mid = makeSession({ id: "mid", updatedAt: "2024-03-01T00:00:00.000Z" });

    mockZrange.mockResolvedValue(["old", "new", "mid"]);
    mockMget.mockResolvedValue([older, newer, mid]);

    const result = await getSessions();
    expect(result[0].id).toBe("new");
    expect(result[1].id).toBe("mid");
    expect(result[2].id).toBe("old");
  });

  it("returns single session without throwing", async () => {
    const session = makeSession({ id: "solo" });
    mockZrange.mockResolvedValue(["solo"]);
    mockMget.mockResolvedValue([session]);

    const result = await getSessions();
    expect(result).toHaveLength(1);
  });

  it("calls zrange with the sessions index key and full range", async () => {
    mockZrange.mockResolvedValue([]);
    await getSessions();
    expect(mockZrange).toHaveBeenCalledWith("sessions:index", 0, -1);
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe("getSession", () => {
  it("returns the session when it exists", async () => {
    const session = makeSession({ id: "found" });
    mockGetJSON.mockResolvedValue(session);

    const result = await getSession("found");
    expect(result).toEqual(session);
  });

  it("returns null when session does not exist", async () => {
    mockGetJSON.mockResolvedValue(null);
    const result = await getSession("missing");
    expect(result).toBeNull();
  });

  it("calls getJSON with the correct session key", async () => {
    mockGetJSON.mockResolvedValue(null);
    await getSession("my-id");
    expect(mockGetJSON).toHaveBeenCalledWith("session:my-id");
  });
});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe("createSession", () => {
  it("returns a session with the expected shape", async () => {
    const session = await createSession();

    expect(session.id).toBeTruthy();
    expect(typeof session.id).toBe("string");
    expect(session.title).toBe("New Session");
    expect(session.messages).toEqual([]);
    expect(typeof session.createdAt).toBe("string");
    expect(typeof session.updatedAt).toBe("string");
  });

  it("assigns a UUID as the id", async () => {
    const session = await createSession();
    // UUID v4 pattern
    expect(session.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("persists the session via setJSON", async () => {
    const session = await createSession();
    expect(mockSetJSON).toHaveBeenCalledWith(`session:${session.id}`, session);
  });

  it("adds the session id to the sorted set via zadd", async () => {
    const session = await createSession();
    const expectedScore = new Date(session.updatedAt).getTime();
    expect(mockZadd).toHaveBeenCalledWith("sessions:index", expectedScore, session.id);
  });

  it("sets createdAt and updatedAt to the same timestamp", async () => {
    const session = await createSession();
    expect(session.createdAt).toBe(session.updatedAt);
  });
});

// ---------------------------------------------------------------------------
// saveSession
// ---------------------------------------------------------------------------

describe("saveSession", () => {
  it("persists the session via setJSON", async () => {
    const session = makeSession({ id: "s1", updatedAt: "2024-05-01T00:00:00.000Z" });
    await saveSession(session);
    expect(mockSetJSON).toHaveBeenCalledWith("session:s1", session);
  });

  it("updates the sorted set with the updatedAt timestamp as score", async () => {
    const session = makeSession({ id: "s2", updatedAt: "2024-05-15T12:00:00.000Z" });
    await saveSession(session);
    const expectedScore = new Date("2024-05-15T12:00:00.000Z").getTime();
    expect(mockZadd).toHaveBeenCalledWith("sessions:index", expectedScore, "s2");
  });

  it("calls both setJSON and zadd", async () => {
    const session = makeSession();
    await saveSession(session);
    expect(mockSetJSON).toHaveBeenCalledOnce();
    expect(mockZadd).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe("deleteSession", () => {
  it("deletes the session from KV", async () => {
    await deleteSession("del-id");
    expect(mockDeleteKey).toHaveBeenCalledWith("session:del-id");
  });

  it("removes the session id from the sorted set", async () => {
    await deleteSession("del-id");
    expect(mockZrem).toHaveBeenCalledWith("sessions:index", "del-id");
  });

  it("calls both deleteKey and zrem", async () => {
    await deleteSession("any-id");
    expect(mockDeleteKey).toHaveBeenCalledOnce();
    expect(mockZrem).toHaveBeenCalledOnce();
  });
});
