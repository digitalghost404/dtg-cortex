"use client";

import { useEffect, useRef, useState } from "react";
import { generateFragments, type MonologueStats, type DriftData } from "@/lib/monologue";
import type { CortexMood } from "@/lib/mood";

interface MonologueResponse extends MonologueStats {
  mood: CortexMood | null;
  drift: DriftData | null;
  queryHistogram: number[];
}

export default function VaultHeartbeat() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fragments, setFragments] = useState<string[]>([]);
  const [queryHistogram, setQueryHistogram] = useState<number[]>(new Array(24).fill(0));
  const [queriesLastHour, setQueriesLastHour] = useState(0);
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number | null>(null);
  const scrollOffsetRef = useRef(0);
  const lastFrameRef = useRef(0);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/monologue");
      if (!res.ok) return;
      const data: MonologueResponse = await res.json();
      const mood = data.mood ?? undefined;
      const drift = data.drift ?? undefined;
      const frags = generateFragments(data, 12, mood, drift);
      setFragments(frags);
      setQueryHistogram(data.queryHistogram ?? new Array(24).fill(0));
      setQueriesLastHour(data.queryHistogram?.[23] ?? 0);
      setVisible(true);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Canvas animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !visible) return;

    const dpr = window.devicePixelRatio || 1;
    const W = 120; // spark graph + heartbeat width
    const H = 24;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const draw = (now: number) => {
      ctx.clearRect(0, 0, W, H);

      // --- Heartbeat dot ---
      const bpm = Math.max(40, Math.min(120, queriesLastHour * 20 + 40));
      const pulseFreq = bpm / 60; // Hz
      const pulse = Math.sin(now / 1000 * Math.PI * 2 * pulseFreq) * 0.5 + 0.5;
      const dotR = 3 + pulse * 2;

      ctx.beginPath();
      ctx.arc(8, H / 2, dotR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(34, 211, 238, ${0.5 + pulse * 0.5})`;
      ctx.fill();

      // Dot glow
      ctx.beginPath();
      ctx.arc(8, H / 2, dotR + 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(34, 211, 238, ${pulse * 0.15})`;
      ctx.fill();

      // --- Spark graph (24 bars) ---
      const sparkX = 22;
      const sparkW = W - sparkX - 4;
      const barW = sparkW / 24;
      const maxCount = Math.max(1, ...queryHistogram);

      for (let i = 0; i < 24; i++) {
        const barH = Math.max(1, (queryHistogram[i] / maxCount) * (H - 6));
        const x = sparkX + i * barW;
        const y = H - 3 - barH;

        ctx.fillStyle = i === 23
          ? `rgba(34, 211, 238, 0.6)` // current hour highlighted
          : `rgba(34, 211, 238, 0.25)`;
        ctx.fillRect(x, y, Math.max(1, barW - 1), barH);
      }

      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, [visible, queryHistogram, queriesLastHour]);

  // Scroll animation for text
  useEffect(() => {
    if (!visible || fragments.length === 0) return;

    const frame = (now: number) => {
      const dt = lastFrameRef.current ? now - lastFrameRef.current : 16;
      lastFrameRef.current = now;
      scrollOffsetRef.current += dt * 0.03; // pixels per ms
      const textEl = document.getElementById("vault-heartbeat-text");
      if (textEl) {
        const totalWidth = textEl.scrollWidth / 2;
        if (scrollOffsetRef.current > totalWidth) {
          scrollOffsetRef.current -= totalWidth;
        }
        textEl.style.transform = `translateX(-${scrollOffsetRef.current}px)`;
      }
      animRef.current = requestAnimationFrame(frame);
    };

    animRef.current = requestAnimationFrame(frame);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
      lastFrameRef.current = 0;
    };
  }, [visible, fragments]);

  if (!visible || fragments.length === 0) return null;

  const tickerText = [...fragments, ...fragments]
    .map((f) => `... ${f} `)
    .join("");

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 40,
        height: 28,
        background: "rgba(2, 4, 8, 0.85)",
        borderTop: "1px solid rgba(34, 211, 238, 0.08)",
        display: "flex",
        alignItems: "center",
        gap: 0,
        overflow: "hidden",
        backdropFilter: "blur(4px)",
      }}
      aria-hidden="true"
    >
      {/* Canvas: heartbeat dot + spark graph */}
      <canvas
        ref={canvasRef}
        style={{ flexShrink: 0, marginLeft: 4 }}
      />

      {/* Divider */}
      <div
        style={{
          width: 1,
          height: 16,
          background: "rgba(34, 211, 238, 0.12)",
          flexShrink: 0,
          margin: "0 6px",
        }}
      />

      {/* Scrolling monologue text */}
      <div
        style={{
          flex: 1,
          overflow: "hidden",
          whiteSpace: "nowrap",
          position: "relative",
        }}
      >
        <span
          id="vault-heartbeat-text"
          style={{
            display: "inline-block",
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.5rem",
            letterSpacing: "0.08em",
            color: "rgba(34, 211, 238, 0.45)",
            willChange: "transform",
          }}
        >
          {tickerText}
        </span>
      </div>
    </div>
  );
}
