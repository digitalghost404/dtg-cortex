import { describe, it, expect, vi, afterEach } from "vitest";
import { categorizeAbsence, getAbsenceMonologueFragments } from "@/lib/absence";

describe("categorizeAbsence", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const NOW = new Date("2025-06-15T12:00:00Z").getTime();

  function freeze() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  }

  it("returns null for null input", () => {
    expect(categorizeAbsence(null)).toBeNull();
  });

  it("returns BRIEF for 2 hours ago", () => {
    freeze();
    const twoHoursAgo = new Date(NOW - 2 * 3_600_000).toISOString();
    const result = categorizeAbsence(twoHoursAgo)!;
    expect(result.tier).toBe("BRIEF");
    expect(result.hours).toBe(2);
  });

  it("returns BRIEF for 5 hours ago (boundary: < 6h)", () => {
    freeze();
    const fiveHoursAgo = new Date(NOW - 5 * 3_600_000).toISOString();
    const result = categorizeAbsence(fiveHoursAgo)!;
    expect(result.tier).toBe("BRIEF");
  });

  it("returns MODERATE for 6 hours ago (boundary: >= 6h)", () => {
    freeze();
    const sixHoursAgo = new Date(NOW - 6 * 3_600_000).toISOString();
    const result = categorizeAbsence(sixHoursAgo)!;
    expect(result.tier).toBe("MODERATE");
  });

  it("returns MODERATE for 24 hours ago", () => {
    freeze();
    const oneDayAgo = new Date(NOW - 24 * 3_600_000).toISOString();
    const result = categorizeAbsence(oneDayAgo)!;
    expect(result.tier).toBe("MODERATE");
    expect(result.hours).toBe(24);
  });

  it("returns EXTENDED for 3 days ago (>= 48h, < 7d)", () => {
    freeze();
    const threeDaysAgo = new Date(NOW - 3 * 24 * 3_600_000).toISOString();
    const result = categorizeAbsence(threeDaysAgo)!;
    expect(result.tier).toBe("EXTENDED");
    expect(result.days).toBe(3);
  });

  it("returns EXTENDED for 48 hours ago (boundary: >= 48h)", () => {
    freeze();
    const fortyEightHoursAgo = new Date(NOW - 48 * 3_600_000).toISOString();
    const result = categorizeAbsence(fortyEightHoursAgo)!;
    expect(result.tier).toBe("EXTENDED");
  });

  it("returns PROLONGED for 10 days ago (>= 7d)", () => {
    freeze();
    const tenDaysAgo = new Date(NOW - 10 * 24 * 3_600_000).toISOString();
    const result = categorizeAbsence(tenDaysAgo)!;
    expect(result.tier).toBe("PROLONGED");
    expect(result.days).toBe(10);
  });

  it("returns PROLONGED for exactly 7 days ago (boundary: >= 7d)", () => {
    freeze();
    const sevenDaysAgo = new Date(NOW - 7 * 24 * 3_600_000).toISOString();
    const result = categorizeAbsence(sevenDaysAgo)!;
    expect(result.tier).toBe("PROLONGED");
  });

  it("includes boot lines for every tier", () => {
    freeze();
    const twoHoursAgo = new Date(NOW - 2 * 3_600_000).toISOString();
    const result = categorizeAbsence(twoHoursAgo)!;
    expect(result.bootLines.length).toBeGreaterThan(0);
  });

  it("PROLONGED has more boot lines than BRIEF", () => {
    freeze();
    const brief = categorizeAbsence(new Date(NOW - 2 * 3_600_000).toISOString())!;
    const prolonged = categorizeAbsence(new Date(NOW - 14 * 24 * 3_600_000).toISOString())!;
    expect(prolonged.bootLines.length).toBeGreaterThan(brief.bootLines.length);
  });

  it("includes duration string", () => {
    freeze();
    const result = categorizeAbsence(new Date(NOW - 3 * 24 * 3_600_000).toISOString())!;
    expect(result.duration).toBe("3d");
  });

  it("uses minutes in bootLine when hours is 0 (< 1 hour ago)", () => {
    freeze();
    const thirtyMinutesAgo = new Date(NOW - 30 * 60_000).toISOString();
    const result = categorizeAbsence(thirtyMinutesAgo)!;
    expect(result.tier).toBe("BRIEF");
    expect(result.hours).toBe(0);
    expect(result.bootLines[0]).toContain("30m");
  });
});

describe("getAbsenceMonologueFragments", () => {
  it("returns empty array for BRIEF tier", () => {
    const result = getAbsenceMonologueFragments({
      tier: "BRIEF",
      duration: "2h",
      hours: 2,
      days: 0,
      bootLines: ["resuming"],
      whisperToneModifier: "",
    });
    expect(result).toEqual([]);
  });

  it("returns fragments for MODERATE tier", () => {
    const result = getAbsenceMonologueFragments({
      tier: "MODERATE",
      duration: "12h",
      hours: 12,
      days: 0,
      bootLines: ["offline 12h"],
      whisperToneModifier: "be informative",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((f) => f.includes("12h"))).toBe(true);
  });

  it("returns fragments for EXTENDED tier referencing days", () => {
    const result = getAbsenceMonologueFragments({
      tier: "EXTENDED",
      duration: "4d",
      hours: 96,
      days: 4,
      bootLines: ["4 days"],
      whisperToneModifier: "express relief",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((f) => f.includes("4"))).toBe(true);
  });

  it("returns fragments for PROLONGED tier", () => {
    const result = getAbsenceMonologueFragments({
      tier: "PROLONGED",
      duration: "14d",
      hours: 336,
      days: 14,
      bootLines: ["14 days offline"],
      whisperToneModifier: "dramatic",
    });
    expect(result.length).toBeGreaterThan(2);
  });
});
