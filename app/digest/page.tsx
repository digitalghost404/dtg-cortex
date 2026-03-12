"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import NotePreview from "@/app/components/NotePreview";
import type { DigestResponse, DigestSection } from "@/app/api/digest/route";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConnectionMeta {
  similarity: number;
  pathA: string;
  pathB: string;
  noteA: string;
  noteB: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseConnectionMeta(raw: string | undefined): ConnectionMeta | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConnectionMeta;
  } catch {
    return null;
  }
}

function formatGeneratedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

// ---------------------------------------------------------------------------
// Section panels
// ---------------------------------------------------------------------------

function StatsPanel({ section }: { section: DigestSection }) {
  return (
    <div className="vault-panel digest-section">
      <h2 className="vault-panel__title">{section.title}</h2>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "1rem",
          marginTop: "0.9rem",
        }}
      >
        {section.items.map((item, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <span className="vault-stat">{item.meta}</span>
            <span
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.6rem",
                letterSpacing: "0.12em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
              }}
            >
              {item.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChangesPanel({ section }: { section: DigestSection }) {
  if (section.items.length === 0) {
    return (
      <div className="vault-panel digest-section">
        <h2 className="vault-panel__title">{section.title}</h2>
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.65rem",
            color: "var(--text-faint)",
            marginTop: "0.75rem",
            letterSpacing: "0.1em",
          }}
        >
          NO CHANGES IN THE LAST 7 DAYS
        </p>
      </div>
    );
  }

  return (
    <div className="vault-panel digest-section">
      <h2 className="vault-panel__title">{section.title}</h2>
      <ul style={{ listStyle: "none", margin: "0.75rem 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {section.items.map((item, i) => {
          // meta: "today · 234 words · path/to/note.md"
          const parts = item.meta?.split(" · ") ?? [];
          const when = parts[0] ?? "";
          const words = parts[1] ?? "";
          const isNew = when === "today";

          return (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                padding: "0.4rem 0.5rem",
                borderBottom: "1px solid var(--border-dim)",
              }}
            >
              <span
                className={`digest-badge ${isNew ? "digest-badge--new" : "digest-badge--updated"}`}
              >
                {isNew ? "NEW" : "UPDATED"}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.72rem",
                  letterSpacing: "0.05em",
                  color: "var(--cyan-bright)",
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.text}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.58rem",
                  letterSpacing: "0.08em",
                  color: "var(--text-muted)",
                  flexShrink: 0,
                }}
              >
                {when} · {words}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ConnectionsPanel({ section }: { section: DigestSection }) {
  if (section.items.length === 0) {
    return (
      <div className="vault-panel digest-section">
        <h2 className="vault-panel__title">{section.title}</h2>
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.65rem",
            color: "var(--text-faint)",
            marginTop: "0.75rem",
            letterSpacing: "0.1em",
          }}
        >
          NO MISSING CONNECTIONS DETECTED — INDEX MAY NOT BE BUILT
        </p>
      </div>
    );
  }

  return (
    <div className="vault-panel digest-section">
      <h2 className="vault-panel__title">{section.title}</h2>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.6rem",
          marginTop: "0.75rem",
        }}
      >
        {section.items.map((item, i) => {
          const conn = parseConnectionMeta(item.meta);
          if (!conn) {
            return (
              <div key={i} className="link-discovery__card">
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.68rem",
                    color: "var(--cyan-bright)",
                  }}
                >
                  {item.text}
                </span>
              </div>
            );
          }

          const pct = Math.round(conn.similarity * 100);

          return (
            <div key={i} className="link-discovery__card">
              {/* Note names with NotePreview hover */}
              <div className="link-discovery__notes">
                <NotePreview notePath={conn.pathA} noteName={conn.noteA}>
                  <span className="link-discovery__note-name">{conn.noteA}</span>
                </NotePreview>
                <span className="link-discovery__connector">&#8592;&#8594;</span>
                <NotePreview notePath={conn.pathB} noteName={conn.noteB}>
                  <span className="link-discovery__note-name">{conn.noteB}</span>
                </NotePreview>
              </div>
              {/* Similarity bar */}
              <div className="link-discovery__score">
                <div
                  className="link-discovery__score-fill"
                  style={{ width: `${pct}%` }}
                />
                <span className="link-discovery__score-label">{pct}% MATCH</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ForgottenPanel({ section }: { section: DigestSection }) {
  if (section.items.length === 0) {
    return (
      <div className="vault-panel digest-section">
        <h2 className="vault-panel__title">{section.title}</h2>
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.65rem",
            color: "var(--text-faint)",
            marginTop: "0.75rem",
            letterSpacing: "0.1em",
          }}
        >
          ALL NOTES RECENTLY ACTIVE
        </p>
      </div>
    );
  }

  return (
    <div className="vault-panel digest-section">
      <h2 className="vault-panel__title">{section.title}</h2>
      <ul style={{ listStyle: "none", margin: "0.75rem 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {section.items.map((item, i) => {
          // meta: "45d since last edit · folder/note.md"
          const parts = item.meta?.split(" · ") ?? [];
          const staleness = parts[0] ?? "";
          const daysMatch = staleness.match(/^(\d+)d/);
          const days = daysMatch ? parseInt(daysMatch[1], 10) : 0;

          // Redness ramps up: >30d = mild, >90d = heavy, >180d = max
          const redIntensity = Math.min(1, (days - 30) / 150);

          return (
            <li
              key={i}
              className="digest-forgotten"
              style={{
                borderColor: `rgba(248, 113, 113, ${0.08 + redIntensity * 0.35})`,
                // Inline override for dynamic red tint
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.7rem",
                  letterSpacing: "0.05em",
                  color: `rgba(224, 247, 250, ${1 - redIntensity * 0.4})`,
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {item.text}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.58rem",
                  letterSpacing: "0.08em",
                  color: `rgba(248, 113, 113, ${0.5 + redIntensity * 0.5})`,
                  flexShrink: 0,
                }}
              >
                {staleness}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.5rem",
                  letterSpacing: "0.14em",
                  color: `rgba(248, 113, 113, ${0.4 + redIntensity * 0.6})`,
                  flexShrink: 0,
                }}
              >
                FADING
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function QuestionsPanel({ section }: { section: DigestSection }) {
  if (section.items.length === 0) {
    return (
      <div className="vault-panel digest-section">
        <h2 className="vault-panel__title">{section.title}</h2>
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.65rem",
            color: "var(--text-faint)",
            marginTop: "0.75rem",
            letterSpacing: "0.1em",
          }}
        >
          INSUFFICIENT VAULT DATA FOR HEURISTICS
        </p>
      </div>
    );
  }

  return (
    <div className="vault-panel digest-section">
      <h2 className="vault-panel__title">{section.title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginTop: "0.75rem" }}>
        {section.items.map((item, i) => (
          <blockquote key={i} className="digest-question">
            <span
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.58rem",
                letterSpacing: "0.16em",
                color: "var(--cyan-mid)",
                display: "block",
                marginBottom: "0.3rem",
              }}
            >
              Q{String(i + 1).padStart(2, "0")}
            </span>
            {item.text}
          </blockquote>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section router
// ---------------------------------------------------------------------------

function SectionPanel({ section }: { section: DigestSection }) {
  switch (section.type) {
    case "stats":
      return <StatsPanel section={section} />;
    case "changes":
      return <ChangesPanel section={section} />;
    case "connections":
      return <ConnectionsPanel section={section} />;
    case "forgotten":
      return <ForgottenPanel section={section} />;
    case "questions":
      return <QuestionsPanel section={section} />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

function DigestLoader() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.25rem",
        minHeight: "40vh",
      }}
    >
      <div className="scan-loader">
        <div className="scan-loader__bar" />
        <div className="scan-loader__bar" />
        <div className="scan-loader__bar" />
        <div className="scan-loader__bar" />
        <div className="scan-loader__bar" />
      </div>
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.65rem",
          letterSpacing: "0.2em",
          color: "var(--cyan-mid)",
        }}
      >
        COMPILING BRIEFING...
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DigestPage() {
  const [digest, setDigest] = useState<DigestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDigest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/digest");
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as DigestResponse;
      setDigest(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDigest();
  }, [fetchDigest]);

  return (
    <div
      className="cortex-bg"
      style={{
        minHeight: "100vh",
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header
        className="hud-header-rule hud-enter"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1rem",
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "var(--bg-deep)",
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        {/* Left: back link */}
        <Link
          href="/"
          className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            letterSpacing: "0.1em",
            fontSize: "0.6rem",
            textDecoration: "none",
          }}
        >
          <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#8592;</span>
          BACK TO CORTEX
        </Link>

        {/* Centre: title */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.15rem" }}>
          <span
            className="cortex-wordmark"
            style={{ fontSize: "0.75rem" }}
          >
            CORTEX
          </span>
          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.55rem",
              letterSpacing: "0.3em",
              color: "var(--text-muted)",
            }}
          >
            DAILY BRIEFING
          </span>
        </div>

        {/* Right: regenerate + timestamp */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {digest && !loading && (
            <span
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.55rem",
                letterSpacing: "0.08em",
                color: "var(--text-faint)",
              }}
            >
              {formatGeneratedAt(digest.generatedAt)}
            </span>
          )}
          <button
            onClick={fetchDigest}
            disabled={loading}
            className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              letterSpacing: "0.1em",
              fontSize: "0.6rem",
            }}
          >
            {loading ? (
              <>
                <span className="indexing-ring" />
                SCANNING
              </>
            ) : (
              <>
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#8635;</span>
                REGENERATE
              </>
            )}
          </button>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: "900px", width: "100%", margin: "0 auto", padding: "1.5rem 1rem 3rem" }}>
        {loading && <DigestLoader />}

        {!loading && error && (
          <div
            className="vault-panel"
            style={{ borderLeftColor: "#f87171", marginTop: "1rem" }}
          >
            <p
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.65rem",
                letterSpacing: "0.12em",
                color: "#f87171",
                margin: 0,
              }}
            >
              ERROR — {error}
            </p>
          </div>
        )}

        {!loading && digest && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
            {digest.sections.map((section, i) => (
              <SectionPanel key={i} section={section} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
