import { describe, it, expect } from "vitest";
import { getCircadianPhase } from "@/lib/circadian";

describe("getCircadianPhase", () => {
  it("returns NIGHT for hour 23", () => {
    expect(getCircadianPhase(23).phase).toBe("NIGHT");
  });

  it("returns NIGHT for hour 0", () => {
    expect(getCircadianPhase(0).phase).toBe("NIGHT");
  });

  it("returns NIGHT for hour 4", () => {
    expect(getCircadianPhase(4).phase).toBe("NIGHT");
  });

  it("returns NIGHT for hour 2 (mid-range)", () => {
    expect(getCircadianPhase(2).phase).toBe("NIGHT");
  });

  it("returns DAWN for hour 5", () => {
    expect(getCircadianPhase(5).phase).toBe("DAWN");
  });

  it("returns DAWN for hour 8", () => {
    expect(getCircadianPhase(8).phase).toBe("DAWN");
  });

  it("returns DAWN for hour 7 (mid-range)", () => {
    expect(getCircadianPhase(7).phase).toBe("DAWN");
  });

  it("returns DAY for hour 9", () => {
    expect(getCircadianPhase(9).phase).toBe("DAY");
  });

  it("returns DAY for hour 16", () => {
    expect(getCircadianPhase(16).phase).toBe("DAY");
  });

  it("returns DAY for hour 12 (mid-range)", () => {
    expect(getCircadianPhase(12).phase).toBe("DAY");
  });

  it("returns DUSK for hour 17", () => {
    expect(getCircadianPhase(17).phase).toBe("DUSK");
  });

  it("returns DUSK for hour 22", () => {
    expect(getCircadianPhase(22).phase).toBe("DUSK");
  });

  it("returns DUSK for hour 20 (mid-range)", () => {
    expect(getCircadianPhase(20).phase).toBe("DUSK");
  });

  it("includes a personalityModifier string", () => {
    const result = getCircadianPhase(12);
    expect(result.personalityModifier).toBeTruthy();
    expect(typeof result.personalityModifier).toBe("string");
  });

  it("includes a scrollSpeedFactor number", () => {
    const result = getCircadianPhase(12);
    expect(typeof result.scrollSpeedFactor).toBe("number");
    expect(result.scrollSpeedFactor).toBeGreaterThan(0);
  });

  it("NIGHT has the slowest scroll speed", () => {
    const night = getCircadianPhase(0).scrollSpeedFactor;
    const day = getCircadianPhase(12).scrollSpeedFactor;
    expect(night).toBeLessThan(day);
  });

  it("DAY has the fastest scroll speed", () => {
    const day = getCircadianPhase(12).scrollSpeedFactor;
    const dawn = getCircadianPhase(6).scrollSpeedFactor;
    const dusk = getCircadianPhase(20).scrollSpeedFactor;
    const night = getCircadianPhase(0).scrollSpeedFactor;
    expect(day).toBeGreaterThan(dawn);
    expect(day).toBeGreaterThan(dusk);
    expect(day).toBeGreaterThan(night);
  });
});
