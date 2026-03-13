"use client";

import { useState } from "react";

interface PhantomThread {
  sourceNotePath: string;
  sourceNoteName: string;
  targetNotePath: string;
  targetNoteName: string;
  similarity: number;
}

interface Props {
  thread: PhantomThread;
  onClose: () => void;
  onForged: () => void;
}

export default function PhantomThreadPanel({ thread, onClose, onForged }: Props) {
  const [forging, setForging] = useState(false);
  const [forged, setForged] = useState(false);

  const handleForge = async () => {
    setForging(true);
    try {
      const res = await fetch("/api/phantom-threads?forge=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: thread.sourceNotePath,
          targetPath: thread.targetNotePath,
        }),
      });
      if (res.ok) {
        setForged(true);
        onForged();
      }
    } catch {
      // ignore
    } finally {
      setForging(false);
    }
  };

  return (
    <aside
      className="cluster-info-panel"
      role="complementary"
      aria-label="Phantom thread detail"
    >
      <div className="graph-info-panel__header">
        <span className="graph-info-panel__label">PHANTOM THREAD</span>
        <button
          onClick={onClose}
          className="graph-info-panel__close"
          aria-label="Close phantom detail"
        >
          &times;
        </button>
      </div>
      <div className="graph-info-panel__body">
        <div className="graph-info-panel__rows">
          <div className="graph-info-panel__row">
            <span className="graph-info-panel__key">SOURCE</span>
            <span className="graph-info-panel__val" style={{ color: "var(--cyan-bright)" }}>
              {thread.sourceNoteName}
            </span>
          </div>
          <div className="graph-info-panel__row">
            <span className="graph-info-panel__key">TARGET</span>
            <span className="graph-info-panel__val" style={{ color: "var(--cyan-bright)" }}>
              {thread.targetNoteName}
            </span>
          </div>
          <div className="graph-info-panel__row">
            <span className="graph-info-panel__key">SIMILARITY</span>
            <span className="graph-info-panel__val">
              {Math.round(thread.similarity * 100)}%
            </span>
          </div>
        </div>

        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.55rem",
            color: "var(--text-muted)",
            lineHeight: 1.6,
            marginTop: "0.75rem",
          }}
        >
          These notes are semantically similar but not linked. Forging will add
          a wikilink between them.
        </p>

        <button
          onClick={handleForge}
          disabled={forging || forged}
          style={{
            marginTop: "0.75rem",
            width: "100%",
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            letterSpacing: "0.14em",
            padding: "8px 12px",
            borderRadius: "2px",
            border: forged ? "1px solid var(--cyan-mid)" : "1px solid var(--border-mid)",
            background: forged ? "rgba(34,211,238,0.1)" : "transparent",
            color: forged ? "var(--cyan-bright)" : "var(--cyan-bright)",
            cursor: forging || forged ? "not-allowed" : "pointer",
            transition: "all 0.2s",
            textShadow: forged ? "0 0 8px rgba(34,211,238,0.4)" : "none",
          }}
        >
          {forged ? "CONNECTION FORGED" : forging ? "FORGING..." : "FORGE CONNECTION"}
        </button>
      </div>
    </aside>
  );
}
