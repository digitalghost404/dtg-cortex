"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import type { LineageEntry } from "@/lib/lineage";

// ---------------------------------------------------------------------------
// Types mirroring getLineageStats() return shape
// ---------------------------------------------------------------------------

interface LineageStats {
  totalQueries: number;
  uniqueNotesReferenced: number;
  mostReferencedNotes: Array<{ name: string; path: string; count: number }>;
  recentEntries: LineageEntry[];
  noteTimeline: Array<{
    name: string;
    firstSeen: string;
    lastSeen: string;
    count: number;
  }>;
  queriesPerDay: Array<{ date: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateShort(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysActive(stats: LineageStats): number {
  const entries = stats.recentEntries;
  if (entries.length === 0) return 0;

  // recentEntries is last 50 sorted desc, so last item is oldest of the 50
  // For accuracy we'd need the full set, but we approximate from queriesPerDay
  const activeDays = stats.queriesPerDay.filter((d) => d.count > 0).length;
  return activeDays;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="vault-panel__title">{children}</h2>;
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div
      className="vault-panel"
      style={{ flex: "1 1 160px", minWidth: 0, padding: "1rem 1.25rem" }}
    >
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.55rem",
          letterSpacing: "0.18em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          display: "block",
          marginBottom: "0.4rem",
        }}
      >
        {label}
      </span>
      <span className="vault-stat">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel 1: Knowledge Pillars
// ---------------------------------------------------------------------------

function KnowledgePillars({
  notes,
}: {
  notes: Array<{ name: string; path: string; count: number }>;
}) {
  const maxCount = notes[0]?.count ?? 1;

  return (
    <div className="vault-panel">
      <PanelTitle>KNOWLEDGE PILLARS</PanelTitle>
      {notes.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            color: "var(--text-faint)",
            letterSpacing: "0.1em",
            marginTop: "0.75rem",
          }}
        >
          NO DATA YET — START CHATTING TO TRACK SOURCES
        </p>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.45rem",
            marginTop: "0.75rem",
          }}
        >
          {notes.map(({ name, count }) => {
            const pct = Math.max(2, Math.round((count / maxCount) * 100));
            return (
              <div key={name} className="flex items-center gap-2 group">
                <span
                  className="vault-bar-label"
                  title={name}
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    letterSpacing: "0.05em",
                    color: "var(--text-secondary)",
                    width: "9rem",
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {name}
                </span>
                <div
                  className="vault-bar flex-1"
                  style={{ position: "relative", height: "10px" }}
                >
                  <div
                    className="vault-bar__fill"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    color: "var(--text-muted)",
                    minWidth: "2.5rem",
                    textAlign: "right",
                    flexShrink: 0,
                  }}
                >
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel 2: Recent Thought Stream
// ---------------------------------------------------------------------------

function ThoughtStream({ entries }: { entries: LineageEntry[] }) {
  return (
    <div className="vault-panel">
      <PanelTitle>RECENT THOUGHT STREAM</PanelTitle>
      {entries.length === 0 ? (
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            color: "var(--text-faint)",
            letterSpacing: "0.1em",
            marginTop: "0.75rem",
          }}
        >
          NO ENTRIES YET
        </p>
      ) : (
        <ol className="lineage-timeline" style={{ marginTop: "0.75rem" }}>
          {entries.map((entry) => (
            <li key={entry.id} className="lineage-entry">
              <span className="lineage-entry__time">
                {formatDate(entry.timestamp)}
              </span>
              <p className="lineage-entry__query">
                {entry.query.length > 120
                  ? entry.query.slice(0, 120) + "..."
                  : entry.query}
              </p>
              {entry.sourceNotes.length > 0 && (
                <div className="lineage-entry__sources">
                  {entry.sourceNotes.map((note) => (
                    <span key={note.name} className="citation-chip">
                      {`[[ ${note.name} ]]`}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel 3: Activity Heatmap
// ---------------------------------------------------------------------------

function ActivityHeatmap({
  queriesPerDay,
}: {
  queriesPerDay: Array<{ date: string; count: number }>;
}) {
  const maxCount = Math.max(...queriesPerDay.map((d) => d.count), 1);

  return (
    <div className="vault-panel">
      <PanelTitle>ACTIVITY HEATMAP</PanelTitle>
      <p
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.55rem",
          letterSpacing: "0.12em",
          color: "var(--text-faint)",
          marginBottom: "0.75rem",
        }}
      >
        QUERIES PER DAY — LAST 30 DAYS
      </p>
      <div className="lineage-heatmap">
        {queriesPerDay.map(({ date, count }) => {
          const intensity = count === 0 ? 0 : Math.max(0.15, count / maxCount);
          return (
            <div
              key={date}
              className="lineage-heatmap__cell"
              title={`${date}: ${count} quer${count === 1 ? "y" : "ies"}`}
              style={{
                opacity: count === 0 ? 0.08 : intensity,
              }}
            />
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "0.4rem",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.5rem",
            color: "var(--text-faint)",
            letterSpacing: "0.1em",
          }}
        >
          {queriesPerDay[0]?.date
            ? formatDateShort(queriesPerDay[0].date)
            : ""}
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.5rem",
            color: "var(--text-faint)",
            letterSpacing: "0.1em",
          }}
        >
          {queriesPerDay[queriesPerDay.length - 1]?.date
            ? formatDateShort(queriesPerDay[queriesPerDay.length - 1].date)
            : ""}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel 4: Note Discovery Timeline
// ---------------------------------------------------------------------------

function DiscoveryTimeline({
  noteTimeline,
}: {
  noteTimeline: Array<{
    name: string;
    firstSeen: string;
    lastSeen: string;
    count: number;
  }>;
}) {
  if (noteTimeline.length === 0) {
    return (
      <div className="vault-panel">
        <PanelTitle>NOTE DISCOVERY TIMELINE</PanelTitle>
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            color: "var(--text-faint)",
            letterSpacing: "0.1em",
            marginTop: "0.75rem",
          }}
        >
          NO DATA YET
        </p>
      </div>
    );
  }

  // Determine the overall time range
  const allFirstSeen = noteTimeline.map((n) => new Date(n.firstSeen).getTime());
  const allLastSeen = noteTimeline.map((n) => new Date(n.lastSeen).getTime());
  const minTime = Math.min(...allFirstSeen);
  const maxTime = Math.max(...allLastSeen);
  const span = Math.max(maxTime - minTime, 1);

  // Show top 20 by count
  const visible = [...noteTimeline]
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return (
    <div className="vault-panel" style={{ gridColumn: "1 / -1" }}>
      <PanelTitle>NOTE DISCOVERY TIMELINE</PanelTitle>
      <p
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.55rem",
          letterSpacing: "0.12em",
          color: "var(--text-faint)",
          marginBottom: "0.75rem",
        }}
      >
        FIRST REFERENCED &rarr; LAST REFERENCED &nbsp;&#9472;&nbsp; TOP 20
        NOTES
      </p>
      <div className="lineage-discovery">
        {visible.map((note) => {
          const first = new Date(note.firstSeen).getTime();
          const last = new Date(note.lastSeen).getTime();
          const leftPct = ((first - minTime) / span) * 100;
          const widthPct = Math.max(0.5, ((last - first) / span) * 100);

          return (
            <div
              key={note.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginBottom: "0.5rem",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.58rem",
                  color: "var(--text-secondary)",
                  width: "9rem",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
                title={note.name}
              >
                {note.name}
              </span>
              <div
                style={{
                  flex: 1,
                  position: "relative",
                  height: "10px",
                  background: "rgba(34,211,238,0.06)",
                  borderRadius: "2px",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    height: "100%",
                    background: "var(--cyan-mid)",
                    borderRadius: "2px",
                    boxShadow: "0 0 6px rgba(34,211,238,0.3)",
                    minWidth: "4px",
                  }}
                  title={`First: ${formatDate(note.firstSeen)} / Last: ${formatDate(note.lastSeen)}`}
                />
              </div>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.55rem",
                  color: "var(--text-muted)",
                  minWidth: "2rem",
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {note.count}x
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Loading / error states
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
      <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="scan-loader__bar" />
        ))}
      </div>
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.7rem",
          letterSpacing: "0.18em",
          color: "var(--cyan-mid)",
        }}
      >
        LOADING LINEAGE...
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function LineagePage() {
  const [stats, setStats] = useState<LineageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lineage");
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as LineageStats;
      setStats(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const activeDays = stats ? daysActive(stats) : 0;

  return (
    <div className="cortex-bg" style={{ minHeight: "100vh", overflowY: "auto" }}>
      {/* ── Page header ────────────────────────────────────────────────────── */}
      <header
        className="hud-header-rule hud-enter"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1.5rem",
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "var(--bg-deep)",
        }}
      >
        {/* Left: back link + title */}
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link
            href="/"
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.65rem",
              letterSpacing: "0.12em",
              color: "var(--text-muted)",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "4px 10px",
              border: "1px solid var(--border-dim)",
              borderRadius: "2px",
              transition: "color 0.15s, border-color 0.15s, box-shadow 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.color =
                "var(--cyan-bright)";
              (e.currentTarget as HTMLAnchorElement).style.borderColor =
                "var(--border-mid)";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow =
                "var(--shadow-glow-sm)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.color =
                "var(--text-muted)";
              (e.currentTarget as HTMLAnchorElement).style.borderColor =
                "var(--border-dim)";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow = "none";
            }}
          >
            <span style={{ fontSize: "0.8rem" }}>&#8592;</span>
            BACK TO CORTEX
          </Link>

          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.6rem",
              color: "var(--border-dim)",
            }}
          >
            /
          </span>

          <h1
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.22em",
              color: "var(--cyan-bright)",
              margin: 0,
              textShadow: "0 0 8px rgba(34,211,238,0.4)",
            }}
          >
            THOUGHT LINEAGE
          </h1>
        </div>

        {/* Right: refresh */}
        <button
          onClick={fetchStats}
          disabled={loading}
          className="btn-secondary"
          style={{
            fontSize: "0.6rem",
            letterSpacing: "0.12em",
            padding: "4px 12px",
            borderRadius: "2px",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {loading ? (
            <>
              <span className="indexing-ring" />
              SCANNING
            </>
          ) : (
            <>
              <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9654;</span>
              REFRESH
            </>
          )}
        </button>
      </header>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: "1400px", margin: "0 auto", padding: "1.5rem" }}>
        {loading && !stats && <LoadingState />}

        {error && (
          <div
            className="vault-panel"
            style={{
              borderLeftColor: "#f87171",
              maxWidth: "480px",
              margin: "2rem auto",
            }}
          >
            <h2 className="vault-panel__title">DIAGNOSTIC ERROR</h2>
            <p
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.7rem",
                color: "#f87171",
                marginTop: "0.75rem",
                lineHeight: 1.6,
              }}
            >
              {error}
            </p>
          </div>
        )}

        {stats && (
          <>
            {/* ── Metrics row ──────────────────────────────────────────────── */}
            <div
              style={{
                display: "flex",
                gap: "1rem",
                flexWrap: "wrap",
                marginBottom: "1.5rem",
              }}
            >
              <MetricCard label="Total Queries" value={stats.totalQueries} />
              <MetricCard
                label="Unique Notes Referenced"
                value={stats.uniqueNotesReferenced}
              />
              <MetricCard label="Days Active" value={activeDays} />
            </div>

            {/* ── Panels grid ──────────────────────────────────────────────── */}
            <div className="vault-grid">
              <KnowledgePillars notes={stats.mostReferencedNotes} />
              <ThoughtStream entries={stats.recentEntries} />
              <ActivityHeatmap queriesPerDay={stats.queriesPerDay} />
              <DiscoveryTimeline noteTimeline={stats.noteTimeline} />
            </div>
          </>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer
        className="hud-footer-rule"
        style={{
          padding: "0.6rem 1.5rem",
          display: "flex",
          justifyContent: "center",
          marginTop: "1rem",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.55rem",
            letterSpacing: "0.14em",
            color: "var(--text-faint)",
          }}
        >
          CORTEX THOUGHT LINEAGE &nbsp;&#9472;&nbsp; META-GRAPH OF KNOWLEDGE
          EVOLUTION
        </span>
      </footer>
    </div>
  );
}
