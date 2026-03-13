"use client";

import { useEffect, useState } from "react";
import MoodTransitionToast from "./MoodTransitionToast";

interface MoodTransition {
  transitioned: boolean;
  from: string;
  to: string;
  reason: string;
}

interface MoodResponse {
  mood: string;
  intensity: number;
  transition: MoodTransition | null;
}

const MOOD_COLORS: Record<string, string> = {
  CONTEMPLATIVE: "#a78bfa", // violet
  RESTLESS: "#fb923c",      // orange
  FOCUSED: "#22d3ee",       // cyan
  DORMANT: "#475569",       // slate
  ABSORBING: "#34d399",     // emerald
};

export default function MoodIndicator() {
  const [moodState, setMoodState] = useState<MoodResponse | null>(null);
  const [transition, setTransition] = useState<MoodTransition | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const fetchMood = () => {
      fetch("/api/mood")
        .then((r) => r.json())
        .then((data: MoodResponse) => {
          setMoodState(data);
          if (data.transition?.transitioned) {
            setTransition(data.transition);
            setFlash(true);
            setTimeout(() => setFlash(false), 600);
            // Clear toast after it auto-dismisses
            setTimeout(() => setTransition(null), 5500);
          }
        })
        .catch(() => {});
    };

    fetchMood();
    const interval = setInterval(fetchMood, 120_000);
    return () => clearInterval(interval);
  }, []);

  if (!moodState) return null;

  const color = MOOD_COLORS[moodState.mood] ?? "#475569";

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 10,
          right: 10,
          zIndex: 5,
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
            animation: flash
              ? "mood-flash 0.6s ease-out"
              : "mood-pulse 3s ease-in-out infinite",
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
          @keyframes mood-flash {
            0% { box-shadow: 0 0 0px ${color}; transform: scale(1); }
            50% { box-shadow: 0 0 14px ${color}; transform: scale(1.8); }
            100% { box-shadow: 0 0 ${4 + moodState.intensity * 6}px ${color}; transform: scale(1); }
          }
        `}</style>
      </div>

      {transition && (
        <MoodTransitionToast
          from={transition.from}
          to={transition.to}
          reason={transition.reason}
        />
      )}
    </>
  );
}
