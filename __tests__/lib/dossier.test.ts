import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDossier,
  saveDossier,
  listDossierIds,
  deleteDossier,
  markSavedToVault,
  type Dossier,
} from "@/lib/dossier";

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
  zadd: vi.fn(),
  zrange: vi.fn(),
  zrem: vi.fn(),
  deleteKey: vi.fn(),
}));

import * as kv from "@/lib/kv";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDossier(id: string, createdAt = "2026-03-17T10:00:00.000Z"): Dossier {
  return {
    id,
    topic: "Test Topic",
    createdAt,
    savedToVault: false,
    suggestedTags: ["tag1", "tag2"],
    vaultFindings: [],
    webFindings: [],
    synthesis: {
      vaultSummary: "vault summary",
      webSummary: "web summary",
      agreements: ["agree1"],
      gaps: ["gap1"],
      recommendations: ["rec1"],
    },
  };
}

// ---------------------------------------------------------------------------
// getDossier
// ---------------------------------------------------------------------------

describe("getDossier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls getJSON with the correct key and returns the dossier", async () => {
    const dossier = makeDossier("dos_abc123");
    vi.mocked(kv.getJSON).mockResolvedValueOnce(dossier);

    const result = await getDossier("dos_abc123");

    expect(kv.getJSON).toHaveBeenCalledWith("dossier:dos_abc123");
    expect(result).toEqual(dossier);
  });

  it("returns null when no dossier is stored for the id", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null);

    const result = await getDossier("missing-id");

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveDossier
// ---------------------------------------------------------------------------

describe("saveDossier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls setJSON with the dossier key and full dossier object", async () => {
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);
    vi.mocked(kv.zadd).mockResolvedValue(undefined);

    const dossier = makeDossier("dos_abc123", "2026-03-17T10:00:00.000Z");
    await saveDossier(dossier);

    expect(kv.setJSON).toHaveBeenCalledWith("dossier:dos_abc123", dossier);
  });

  it("calls zadd with INDEX_KEY, timestamp score, and dossier id", async () => {
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);
    vi.mocked(kv.zadd).mockResolvedValue(undefined);

    const createdAt = "2026-03-17T10:00:00.000Z";
    const dossier = makeDossier("dos_abc123", createdAt);
    await saveDossier(dossier);

    const expectedScore = new Date(createdAt).getTime();
    expect(kv.zadd).toHaveBeenCalledWith("dossier:index", expectedScore, "dos_abc123");
  });
});

// ---------------------------------------------------------------------------
// listDossierIds
// ---------------------------------------------------------------------------

describe("listDossierIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ids in reverse order (newest first)", async () => {
    vi.mocked(kv.zrange).mockResolvedValueOnce([
      "dos_oldest",
      "dos_middle",
      "dos_newest",
    ]);

    const result = await listDossierIds();

    expect(kv.zrange).toHaveBeenCalledWith("dossier:index", 0, -1);
    expect(result).toEqual(["dos_newest", "dos_middle", "dos_oldest"]);
  });

  it("returns empty array when no dossiers exist", async () => {
    vi.mocked(kv.zrange).mockResolvedValueOnce([]);

    const result = await listDossierIds();

    expect(result).toEqual([]);
  });

  it("returns single-element array unchanged after reverse", async () => {
    vi.mocked(kv.zrange).mockResolvedValueOnce(["dos_only"]);

    const result = await listDossierIds();

    expect(result).toEqual(["dos_only"]);
  });
});

// ---------------------------------------------------------------------------
// deleteDossier
// ---------------------------------------------------------------------------

describe("deleteDossier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls deleteKey with the dossier key", async () => {
    vi.mocked(kv.deleteKey).mockResolvedValue(undefined);
    vi.mocked(kv.zrem).mockResolvedValue(undefined);

    await deleteDossier("dos_abc123");

    expect(kv.deleteKey).toHaveBeenCalledWith("dossier:dos_abc123");
  });

  it("calls zrem with INDEX_KEY and the dossier id", async () => {
    vi.mocked(kv.deleteKey).mockResolvedValue(undefined);
    vi.mocked(kv.zrem).mockResolvedValue(undefined);

    await deleteDossier("dos_abc123");

    expect(kv.zrem).toHaveBeenCalledWith("dossier:index", "dos_abc123");
  });

  it("calls both deleteKey and zrem for every deletion", async () => {
    vi.mocked(kv.deleteKey).mockResolvedValue(undefined);
    vi.mocked(kv.zrem).mockResolvedValue(undefined);

    await deleteDossier("dos_xyz");

    expect(kv.deleteKey).toHaveBeenCalledTimes(1);
    expect(kv.zrem).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// markSavedToVault
// ---------------------------------------------------------------------------

describe("markSavedToVault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets savedToVault=true and persists the dossier when it exists", async () => {
    const dossier = makeDossier("dos_abc123");
    expect(dossier.savedToVault).toBe(false);

    vi.mocked(kv.getJSON).mockResolvedValueOnce(dossier);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    await markSavedToVault("dos_abc123");

    expect(kv.getJSON).toHaveBeenCalledWith("dossier:dos_abc123");
    expect(kv.setJSON).toHaveBeenCalledWith("dossier:dos_abc123", {
      ...dossier,
      savedToVault: true,
    });
  });

  it("mutates the in-memory object to savedToVault=true", async () => {
    const dossier = makeDossier("dos_abc123");
    vi.mocked(kv.getJSON).mockResolvedValueOnce(dossier);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    await markSavedToVault("dos_abc123");

    // The object passed to setJSON should have savedToVault=true
    const savedArg = vi.mocked(kv.setJSON).mock.calls[0][1] as Dossier;
    expect(savedArg.savedToVault).toBe(true);
  });

  it("does nothing when the dossier does not exist", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null);

    await markSavedToVault("nonexistent-id");

    expect(kv.setJSON).not.toHaveBeenCalled();
  });

  it("does not call zadd — only setJSON for vault mark", async () => {
    const dossier = makeDossier("dos_abc123");
    vi.mocked(kv.getJSON).mockResolvedValueOnce(dossier);
    vi.mocked(kv.setJSON).mockResolvedValue(undefined);

    await markSavedToVault("dos_abc123");

    expect(kv.zadd).not.toHaveBeenCalled();
  });
});
