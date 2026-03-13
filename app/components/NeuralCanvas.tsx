"use client";

import { useEffect, useRef, useCallback } from "react";
import type { NeuronNode, NeuralEdge } from "../hooks/useNeuralGraph";
import type { AnimState } from "../hooks/useNeuralAnimation";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BG_VOID = "#020408";
const BREATHING_CYCLE = 7000;

function nodeRadius(connections: number): number {
  return Math.min(18, 4 + Math.log2(connections + 1) * 3);
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PhantomThread {
  sourceNotePath: string;
  sourceNoteName: string;
  targetNotePath: string;
  targetNoteName: string;
  similarity: number;
}

interface NeuralCanvasProps {
  neurons: NeuronNode[];
  edges: NeuralEdge[];
  phantomEdges?: NeuralEdge[];
  scarNeurons?: (NeuronNode & { isScar: true })[];
  animStateRef: React.RefObject<AnimState | null>;
  tick: (now: number) => void;
  onHover: (neuron: NeuronNode | null, x: number, y: number) => void;
  onClick: (neuron: NeuronNode | null) => void;
  onPhantomClick?: (thread: PhantomThread) => void;
  phantomThreads?: PhantomThread[];
  isDreaming?: boolean;
  dreamDrift?: { driftX: number; driftY: number; driftZoom: number };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NeuralCanvas({
  neurons,
  edges,
  phantomEdges,
  scarNeurons,
  animStateRef,
  tick,
  onHover,
  onClick,
  onPhantomClick,
  phantomThreads,
  isDreaming,
  dreamDrift,
}: NeuralCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const dragRef = useRef({ isDragging: false, startX: 0, startY: 0 });
  const hoveredRef = useRef<NeuronNode | null>(null);
  const lastTouchRef = useRef({ x: 0, y: 0, dist: 0 });

  // Pre-rendered glow sprite (offscreen canvas)
  const glowSpriteRef = useRef<HTMLCanvasElement | null>(null);

  // Refs to latest props for render loop
  const neuronsRef = useRef(neurons);
  const edgesRef = useRef(edges);
  neuronsRef.current = neurons;
  edgesRef.current = edges;

  // Build glow sprite once
  useEffect(() => {
    const size = 64;
    const off = document.createElement("canvas");
    off.width = size;
    off.height = size;
    const ctx = off.getContext("2d")!;
    const cx = size / 2;
    const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    grad.addColorStop(0, "rgba(255,255,255,0.4)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.1)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    glowSpriteRef.current = off;
  }, []);

  // Map normalized coords to world space
  const toWorld = useCallback(
    (nx: number, ny: number, W: number, H: number) => {
      const padding = 80;
      return {
        cx: padding + ((nx + 1) / 2) * (W - padding * 2),
        cy: padding + ((ny + 1) / 2) * (H - padding * 2),
      };
    },
    []
  );

  // Hit test
  const hitTest = useCallback(
    (canvasX: number, canvasY: number): NeuronNode | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      const { x: tx, y: ty, scale } = transformRef.current;
      const wx = (canvasX - tx) / scale;
      const wy = (canvasY - ty) / scale;
      const ns = neuronsRef.current;

      let closest: NeuronNode | null = null;
      let closestDist = Infinity;

      for (const n of ns) {
        const { cx, cy } = toWorld(n.x, n.y, W, H);
        const dx = cx - wx;
        const dy = cy - wy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const r = nodeRadius(n.connections) + 5;
        if (dist < r && dist < closestDist) {
          closest = n;
          closestDist = dist;
        }
      }
      return closest;
    },
    [toWorld]
  );

  // ── Render loop ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (neurons.length === 0) return;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const now = performance.now();
      tick(now);

      const dpr = window.devicePixelRatio || 1;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      const { x: tx, y: ty, scale } = transformRef.current;
      const ns = neuronsRef.current;
      const es = edgesRef.current;
      const anim = animStateRef.current;
      const hovered = hoveredRef.current;

      // 1. Clear + background
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
      ctx.fillStyle = BG_VOID;
      ctx.fillRect(0, 0, W, H);

      if (ns.length === 0) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      // 2. Pan/zoom (with dream drift offset)
      const driftX = isDreaming && dreamDrift ? dreamDrift.driftX : 0;
      const driftY = isDreaming && dreamDrift ? dreamDrift.driftY : 0;
      const driftZoom = isDreaming && dreamDrift ? dreamDrift.driftZoom : 1;
      ctx.save();
      ctx.translate(tx + driftX, ty + driftY);
      ctx.scale(scale * driftZoom, scale * driftZoom);

      // Pre-compute world positions
      const wx = new Float32Array(ns.length);
      const wy = new Float32Array(ns.length);
      for (let i = 0; i < ns.length; i++) {
        const { cx, cy } = toWorld(ns[i].x, ns[i].y, W, H);
        wx[i] = cx;
        wy[i] = cy;
      }

      // Viewport bounds for culling (in world space)
      const vLeft = -tx / scale - 50;
      const vRight = (W - tx) / scale + 50;
      const vTop = -ty / scale - 50;
      const vBottom = (H - ty) / scale + 50;

      // 3. Cluster halos with breathing
      const clusterCentroids = new Map<
        number,
        { sx: number; sy: number; count: number; maxDist: number; color: string }
      >();
      for (let i = 0; i < ns.length; i++) {
        const cid = ns[i].cluster;
        if (!clusterCentroids.has(cid)) {
          clusterCentroids.set(cid, { sx: 0, sy: 0, count: 0, maxDist: 0, color: ns[i].color });
        }
        const c = clusterCentroids.get(cid)!;
        c.sx += wx[i];
        c.sy += wy[i];
        c.count++;
      }

      for (const [cid, cen] of clusterCentroids.entries()) {
        const ccx = cen.sx / cen.count;
        const ccy = cen.sy / cen.count;
        let maxD = 0;
        for (let i = 0; i < ns.length; i++) {
          if (ns[i].cluster !== cid) continue;
          const dx = wx[i] - ccx;
          const dy = wy[i] - ccy;
          maxD = Math.max(maxD, Math.sqrt(dx * dx + dy * dy));
        }
        const haloR = maxD + 50;
        const breathingAlpha = 0.03 + 0.015 * Math.sin((now / BREATHING_CYCLE) * Math.PI * 2);
        const { colorR: r, colorG: g, colorB: b } = ns.find((n) => n.cluster === cid)!;
        const grad = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, haloR);
        grad.addColorStop(0, `rgba(${r},${g},${b},${breathingAlpha})`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(ccx, ccy, haloR, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // 4. Connections
      for (const edge of es) {
        const sx = wx[edge.source];
        const sy = wy[edge.source];
        const ex = wx[edge.target];
        const ey = wy[edge.target];

        // Cull if both endpoints outside viewport
        if (
          (sx < vLeft && ex < vLeft) ||
          (sx > vRight && ex > vRight) ||
          (sy < vTop && ey < vTop) ||
          (sy > vBottom && ey > vBottom)
        ) continue;

        const srcAct = anim ? anim.activations[edge.source] : 0;
        const tgtAct = anim ? anim.activations[edge.target] : 0;
        const maxAct = Math.max(srcAct, tgtAct);
        const synW = edge.synapticWeight ?? 0;
        const alpha = (0.04 + maxAct * 0.4) * (0.6 + synW * 0.4);
        const baseWidth = (0.5 + synW * 0.5);

        const srcN = ns[edge.source];
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = `rgba(${srcN.colorR},${srcN.colorG},${srcN.colorB},${alpha})`;
        ctx.lineWidth = baseWidth + maxAct * 1.5;
        ctx.stroke();

        // High-weight synaptic edges get a subtle glow
        if (synW > 0.6) {
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(ex, ey);
          ctx.strokeStyle = `rgba(${srcN.colorR},${srcN.colorG},${srcN.colorB},${synW * 0.08})`;
          ctx.lineWidth = baseWidth + maxAct * 1.5 + 3;
          ctx.stroke();
        }
      }

      // 4b. Phantom thread edges (flickering dashed)
      const phantomEs = phantomEdges ?? [];
      for (let pIdx = 0; pIdx < phantomEs.length; pIdx++) {
        const edge = phantomEs[pIdx];
        const sx = wx[edge.source];
        const sy = wy[edge.source];
        const ex = wx[edge.target];
        const ey = wy[edge.target];

        if (
          (sx < vLeft && ex < vLeft) ||
          (sx > vRight && ex > vRight) ||
          (sy < vTop && ey < vTop) ||
          (sy > vBottom && ey > vBottom)
        ) continue;

        const flicker = 0.08 * (0.5 + 0.5 * Math.sin(now / 400 + pIdx));
        ctx.beginPath();
        ctx.setLineDash([4, 6]);
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
        ctx.strokeStyle = `rgba(34,211,238,${flicker})`;
        ctx.lineWidth = 0.8;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 4c. Scar neurons (dim flickering afterimages)
      const scarNs = scarNeurons ?? [];
      for (let si = 0; si < scarNs.length; si++) {
        const scar = scarNs[si];
        const { cx, cy } = toWorld(scar.x, scar.y, W, H);

        if (cx < vLeft || cx > vRight || cy < vTop || cy > vBottom) continue;

        const scarFlicker = 0.15 * (0.5 + 0.5 * Math.sin(now / 300 + si * 7.3));
        const scarR = 5;

        // Dim glow
        const scarGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, scarR + 4);
        scarGrad.addColorStop(0, `rgba(74,85,104,${scarFlicker})`);
        scarGrad.addColorStop(1, `rgba(74,85,104,0)`);
        ctx.beginPath();
        ctx.arc(cx, cy, scarR + 4, 0, Math.PI * 2);
        ctx.fillStyle = scarGrad;
        ctx.fill();

        // Body
        ctx.beginPath();
        ctx.arc(cx, cy, scarR, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(74,85,104,${scarFlicker * 0.8})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(74,85,104,${scarFlicker * 0.5})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // 5. Pulse particles
      if (anim) {
        for (const p of anim.particles) {
          if (!p.active) continue;
          const edge = es[p.edgeIdx];
          if (!edge) continue;
          const px = wx[edge.source] + (wx[edge.target] - wx[edge.source]) * p.progress;
          const py = wy[edge.source] + (wy[edge.target] - wy[edge.source]) * p.progress;

          // Glow
          const glowR = 10;
          const grad = ctx.createRadialGradient(px, py, 0, px, py, glowR);
          const srcN = ns[edge.source];
          grad.addColorStop(0, `rgba(${srcN.colorR},${srcN.colorG},${srcN.colorB},${p.brightness * 0.8})`);
          grad.addColorStop(0.5, `rgba(${srcN.colorR},${srcN.colorG},${srcN.colorB},${p.brightness * 0.3})`);
          grad.addColorStop(1, `rgba(${srcN.colorR},${srcN.colorG},${srcN.colorB},0)`);
          ctx.beginPath();
          ctx.arc(px, py, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();

          // Bright core
          ctx.beginPath();
          ctx.arc(px, py, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${p.brightness * 0.9})`;
          ctx.fill();
        }
      }

      // 6 & 7. Neurons (glow + body)
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        const cx = wx[i];
        const cy = wy[i];

        // Viewport cull
        if (cx < vLeft || cx > vRight || cy < vTop || cy > vBottom) continue;

        const activation = anim ? anim.activations[i] : 0;
        const breathingOffset = anim ? anim.breathingOffsets[i] : 0;
        const breathPhase = ((now + breathingOffset) % BREATHING_CYCLE) / BREATHING_CYCLE;
        const breathPulse = Math.sin(breathPhase * Math.PI * 2) * 0.5 + 0.5; // 0-1

        const decay = n.decayScore ?? 0;
        const decayAlphaScale = 0.3 + 0.7 * (1 - decay);
        const decayRadiusScale = 0.6 + 0.4 * (1 - decay);

        const baseR = nodeRadius(n.connections) * decayRadiusScale;
        const r = baseR + activation * 4 + breathPulse * 0.8;
        const isHov = hovered?.id === n.id;

        // 6. Neuron glow (large soft gradient behind activated neurons)
        if (activation > 0.05) {
          const glowRadius = r * 3;
          const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
          glowGrad.addColorStop(0, `rgba(${n.colorR},${n.colorG},${n.colorB},${activation * 0.5})`);
          glowGrad.addColorStop(0.5, `rgba(${n.colorR},${n.colorG},${n.colorB},${activation * 0.15})`);
          glowGrad.addColorStop(1, `rgba(${n.colorR},${n.colorG},${n.colorB},0)`);
          ctx.beginPath();
          ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
          ctx.fillStyle = glowGrad;
          ctx.fill();
        }

        // Ambient glow (idle, using glow sprite for perf when not activated)
        if (activation < 0.05 && glowSpriteRef.current) {
          const spriteSize = (r + 6) * 2;
          ctx.globalAlpha = 0.2 + breathPulse * 0.1;
          ctx.drawImage(glowSpriteRef.current, cx - spriteSize / 2, cy - spriteSize / 2, spriteSize, spriteSize);
          ctx.globalAlpha = 1;
        } else if (activation < 0.05) {
          const ambGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r + 6);
          ambGrad.addColorStop(0, `rgba(${n.colorR},${n.colorG},${n.colorB},0.25)`);
          ambGrad.addColorStop(1, `rgba(0,0,0,0)`);
          ctx.beginPath();
          ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
          ctx.fillStyle = ambGrad;
          ctx.fill();
        }

        // 7. Neuron body (with decay desaturation)
        const lerpColor = (base: number, target: number, t: number) =>
          Math.round(base + (target - base) * t);
        // Desaturate toward gray based on decay
        const gray = Math.round((n.colorR + n.colorG + n.colorB) / 3);
        const desatFactor = decay * 0.5;
        const desatR = lerpColor(n.colorR, gray, desatFactor);
        const desatG = lerpColor(n.colorG, gray, desatFactor);
        const desatB = lerpColor(n.colorB, gray, desatFactor);
        const actR = lerpColor(desatR, 255, activation * 0.6);
        const actG = lerpColor(desatG, 255, activation * 0.6);
        const actB = lerpColor(desatB, 255, activation * 0.6);

        const fillGrad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
        if (isHov) {
          fillGrad.addColorStop(0, "#ffffff");
          fillGrad.addColorStop(1, n.color);
        } else {
          fillGrad.addColorStop(0, `rgba(${actR},${actG},${actB},${0.9 * decayAlphaScale})`);
          fillGrad.addColorStop(
            1,
            `rgba(${Math.round(actR * 0.4)},${Math.round(actG * 0.4)},${Math.round(actB * 0.4)},${0.8 * decayAlphaScale})`
          );
        }
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = fillGrad;
        ctx.fill();

        // Stroke
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = isHov
          ? "#ffffff"
          : `rgba(${n.colorR},${n.colorG},${n.colorB},${0.6 + activation * 0.4})`;
        ctx.lineWidth = isHov ? 2 : 1;
        ctx.stroke();
      }

      // 8. Ripple effects
      if (anim) {
        for (const ripple of anim.ripples) {
          const n = ns[ripple.neuronIdx];
          if (!n) continue;
          const cx = wx[ripple.neuronIdx];
          const cy = wy[ripple.neuronIdx];
          const elapsed = now - ripple.startTime;
          const t = elapsed / ripple.duration; // 0-1
          const rippleR = nodeRadius(n.connections) + t * 25;
          const alpha = (1 - t) * 0.6;
          ctx.beginPath();
          ctx.arc(cx, cy, rippleR, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${n.colorR},${n.colorG},${n.colorB},${alpha})`;
          ctx.lineWidth = 1.5 * (1 - t);
          ctx.stroke();
        }
      }

      // 9. Labels — hovered + activated + high zoom
      ctx.font = `${Math.max(9, 10 / scale)}px "Geist Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        const activation = anim ? anim.activations[i] : 0;
        const isHov = hovered?.id === n.id;
        const showLabel = isHov || activation > 0.3 || scale > 1.5;
        if (!showLabel) continue;

        const cx = wx[i];
        const cy = wy[i];
        if (cx < vLeft || cx > vRight || cy < vTop || cy > vBottom) continue;

        const r = nodeRadius(n.connections) + (activation > 0 ? activation * 4 : 0);
        const labelAlpha = isHov ? 1 : activation > 0.3 ? Math.min(activation, 0.9) : 0.7;
        ctx.fillStyle = isHov
          ? "#ffffff"
          : `rgba(${n.colorR},${n.colorG},${n.colorB},${labelAlpha})`;
        ctx.fillText(n.name, cx, cy + r + 4 / scale);
      }

      // 9b. Scar labels (on hover / high zoom)
      for (let si = 0; si < scarNs.length; si++) {
        const scar = scarNs[si];
        const { cx, cy } = toWorld(scar.x, scar.y, W, H);
        if (cx < vLeft || cx > vRight || cy < vTop || cy > vBottom) continue;
        if (scale <= 1.5) continue;
        ctx.fillStyle = `rgba(74,85,104,0.5)`;
        ctx.fillText(`DELETED: ${scar.name}`, cx, cy + 12 / scale);
      }

      ctx.restore();

      // Dream overlay: purple-shift hue + vignette pulse
      if (isDreaming) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "screen";
        ctx.fillStyle = "rgba(80, 30, 120, 0.03)";
        ctx.fillRect(0, 0, canvas.width / (window.devicePixelRatio || 1), canvas.height / (window.devicePixelRatio || 1));
        ctx.globalCompositeOperation = "source-over";

        // Slow vignette pulse
        const vignetteAlpha = 0.05 + 0.03 * Math.sin(now / 4000);
        const vigW = canvas.width / (window.devicePixelRatio || 1);
        const vigH = canvas.height / (window.devicePixelRatio || 1);
        const vigGrad = ctx.createRadialGradient(vigW / 2, vigH / 2, vigW * 0.25, vigW / 2, vigH / 2, vigW * 0.6);
        vigGrad.addColorStop(0, "rgba(0,0,0,0)");
        vigGrad.addColorStop(1, `rgba(20, 0, 40, ${vignetteAlpha})`);
        ctx.fillStyle = vigGrad;
        ctx.fillRect(0, 0, vigW, vigH);
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [neurons.length, toWorld, tick, animStateRef, phantomEdges, scarNeurons, isDreaming, dreamDrift]);

  // ── Resize ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Mouse events ──────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const drag = dragRef.current;

      if (drag.isDragging) {
        transformRef.current.x += cx - drag.startX;
        transformRef.current.y += cy - drag.startY;
        drag.startX = cx;
        drag.startY = cy;
        return;
      }

      const hit = hitTest(cx, cy);
      if (hit !== hoveredRef.current) {
        hoveredRef.current = hit;
        (e.target as HTMLCanvasElement).style.cursor = hit ? "pointer" : "grab";
        onHover(hit, e.clientX, e.clientY);
      } else if (hit) {
        onHover(hit, e.clientX, e.clientY);
      }
    },
    [hitTest, onHover]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const hit = hitTest(cx, cy);
      dragRef.current = { isDragging: !hit, startX: cx, startY: cy };
      if (!hit) (e.target as HTMLCanvasElement).style.cursor = "grabbing";
    },
    [hitTest]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag.isDragging) {
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        onClick(hitTest(cx, cy));
      }
      dragRef.current = { isDragging: false, startX: 0, startY: 0 };
      (e.target as HTMLCanvasElement).style.cursor = hoveredRef.current ? "pointer" : "grab";
    },
    [hitTest, onClick]
  );

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = null;
    onHover(null, 0, 0);
    dragRef.current = { isDragging: false, startX: 0, startY: 0 };
  }, [onHover]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const { x: tx, y: ty, scale: s } = transformRef.current;
    const newScale = Math.max(0.1, Math.min(10, s * factor));
    transformRef.current = {
      x: cx - (cx - tx) * (newScale / s),
      y: cy - (cy - ty) * (newScale / s),
      scale: newScale,
    };
  }, []);

  // ── Touch events ──────────────────────────────────────────────────────
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const cx = touch.clientX - rect.left;
        const cy = touch.clientY - rect.top;
        const hit = hitTest(cx, cy);
        lastTouchRef.current = { x: touch.clientX, y: touch.clientY, dist: 0 };
        dragRef.current = { isDragging: !hit, startX: touch.clientX, startY: touch.clientY };
        if (hit) hoveredRef.current = hit;
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        lastTouchRef.current = { x: 0, y: 0, dist: Math.sqrt(dx * dx + dy * dy) };
        dragRef.current = { isDragging: false, startX: 0, startY: 0 };
      }
    },
    [hitTest]
  );

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const drag = dragRef.current;
      if (drag.isDragging) {
        transformRef.current.x += touch.clientX - drag.startX;
        transformRef.current.y += touch.clientY - drag.startY;
        drag.startX = touch.clientX;
        drag.startY = touch.clientY;
      }
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const factor = dist / (lastTouchRef.current.dist || dist);
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = midX - rect.left;
      const cy = midY - rect.top;
      const { x: tx, y: ty, scale: s } = transformRef.current;
      const newScale = Math.max(0.1, Math.min(10, s * factor));
      transformRef.current = {
        x: cx - (cx - tx) * (newScale / s),
        y: cy - (cy - ty) * (newScale / s),
        scale: newScale,
      };
      lastTouchRef.current.dist = dist;
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      const changedTouch = e.changedTouches[0];
      if (!drag.isDragging && changedTouch) {
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const cx = changedTouch.clientX - rect.left;
        const cy = changedTouch.clientY - rect.top;
        onClick(hitTest(cx, cy));
      } else if (drag.isDragging && changedTouch) {
        const totalDx = changedTouch.clientX - lastTouchRef.current.x;
        const totalDy = changedTouch.clientY - lastTouchRef.current.y;
        if (Math.sqrt(totalDx * totalDx + totalDy * totalDy) < 8) {
          onClick(null);
        }
      }
      hoveredRef.current = null;
      dragRef.current = { isDragging: false, startX: 0, startY: 0 };
    },
    [hitTest, onClick]
  );

  // Register touchmove with passive: false
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => canvas.removeEventListener("touchmove", handleTouchMove);
  }, [handleTouchMove]);

  return (
    <div
      ref={containerRef}
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: "block", cursor: "grab", touchAction: "none" }}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        aria-label="Neural pulse visualization"
        role="img"
      />
      {/* Scanline overlay */}
      <div className="neural-scanline-overlay" />
    </div>
  );
}
