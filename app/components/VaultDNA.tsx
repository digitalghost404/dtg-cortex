"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { VaultDNA } from "../api/vault-dna/route";

// ---------------------------------------------------------------------------
// Seeded pseudo-random number generator (mulberry32)
// Gives us deterministic "randomness" keyed to vault identity.
// ---------------------------------------------------------------------------

function makePRNG(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Color helpers — hash a string to a hue in the cyan/teal/blue family (160-240°)
// ---------------------------------------------------------------------------

function hashStringToHue(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  // Map to cyan/teal/blue family: 160–240 degrees
  const normalised = (Math.abs(hash) % 1000) / 1000;
  return 160 + normalised * 80;
}

function hsl(h: number, s: number, l: number, a = 1): string {
  return `hsla(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l.toFixed(1)}%, ${a.toFixed(3)})`;
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

interface Palette {
  primaryHues: number[];
  accentHues: number[];
}

function buildPalette(dna: VaultDNA): Palette {
  const primaryHues =
    dna.topFolders.length > 0
      ? dna.topFolders.map(hashStringToHue)
      : [190, 200, 210];

  const accentHues =
    dna.topTags.length > 0
      ? dna.topTags.map(hashStringToHue)
      : [180, 220, 240];

  return { primaryHues, accentHues };
}

interface Dot {
  x: number;
  y: number;
  r: number;
  hue: number;
  ringIndex: number;
}

interface DrawConfig {
  cx: number;
  cy: number;
  coreRadius: number;
  rings: number;
  dotCount: number;
  dots: Dot[];
  connections: [number, number][];
  palette: Palette;
  linkDensity: number;
  avgNoteLength: number;
  activityScore: number;
}

function buildDrawConfig(dna: VaultDNA, size: number): DrawConfig {
  // Seed from noteCount + totalWords for fully deterministic output
  const seed = ((dna.noteCount * 1000) + dna.totalWords) >>> 0;
  const rng = makePRNG(seed);

  const palette = buildPalette(dna);
  const cx = size / 2;
  const cy = size / 2;

  // Core radius: scales with note count, 12–30% of half-size
  const maxR = size * 0.5;
  const coreRadius = maxR * (0.12 + dna.noteCount * 0.00015 * 0.18);
  const clampedCore = Math.min(Math.max(coreRadius, maxR * 0.12), maxR * 0.30);

  // Ring count: 1–5 based on topicSpread
  const rings = Math.max(1, Math.round(1 + dna.topicSpread * 4));

  // Dot count per ring: driven by linkDensity
  const dotsPerRing = Math.max(3, Math.round(4 + dna.linkDensity * 10));
  const dots: Dot[] = [];

  for (let ri = 0; ri < rings; ri++) {
    // Ring radius: evenly spaced from just outside core to near edge
    const minRingR = clampedCore + maxR * 0.08;
    const maxRingR = maxR * 0.82;
    const ringR = minRingR + (ri / Math.max(rings - 1, 1)) * (maxRingR - minRingR);

    // Slight ellipse — semi-axes differ by a small amount per ring
    const xScale = 1;
    const yScale = 0.72 + ri * 0.04; // compress y-axis slightly, more for outer rings
    const rotOffset = (ri * 0.4) + rng() * 0.3;

    const hue = palette.primaryHues[ri % palette.primaryHues.length];

    for (let di = 0; di < dotsPerRing; di++) {
      // Evenly distribute angle, then add small jitter
      const baseAngle = (di / dotsPerRing) * Math.PI * 2;
      const jitter = (rng() - 0.5) * (Math.PI / dotsPerRing) * 0.6;
      const angle = baseAngle + jitter + rotOffset;

      const x = cx + Math.cos(angle) * ringR * xScale;
      const y = cy + Math.sin(angle) * ringR * yScale;

      const dotR = 1 + rng() * 1.5;
      dots.push({ x, y, r: dotR, hue, ringIndex: ri });
    }
  }

  // Connection lines: choose random pairs weighted by linkDensity
  const maxConnections = Math.round(dna.linkDensity * dots.length * 0.6);
  const connections: [number, number][] = [];
  const used = new Set<string>();

  for (let i = 0; i < maxConnections * 3 && connections.length < maxConnections; i++) {
    const a = Math.floor(rng() * dots.length);
    const b = Math.floor(rng() * dots.length);
    if (a === b) continue;
    const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
    if (used.has(key)) continue;
    used.add(key);
    connections.push([a, b]);
  }

  return {
    cx,
    cy,
    coreRadius: clampedCore,
    rings,
    dotCount: dotsPerRing,
    dots,
    connections,
    palette,
    linkDensity: dna.linkDensity,
    avgNoteLength: dna.avgNoteLength,
    activityScore: dna.activityScore,
  };
}

function drawEmblem(
  ctx: CanvasRenderingContext2D,
  config: DrawConfig,
  size: number,
  pulsePct: number   // 0–1, drives the gentle core pulse
) {
  const { cx, cy, coreRadius, dots, connections, palette, linkDensity, avgNoteLength, activityScore } = config;
  const dpr = 1; // already applied via canvas dimensions
  void dpr;

  ctx.clearRect(0, 0, size, size);

  // ── Outer glow ──────────────────────────────────────────────────────────
  // Intensity based on avgNoteLength
  const glowAlpha = 0.04 + avgNoteLength * 0.12;
  const glowRadius = size * 0.48;
  const outerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
  outerGrad.addColorStop(0, hsl(200, 80, 60, glowAlpha * 2));
  outerGrad.addColorStop(0.5, hsl(195, 70, 50, glowAlpha));
  outerGrad.addColorStop(1, hsl(190, 60, 40, 0));
  ctx.fillStyle = outerGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
  ctx.fill();

  // ── Connection lines ─────────────────────────────────────────────────────
  const lineAlpha = 0.06 + linkDensity * 0.20;
  for (const [ai, bi] of connections) {
    const a = dots[ai];
    const b = dots[bi];
    if (!a || !b) continue;
    const midHue = (a.hue + b.hue) / 2;
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, hsl(a.hue, 70, 65, lineAlpha));
    grad.addColorStop(0.5, hsl(midHue, 75, 70, lineAlpha * 1.5));
    grad.addColorStop(1, hsl(b.hue, 70, 65, lineAlpha));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  // ── Orbital rings ─────────────────────────────────────────────────────────
  const rings = config.rings;
  const maxR = size * 0.5;
  const minRingR = coreRadius + maxR * 0.08;
  const maxRingR = maxR * 0.82;

  for (let ri = 0; ri < rings; ri++) {
    const ringR = minRingR + (ri / Math.max(rings - 1, 1)) * (maxRingR - minRingR);
    const yScale = 0.72 + ri * 0.04;
    const rotOffset = ri * 0.4;

    const hue = palette.primaryHues[ri % palette.primaryHues.length];
    const ringAlpha = 0.08 + (1 - ri / rings) * 0.10;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotOffset);
    ctx.scale(1, yScale);
    ctx.strokeStyle = hsl(hue, 65, 60, ringAlpha);
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ── Node dots ────────────────────────────────────────────────────────────
  for (const dot of dots) {
    const accentHue = palette.accentHues[dot.ringIndex % palette.accentHues.length];
    const dotGrad = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, dot.r * 2.5);
    dotGrad.addColorStop(0, hsl(accentHue, 90, 85, 0.9));
    dotGrad.addColorStop(0.5, hsl(accentHue, 80, 65, 0.5));
    dotGrad.addColorStop(1, hsl(accentHue, 70, 55, 0));

    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fillStyle = hsl(accentHue, 90, 85, 0.85);
    ctx.fill();

    // Small glow around each dot
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r * 2.5, 0, Math.PI * 2);
    ctx.fillStyle = dotGrad;
    ctx.fill();
  }

  // ── Central core ─────────────────────────────────────────────────────────
  // pulsePct drives a gentle scale + brightness oscillation
  const pulseScale = 1 + pulsePct * 0.06;
  const pulseAlpha = 0.85 + pulsePct * 0.15;
  const pr = coreRadius * pulseScale;
  const coreHue = palette.primaryHues[0] ?? 190;

  // Outer halo
  const haloGrad = ctx.createRadialGradient(cx, cy, pr * 0.5, cx, cy, pr * 2.2);
  haloGrad.addColorStop(0, hsl(coreHue, 80, 70, 0.25 * pulseAlpha));
  haloGrad.addColorStop(0.5, hsl(coreHue, 75, 60, 0.10 * pulseAlpha));
  haloGrad.addColorStop(1, hsl(coreHue, 70, 50, 0));
  ctx.beginPath();
  ctx.arc(cx, cy, pr * 2.2, 0, Math.PI * 2);
  ctx.fillStyle = haloGrad;
  ctx.fill();

  // Core body
  const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pr);
  coreGrad.addColorStop(0, hsl(coreHue, 70, 90, pulseAlpha));
  coreGrad.addColorStop(0.45, hsl(coreHue, 80, 65, pulseAlpha * 0.9));
  coreGrad.addColorStop(0.8, hsl(coreHue, 85, 45, pulseAlpha * 0.7));
  coreGrad.addColorStop(1, hsl(coreHue, 80, 30, pulseAlpha * 0.4));
  ctx.beginPath();
  ctx.arc(cx, cy, pr, 0, Math.PI * 2);
  ctx.fillStyle = coreGrad;
  ctx.fill();

  // Core border shimmer
  ctx.beginPath();
  ctx.arc(cx, cy, pr, 0, Math.PI * 2);
  ctx.strokeStyle = hsl(coreHue, 90, 80, 0.6 * pulseAlpha);
  ctx.lineWidth = 0.75;
  ctx.stroke();

  // Center dot
  const activityHue = palette.accentHues[0] ?? 200;
  const innerR = Math.max(1.5, pr * 0.25);
  const innerGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, innerR);
  innerGrad.addColorStop(0, hsl(activityHue, 60, 95, 1));
  innerGrad.addColorStop(1, hsl(activityHue, 80, 75, 0.5));
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = innerGrad;
  ctx.fill();

  void activityScore; // used indirectly via pulse speed in parent
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface VaultDNAProps {
  size?: number;
}

