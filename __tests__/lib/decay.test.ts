import { describe, it, expect, vi, afterEach } from "vitest";
import { computeDecayScores } from "@/lib/decay";

describe("computeDecayScores", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const NOW = new Date("2025-06-15T12:00:00Z").getTime();

  function withFrozenTime(fn: () => void) {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    fn();
  }

  it("returns an empty map for empty input", () => {
    const result = computeDecayScores([]);
    expect(result.size).toBe(0);
  });

  it("scores a note modified today as ~0", () => {
    withFrozenTime(() => {
      const result = computeDecayScores([
        { path: "today.md", modifiedAt: new Date(NOW).toISOString() },
      ]);
      expect(result.get("today.md")).toBeCloseTo(0, 1);
    });
  });

  it("scores a note modified 45 days ago as ~0.5", () => {
    withFrozenTime(() => {
      const fortyFiveDaysAgo = new Date(NOW - 45 * 86_400_000).toISOString();
      const result = computeDecayScores([
        { path: "old.md", modifiedAt: fortyFiveDaysAgo },
      ]);
      expect(result.get("old.md")).toBeCloseTo(0.5, 1);
    });
  });

  it("scores a note modified 90 days ago as 1.0", () => {
    withFrozenTime(() => {
      const ninetyDaysAgo = new Date(NOW - 90 * 86_400_000).toISOString();
      const result = computeDecayScores([
        { path: "ancient.md", modifiedAt: ninetyDaysAgo },
      ]);
      expect(result.get("ancient.md")).toBeCloseTo(1.0, 1);
    });
  });

  it("clamps score at 1.0 for notes older than 90 days", () => {
    withFrozenTime(() => {
      const veryOld = new Date(NOW - 200 * 86_400_000).toISOString();
      const result = computeDecayScores([
        { path: "very-old.md", modifiedAt: veryOld },
      ]);
      expect(result.get("very-old.md")).toBe(1);
    });
  });

  it("handles multiple notes correctly", () => {
    withFrozenTime(() => {
      const result = computeDecayScores([
        { path: "a.md", modifiedAt: new Date(NOW).toISOString() },
        { path: "b.md", modifiedAt: new Date(NOW - 90 * 86_400_000).toISOString() },
      ]);
      expect(result.size).toBe(2);
      expect(result.get("a.md")!).toBeLessThan(result.get("b.md")!);
    });
  });

  it("never returns negative scores", () => {
    withFrozenTime(() => {
      // Future date should clamp to 0
      const future = new Date(NOW + 10 * 86_400_000).toISOString();
      const result = computeDecayScores([
        { path: "future.md", modifiedAt: future },
      ]);
      expect(result.get("future.md")).toBe(0);
    });
  });
});
