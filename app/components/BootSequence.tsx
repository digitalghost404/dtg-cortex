"use client";

import { useEffect, useState, useRef } from "react";
import VaultDNA from "./VaultDNA";

interface BootLine {
  text: string;
  delay: number;     // ms before this line appears
  status?: "ok" | "loading" | "done";
}

const BOOT_LINES: BootLine[] = [
  { text: "CORTEX NEURAL INTERFACE v2.0", delay: 0 },
  { text: "", delay: 200 },
  { text: "AUTHENTICATING .......... OK", delay: 300, status: "ok" },
  { text: "LOADING VAULT INDEX ..... OK", delay: 500, status: "ok" },
  { text: "INITIALIZING RAG ENGINE . OK", delay: 700, status: "ok" },
  { text: "CONNECTING VECTOR STORE . OK", delay: 900, status: "ok" },
  { text: "SYNCING MEMORY CONTEXT .. OK", delay: 1100, status: "ok" },
  { text: "MOUNTING KNOWLEDGE GRAPH  OK", delay: 1300, status: "ok" },
  { text: "", delay: 1500 },
  { text: "ALL SYSTEMS NOMINAL", delay: 1600, status: "done" },
  { text: "WELCOME BACK, OPERATOR.", delay: 1900, status: "done" },
];

const TOTAL_DURATION = 2800; // ms before fade-out starts
const FADE_DURATION = 600;  // ms for the fade-out

export default function BootSequence({ onComplete }: { onComplete: () => void }) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [fadeOut, setFadeOut] = useState(false);
  const completedRef = useRef(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    // Reveal lines one by one
    for (let i = 0; i < BOOT_LINES.length; i++) {
      timers.push(
        setTimeout(() => {
          setVisibleLines(i + 1);
        }, BOOT_LINES[i].delay)
      );
    }

    // Start fade-out
    timers.push(
      setTimeout(() => {
        setFadeOut(true);
      }, TOTAL_DURATION)
    );

    // Complete
    timers.push(
      setTimeout(() => {
        if (!completedRef.current) {
          completedRef.current = true;
          onComplete();
        }
      }, TOTAL_DURATION + FADE_DURATION)
    );

    return () => timers.forEach(clearTimeout);
  }, [onComplete]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "var(--bg-void, #020408)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity: fadeOut ? 0 : 1,
        transition: `opacity ${FADE_DURATION}ms ease-out`,
        pointerEvents: fadeOut ? "none" : "auto",
      }}
    >
      {/* Logo */}
      <div
        style={{
          marginBottom: "2rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <VaultDNA size={48} />
          {/* Glow ring */}
          <div
            style={{
              position: "absolute",
              width: 72,
              height: 72,
              borderRadius: "50%",
              border: "1px solid rgba(34,211,238,0.2)",
              boxShadow: "0 0 20px rgba(34,211,238,0.15), inset 0 0 20px rgba(34,211,238,0.05)",
              animation: "boot-pulse 1.5s ease-in-out infinite",
            }}
          />
        </div>
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "1rem",
            fontWeight: 700,
            letterSpacing: "0.35em",
            color: "var(--cyan-bright, #22d3ee)",
            textShadow: "0 0 12px rgba(34,211,238,0.4), 0 0 40px rgba(34,211,238,0.15)",
          }}
        >
          CORTEX
        </span>
      </div>

      {/* Terminal lines */}
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          padding: "0 1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {BOOT_LINES.slice(0, visibleLines).map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.65rem",
              letterSpacing: "0.08em",
              lineHeight: 1.8,
              color: line.status === "done"
                ? "var(--cyan-bright, #22d3ee)"
                : line.status === "ok"
                ? "var(--text-secondary, #94a3b8)"
                : "var(--text-faint, #475569)",
              textShadow: line.status === "done"
                ? "0 0 8px rgba(34,211,238,0.3)"
                : "none",
              opacity: 0,
              animation: "boot-line-in 0.2s ease forwards",
              minHeight: line.text === "" ? "0.5rem" : undefined,
            }}
          >
            {line.text && (
              <>
                <span style={{ color: "var(--cyan-mid, #67e8f9)", opacity: 0.5, marginRight: "0.5rem" }}>
                  {">"}
                </span>
                {line.status === "ok" ? (
                  <>
                    {line.text.replace(/ OK$/, "")}
                    <span style={{ color: "#4ade80" }}> OK</span>
                  </>
                ) : (
                  line.text
                )}
              </>
            )}
          </div>
        ))}

        {/* Blinking cursor on last line */}
        {visibleLines > 0 && visibleLines < BOOT_LINES.length && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.65rem",
              color: "var(--cyan-bright, #22d3ee)",
              animation: "blink-cursor 0.7s step-end infinite",
              marginTop: "2px",
            }}
          >
            <span style={{ color: "var(--cyan-mid, #67e8f9)", opacity: 0.5, marginRight: "0.5rem" }}>
              {">"}
            </span>
            _
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          padding: "0 1.5rem",
          marginTop: "1.5rem",
        }}
      >
        <div
          style={{
            width: "100%",
            height: 2,
            background: "var(--border-dim, #1e293b)",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              background: "linear-gradient(90deg, var(--cyan-bright, #22d3ee), var(--cyan-mid, #67e8f9))",
              boxShadow: "0 0 8px rgba(34,211,238,0.4)",
              width: `${Math.min(100, (visibleLines / BOOT_LINES.length) * 100)}%`,
              transition: "width 0.3s ease-out",
            }}
          />
        </div>
      </div>

      {/* Keyframe styles */}
      <style>{`
        @keyframes boot-line-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes boot-pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.8; transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}
