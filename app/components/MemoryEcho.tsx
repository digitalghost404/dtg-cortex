"use client";

import { useEffect, useState } from "react";

interface MemoryEchoProps {
  previousQuery: string;
  daysAgo: number;
  similarity: number;
  onDismiss: () => void;
}

export default function MemoryEcho({
  previousQuery,
  daysAgo,
  onDismiss,
}: MemoryEchoProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Fade in
    requestAnimationFrame(() => setVisible(true));

    // Auto-dismiss after 10s
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 400); // wait for fade-out
    }, 10_000);

    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div
      style={{
        padding: "6px 12px",
        background: "rgba(167, 139, 250, 0.08)",
        border: "1px solid rgba(167, 139, 250, 0.2)",
        borderRadius: "2px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-4px)",
        transition: "opacity 0.4s ease, transform 0.4s ease",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.6rem",
          letterSpacing: "0.06em",
          color: "#a78bfa",
        }}
      >
        You explored this before ({daysAgo === 0 ? "today" : `${daysAgo}d ago`}
        ): &ldquo;{previousQuery.length > 60 ? previousQuery.slice(0, 57) + "..." : previousQuery}&rdquo;
      </span>
      <button
        onClick={() => {
          setVisible(false);
          setTimeout(onDismiss, 400);
        }}
        style={{
          background: "none",
          border: "none",
          color: "#a78bfa",
          cursor: "pointer",
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.7rem",
          opacity: 0.6,
          flexShrink: 0,
          padding: "0 2px",
        }}
        aria-label="Dismiss echo"
      >
        &times;
      </button>
    </div>
  );
}
