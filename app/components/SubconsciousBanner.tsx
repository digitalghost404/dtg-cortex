"use client";

import { useEffect, useState, useRef } from "react";

interface SubconsciousData {
  active: boolean;
  modifiedNotes?: number;
  newLinks?: number;
  deletedEstimate?: number;
  whisper?: string;
}

export default function SubconsciousBanner() {
  const [data, setData] = useState<SubconsciousData | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [fading, setFading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/subconscious")
      .then((r) => r.json())
      .then((d: SubconsciousData) => {
        if (d.active) {
          setData(d);
          // Auto-dismiss after 15s
          timerRef.current = setTimeout(() => dismiss(), 15_000);
        }
      })
      .catch(() => {});

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const dismiss = () => {
    setFading(true);
    setTimeout(() => {
      setDismissed(true);
      // Update lastVisit
      fetch("/api/subconscious", { method: "POST" }).catch(() => {});
    }, 400);
  };

  if (!data || !data.active || dismissed) return null;

  return (
    <div
      className={`subconscious-banner${fading ? " subconscious-banner--fading" : ""}`}
      onClick={dismiss}
      role="status"
      aria-live="polite"
      style={{ cursor: "pointer" }}
    >
      <span className="subconscious-banner__label">WHILE YOU WERE AWAY:</span>
      <span className="subconscious-banner__whisper">{data.whisper}</span>
      <span className="subconscious-banner__dismiss" aria-label="Dismiss">&times;</span>
    </div>
  );
}
