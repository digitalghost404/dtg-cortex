"use client";

import { useEffect, useState } from "react";

interface MoodTransitionToastProps {
  from: string;
  to: string;
  reason: string;
}

const MOOD_COLORS: Record<string, string> = {
  CONTEMPLATIVE: "#a78bfa",
  RESTLESS: "#fb923c",
  FOCUSED: "#22d3ee",
  DORMANT: "#475569",
  ABSORBING: "#34d399",
};

export default function MoodTransitionToast({ from, to, reason }: MoodTransitionToastProps) {
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 4200);
    const hideTimer = setTimeout(() => setVisible(false), 5000);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  const toColor = MOOD_COLORS[to] ?? "#475569";

  return (
    <div
      style={{
        position: "fixed",
        top: 36,
        right: 10,
        zIndex: 5,
        padding: "6px 12px",
        borderRadius: "2px",
        background: "rgba(2, 4, 8, 0.85)",
        border: `1px solid ${toColor}33`,
        backdropFilter: "blur(6px)",
        fontFamily: "var(--font-geist-mono, monospace)",
        fontSize: "0.5rem",
        letterSpacing: "0.1em",
        color: toColor,
        opacity: fading ? 0 : 1,
        transition: "opacity 800ms ease-out",
        pointerEvents: "none",
      }}
    >
      <span style={{ opacity: 0.5 }}>mood shift: </span>
      <span style={{ color: MOOD_COLORS[from] ?? "#475569" }}>{from}</span>
      <span style={{ opacity: 0.4 }}> → </span>
      <span>{to}</span>
      <span style={{ opacity: 0.4 }}> ({reason})</span>
    </div>
  );
}
