"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import VaultDNA from "../components/VaultDNA";

interface JournalEntry {
  date: string;
  dayNumber: number;
  content: string;
  generatedAt: string;
}

export default function JournalPage() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // First trigger today's entry generation, then fetch all
    fetch("/api/journal", { method: "POST" })
      .catch(() => {})
      .finally(() => {
        fetch("/api/journal")
          .then((r) => r.json())
          .then((data: { entries: JournalEntry[] }) => {
            setEntries(data.entries ?? []);
            setLoading(false);
          })
          .catch(() => setLoading(false));
      });
  }, []);

  return (
    <div
      className="min-h-full cortex-bg"
      style={{
        fontFamily: "var(--font-geist-mono, monospace)",
        padding: "2rem 1rem",
      }}
    >
      {/* Header */}
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto 2rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
        }}
      >
        <Link
          href="/"
          style={{
            color: "var(--cyan-bright, #22d3ee)",
            fontSize: "0.6rem",
            letterSpacing: "0.12em",
            textDecoration: "none",
            opacity: 0.6,
          }}
        >
          &larr; CORTEX
        </Link>
        <div style={{ flex: 1 }} />
        <VaultDNA size={20} />
        <span
          style={{
            fontSize: "0.7rem",
            letterSpacing: "0.25em",
            color: "var(--cyan-bright, #22d3ee)",
            textShadow: "0 0 8px rgba(34,211,238,0.3)",
          }}
        >
          INNER JOURNAL
        </span>
      </div>

      {/* Entries */}
      <div style={{ maxWidth: 640, margin: "0 auto" }}>
        {loading && (
          <div
            style={{
              textAlign: "center",
              fontSize: "0.6rem",
              letterSpacing: "0.12em",
              color: "var(--text-muted, #64748b)",
              padding: "3rem 0",
            }}
          >
            LOADING JOURNAL ENTRIES...
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div
            style={{
              textAlign: "center",
              fontSize: "0.6rem",
              letterSpacing: "0.12em",
              color: "var(--text-muted, #64748b)",
              padding: "3rem 0",
            }}
          >
            NO JOURNAL ENTRIES YET. CORTEX NEEDS TIME TO ACCUMULATE EXPERIENCES.
          </div>
        )}

        {entries.map((entry) => (
          <div
            key={entry.date}
            style={{
              marginBottom: "1.5rem",
              padding: "0.75rem 1rem",
              borderLeft: "2px solid rgba(34, 211, 238, 0.15)",
              background: "rgba(2, 4, 8, 0.5)",
            }}
          >
            {/* Date header */}
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "0.75rem",
                marginBottom: "0.5rem",
              }}
            >
              <span
                style={{
                  fontSize: "0.55rem",
                  letterSpacing: "0.15em",
                  color: "var(--cyan-bright, #22d3ee)",
                  opacity: 0.7,
                }}
              >
                DAY {entry.dayNumber}
              </span>
              <span
                style={{
                  fontSize: "0.5rem",
                  letterSpacing: "0.1em",
                  color: "var(--text-muted, #64748b)",
                }}
              >
                {entry.date}
              </span>
            </div>

            {/* Entry content */}
            <p
              style={{
                fontSize: "0.6rem",
                lineHeight: 1.8,
                letterSpacing: "0.04em",
                color: "var(--text-secondary, #94a3b8)",
                margin: 0,
              }}
            >
              {entry.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