// Module-level cache so any instance sharing the same process reuses data
let dnaCache: VaultDNA | null = null;
let dnaCachePromise: Promise<VaultDNA> | null = null;

async function fetchVaultDNA(): Promise<VaultDNA> {
  if (dnaCache) return dnaCache;
  if (!dnaCachePromise) {
    dnaCachePromise = fetch("/api/vault-dna")
      .then((r) => {
        if (!r.ok) throw new Error(`vault-dna: ${r.status}`);
        return r.json() as Promise<VaultDNA>;
      })
      .then((d) => {
        dnaCache = d;
        return d;
      });
  }
  return dnaCachePromise;
}

export default function VaultDNA({ size = 120 }: VaultDNAProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dna, setDna] = useState<VaultDNA | null>(null);
  const [loading, setLoading] = useState(true);
  const rafRef = useRef<number | null>(null);
  const configRef = useRef<DrawConfig | null>(null);

  // Fetch DNA data on mount
  useEffect(() => {
    fetchVaultDNA()
      .then((d) => {
        setDna(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Build draw config when DNA or size changes
  useEffect(() => {
    if (!dna) return;
    configRef.current = buildDrawConfig(dna, size);
  }, [dna, size]);

  // Animation loop
  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    const config = configRef.current;
    if (!canvas || !config) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Pulse speed: faster for more active vaults (0.3–1.2 Hz)
    const freq = 0.3 + config.activityScore * 0.9;
    const t = performance.now() / 1000;
    // Smooth sine wave → 0..1 range
    const pulsePct = (Math.sin(t * freq * Math.PI * 2) + 1) / 2;

    drawEmblem(ctx, config, size, pulsePct);
    rafRef.current = requestAnimationFrame(animate);
  }, [size]);

  // Start/stop animation when DNA loads
  useEffect(() => {
    if (!dna) return;
    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [dna, animate]);

  // Device pixel ratio for crisp rendering
  const dpr = typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1;

  if (loading || !dna) {
    return (
      <div
        className="vault-dna vault-dna--loading"
        style={{ width: size, height: size }}
        aria-label="Loading vault fingerprint"
      />
    );
  }

  return (
    <div
      className="vault-dna"
      style={{ width: size, height: size }}
      aria-label="Vault DNA fingerprint"
    >
      <canvas
        ref={canvasRef}
        width={size * dpr}
        height={size * dpr}
        style={{
          width: size,
          height: size,
          display: "block",
          transform: `scale(${1 / dpr})`,
          transformOrigin: "top left",
        }}
      />
    </div>
  );
}
