"use client";

import { useEffect, useState } from "react";

interface MoodState {
  mood: string;
  intensity: number;
}

const MOOD_COLORS: Record<string, string> = {
  CONTEMPLATIVE: "#a78bfa", // violet
  RESTLESS: "#fb923c",      // orange
  FOCUSED: "#22d3ee",       // cyan
  DORMANT: "#475569",       // slate
  ABSORBING: "#34d399",     // emerald
};

export default function MoodIndicator() {
  const [moodState, setMoodState] = useState<MoodState | null>(null);

  useEffect(() => {
    const fetchMood = () => {
      fetch("/api/mood")
        .then((r) => r.json())
        .then((data: MoodState) => setMoodState(data))
        .catch(() => {});
    };

    fetchMood();
    const interval = setInterval(fetchMood, 120_000); // refresh every 2 min
    return () => clearInterval(interval);
  }, []);

  if (!moodState) return null;

  const color = MOOD_COLORS[moodState.mood] ?? "#475569";

  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        right: 10,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: "6px",
        padding: "3px 8px",
        borderRadius: "2px",
        background: "rgba(2, 4, 8, 0.7)",
        border: `1px solid ${color}33`,
        backdropFilter: "blur(4px)",
        pointerEvents: "none",
      }}
    >
      {/* Pulsing dot */}
      <div
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 ${4 + moodState.intensity * 6}px ${color}`,
          animation: "mood-pulse 3s ease-in-out infinite",
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.5rem",
          letterSpacing: "0.15em",
          color,
          opacity: 0.8,
        }}
      >
        {moodState.mood}
      </span>

      <style>{`
        @keyframes mood-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
