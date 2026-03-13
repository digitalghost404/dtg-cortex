"use client";

import { useEffect, useState, useRef } from "react";
import { generateFragments, type MonologueStats } from "@/lib/monologue";
import type { CortexMood } from "@/lib/mood";

export default function MonologueTicker() {
  const [fragments, setFragments] = useState<string[]>([]);
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAndGenerate = async () => {
    try {
      const [statsRes, moodRes] = await Promise.all([
        fetch("/api/monologue"),
        fetch("/api/mood"),
      ]);
      if (!statsRes.ok) return;
      const stats: MonologueStats = await statsRes.json();
      let mood: CortexMood | undefined;
      if (moodRes.ok) {
        const moodData = await moodRes.json();
        mood = moodData.mood;
      }
      const frags = generateFragments(stats, 12, mood);
      setFragments(frags);
      setVisible(true);
    } catch {
      // silently fail
    }
  };

  useEffect(() => {
    fetchAndGenerate();
    intervalRef.current = setInterval(fetchAndGenerate, 60_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!visible || fragments.length === 0) return null;

  // Double the fragments for seamless loop
  const tickerText = [...fragments, ...fragments]
    .map((f) => `... ${f} `)
    .join("");

  return (
    <div className="monologue-ticker" aria-hidden="true">
      <div className="monologue-ticker__track">
        <span className="monologue-ticker__text">{tickerText}</span>
      </div>
    </div>
  );
}
