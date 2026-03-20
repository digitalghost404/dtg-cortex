"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/app/components/AuthProvider";

// ---------------------------------------------------------------------------
// Types (mirrors lib/briefing.ts)
// ---------------------------------------------------------------------------

interface BriefingTopic {
  id: string;
  label: string;
  query: string;
}

interface BriefingStory {
  title: string;
  url: string;
  snippet: string;
  source: string;
  resonances?: Array<{ noteName: string; notePath: string; score: number }>;
}

interface BriefingSection {
  topic: BriefingTopic;
  stories: BriefingStory[];
  analysis: string;
}

interface Briefing {
  date: string;
  generatedAt: string;
  sections: BriefingSection[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).toUpperCase();
}

function formatTime(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function countStories(briefing: Briefing): number {
  return briefing.sections.reduce((sum, s) => sum + s.stories.length, 0);
}

function countResonances(briefing: Briefing): number {
  return briefing.sections.reduce(
    (sum, s) => sum + s.stories.reduce((ss, story) => ss + (story.resonances?.length ?? 0), 0),
    0
  );
}

// ---------------------------------------------------------------------------
// Section icons by topic id
// ---------------------------------------------------------------------------

const TOPIC_ICONS: Record<string, string> = {
  "ai-ml": "\u2726",        // ✦
  "tech": "\u25C8",          // ◈
  "cloud-devops": "\u2601",  // ☁
  "science-space": "\u2736", // ✶
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScanLoader() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="scan-loader__bar" />
      ))}
    </div>
  );
}

function StoryItem({ story }: { story: BriefingStory }) {
  const hasResonance = story.resonances && story.resonances.length > 0;

  return (
    <div
      className={hasResonance ? "resonance-border" : ""}
      style={{
        padding: "0.6rem 0",
        paddingLeft: hasResonance ? "0.75rem" : undefined,
        borderBottom: "1px solid var(--border-dim)",
      }}
    >
      <a
        href={story.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.7rem",
          fontWeight: 600,
          letterSpacing: "0.04em",
          color: "var(--cyan-bright)",
          textDecoration: "none",
          lineHeight: 1.4,
          display: "block",
          transition: "text-shadow 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.textShadow =
            "0 0 8px rgba(34,211,238,0.5)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLAnchorElement).style.textShadow = "none";
        }}
      >
        {story.title}
      </a>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: "1rem",
          marginTop: "0.3rem",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            color: "var(--text-muted)",
            margin: 0,
            lineHeight: 1.5,
            flex: 1,
          }}
        >
          {story.snippet}
        </p>
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.5rem",
            letterSpacing: "0.08em",
            color: "var(--text-faint)",
            whiteSpace: "nowrap",
            flexShrink: 0,
            marginTop: "0.15rem",
          }}
        >
          {story.source}
        </span>
      </div>
      {hasResonance && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.35rem" }}>
          {story.resonances!.map((r, i) => (
            <span
              key={i}
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.5rem",
                letterSpacing: "0.08em",
                color: "var(--cyan-bright)",
                border: "1px solid var(--cyan-dim)",
                borderRadius: "2px",
                padding: "2px 8px",
                background: "rgba(34,211,238,0.06)",
              }}
            >
              RESONATES WITH: [[{r.noteName}]]
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TopicSection({ section }: { section: BriefingSection }) {
  const icon = TOPIC_ICONS[section.topic.id] || "\u25C6";

  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-dim)",
        borderLeft: "3px solid var(--cyan-mid)",
        borderRadius: "3px",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.25rem",
      }}
    >
      {/* Topic header */}
      <h2
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.7rem",
          fontWeight: 700,
          letterSpacing: "0.22em",
          color: "var(--cyan-bright)",
          textShadow: "0 0 8px rgba(34,211,238,0.4)",
          margin: "0 0 0.75rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>{icon}</span>
        {section.topic.label.toUpperCase()}
      </h2>

      {/* Analysis */}
      <p
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.65rem",
          color: "var(--text-secondary)",
          lineHeight: 1.6,
          margin: "0 0 0.75rem",
          padding: "0.6rem 0.8rem",
          background: "rgba(34,211,238,0.04)",
          borderRadius: "2px",
          border: "1px solid rgba(34,211,238,0.08)",
        }}
      >
        {section.analysis}
      </p>

      {/* Stories */}
      {section.stories.length > 0 ? (
        <div>
          {section.stories.map((story, i) => (
            <StoryItem key={i} story={story} />
          ))}
        </div>
      ) : (
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            color: "var(--text-faint)",
            fontStyle: "italic",
            margin: 0,
          }}
        >
          No stories available for this topic.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function BriefingPage() {
  const { isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [stale, setStale] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState<string | null>(null);

  // Fetch available dates
  const fetchDates = useCallback(async () => {
    try {
      const res = await fetch("/api/briefing?list=true");
      if (!res.ok) return;
      const data = await res.json();
      setDates(data.dates || []);
    } catch {
      // ignore
    }
  }, []);

  // Fetch briefing for a specific date or latest
  const fetchBriefing = useCallback(async (date?: string, retry = 0) => {
    setLoading(true);
    setError(null);
    try {
      const url = date ? `/api/briefing?date=${date}` : "/api/briefing";
      const res = await fetch(url);
      if (!res.ok) {
        if (res.status === 404 && !date && retry < 1) {
          // First load with no briefings — trigger generation via POST, then retry GET
          setError("GENERATING FIRST BRIEFING — THIS MAY TAKE A MOMENT...");
          try {
            const postRes = await fetch("/api/briefing", { method: "POST" });
            if (postRes.ok) {
              return fetchBriefing(undefined, retry + 1);
            }
          } catch {
            // fall through
          }
          setError("Briefing generation failed. Please try refreshing the page.");
          setBriefing(null);
          return;
        }
        if (res.status === 404) {
          setError("Briefing not found for this date.");
          setBriefing(null);
          return;
        }
        throw new Error("Failed to fetch briefing");
      }
      const data = await res.json();
      setBriefing(data as Briefing);
      setStale(!!data.stale);
      setCurrentDate(data.date);
      setError(null);
    } catch {
      setError("Failed to load briefing.");
    } finally {
      setLoading(false);
    }
  }, []);

  const regenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      const res = await fetch("/api/briefing", { method: "POST" });
      if (res.ok) {
        setStale(false);
        await fetchBriefing();
        await fetchDates();
      } else {
        setError("Regeneration failed. Please try again later.");
      }
    } catch {
      setError("Regeneration failed. Please try again later.");
    } finally {
      setRegenerating(false);
    }
  }, [fetchBriefing, fetchDates]);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      fetchBriefing();
      fetchDates();
    }
  }, [authLoading, isAuthenticated, fetchBriefing, fetchDates]);

  // History navigation
  const currentIdx = currentDate ? dates.indexOf(currentDate) : -1;
  const canGoOlder = currentIdx >= 0 && currentIdx < dates.length - 1;
  const canGoNewer = currentIdx > 0;

  const goOlder = () => {
    if (canGoOlder) {
      const olderDate = dates[currentIdx + 1];
      setCurrentDate(olderDate);
      fetchBriefing(olderDate);
    }
  };

  const goNewer = () => {
    if (canGoNewer) {
      const newerDate = dates[currentIdx - 1];
      setCurrentDate(newerDate);
      fetchBriefing(newerDate);
    }
  };

  if (authLoading) return null;

  if (!isAuthenticated) {
    return (
      <div
        className="cortex-bg"
        style={{
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Link
          href="/login"
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.7rem",
            letterSpacing: "0.12em",
            color: "var(--cyan-bright)",
            textDecoration: "none",
            padding: "8px 20px",
            border: "1px solid var(--border-mid)",
            borderRadius: "2px",
          }}
        >
          LOGIN TO VIEW BRIEFING
        </Link>
      </div>
    );
  }

  return (
    <div
      className="cortex-bg"
      style={{ height: "100vh", overflowY: "auto" }}
    >
      {/* ── Header ────────────────────────────────────────────────────── */}
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
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        {/* Left: back + title */}
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
              (e.currentTarget as HTMLAnchorElement).style.color = "var(--cyan-bright)";
              (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--border-mid)";
              (e.currentTarget as HTMLAnchorElement).style.boxShadow = "var(--shadow-glow-sm)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.color = "var(--text-muted)";
              (e.currentTarget as HTMLAnchorElement).style.borderColor = "var(--border-dim)";
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
            DAILY BRIEFING
          </h1>
        </div>

        {/* Right: logout */}
        <button
          onClick={logout}
          className="btn-secondary hidden-mobile"
          style={{
            fontSize: "0.6rem",
            letterSpacing: "0.12em",
            padding: "4px 12px",
            borderRadius: "2px",
          }}
        >
          LOGOUT
        </button>
      </header>

      {/* ── Main ──────────────────────────────────────────────────────── */}
      <main
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "2rem 1rem 4rem",
          width: "100%",
        }}
      >
        {/* Loading state */}
        {loading && (
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
            <ScanLoader />
            <span
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.65rem",
                letterSpacing: "0.2em",
                color: "var(--cyan-mid)",
              }}
            >
              LOADING BRIEFING...
            </span>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div
            style={{
              background: "rgba(248,113,113,0.06)",
              border: "1px solid rgba(248,113,113,0.2)",
              borderLeft: "3px solid #f87171",
              borderRadius: "3px",
              padding: "1rem 1.25rem",
              marginBottom: "1.5rem",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.65rem",
                letterSpacing: "0.1em",
                color: "#f87171",
                margin: 0,
              }}
            >
              {error}
            </p>
          </div>
        )}

        {/* Stale data warning */}
        {stale && briefing && !loading && (
          <div
            style={{
              background: "rgba(251,191,36,0.06)",
              border: "1px solid rgba(251,191,36,0.2)",
              borderLeft: "3px solid #fbbf24",
              borderRadius: "3px",
              padding: "0.75rem 1.25rem",
              marginBottom: "1.25rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.6rem",
                letterSpacing: "0.1em",
                color: "#fbbf24",
                margin: 0,
              }}
            >
              SHOWING CACHED BRIEFING FROM {formatDate(briefing.date)} — TODAY&apos;S GENERATION FAILED
            </p>
            <button
              onClick={regenerate}
              disabled={regenerating}
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.55rem",
                letterSpacing: "0.1em",
                color: regenerating ? "var(--text-faint)" : "#fbbf24",
                background: "transparent",
                border: "1px solid rgba(251,191,36,0.3)",
                borderRadius: "2px",
                padding: "4px 12px",
                cursor: regenerating ? "wait" : "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {regenerating ? "GENERATING..." : "RETRY"}
            </button>
          </div>
        )}

        {/* Briefing content */}
        {briefing && !loading && (
          <>
            {/* Date + Summary card */}
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-dim)",
                borderRadius: "3px",
                padding: "1.5rem",
                marginBottom: "1.5rem",
                textAlign: "center",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.8rem",
                  fontWeight: 700,
                  letterSpacing: "0.18em",
                  color: "var(--cyan-bright)",
                  textShadow: "0 0 8px rgba(34,211,238,0.3)",
                  margin: "0 0 0.25rem",
                }}
              >
                {formatDate(briefing.date)}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.55rem",
                  letterSpacing: "0.12em",
                  color: "var(--text-faint)",
                  margin: "0 0 1rem",
                }}
              >
                GENERATED {formatTime(briefing.generatedAt)}
              </p>
              <p
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.68rem",
                  color: "var(--text-secondary)",
                  lineHeight: 1.7,
                  margin: 0,
                  fontStyle: "italic",
                }}
              >
                &ldquo;{briefing.summary}&rdquo;
              </p>
            </div>

            {/* Topic sections */}
            {briefing.sections.map((section) => (
              <TopicSection key={section.topic.id} section={section} />
            ))}

            {/* History navigation */}
            {dates.length > 1 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.75rem",
                  marginTop: "2rem",
                  padding: "1rem",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-dim)",
                  borderRadius: "3px",
                }}
              >
                {/* Older button */}
                <button
                  onClick={goOlder}
                  disabled={!canGoOlder}
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    letterSpacing: "0.1em",
                    color: canGoOlder ? "var(--cyan-bright)" : "var(--text-faint)",
                    background: "transparent",
                    border: `1px solid ${canGoOlder ? "var(--border-mid)" : "var(--border-dim)"}`,
                    borderRadius: "2px",
                    padding: "4px 12px",
                    cursor: canGoOlder ? "pointer" : "not-allowed",
                    opacity: canGoOlder ? 1 : 0.4,
                    transition: "all 0.15s",
                  }}
                >
                  &#9664; OLDER
                </button>

                {/* Date pills */}
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    flexWrap: "wrap",
                    justifyContent: "center",
                  }}
                >
                  {dates.slice(Math.max(0, currentIdx - 2), currentIdx + 3).map((d) => (
                    <button
                      key={d}
                      onClick={() => {
                        setCurrentDate(d);
                        fetchBriefing(d);
                      }}
                      style={{
                        fontFamily: "var(--font-geist-mono, monospace)",
                        fontSize: "0.55rem",
                        letterSpacing: "0.08em",
                        color: d === currentDate ? "var(--cyan-bright)" : "var(--text-muted)",
                        background: d === currentDate ? "rgba(34,211,238,0.1)" : "transparent",
                        border: `1px solid ${d === currentDate ? "var(--cyan-mid)" : "var(--border-dim)"}`,
                        borderRadius: "2px",
                        padding: "4px 8px",
                        cursor: "pointer",
                        transition: "all 0.15s",
                        textShadow: d === currentDate ? "0 0 6px rgba(34,211,238,0.4)" : "none",
                      }}
                    >
                      {formatDateShort(d)}
                    </button>
                  ))}
                </div>

                {/* Newer button */}
                <button
                  onClick={goNewer}
                  disabled={!canGoNewer}
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    letterSpacing: "0.1em",
                    color: canGoNewer ? "var(--cyan-bright)" : "var(--text-faint)",
                    background: "transparent",
                    border: `1px solid ${canGoNewer ? "var(--border-mid)" : "var(--border-dim)"}`,
                    borderRadius: "2px",
                    padding: "4px 12px",
                    cursor: canGoNewer ? "pointer" : "not-allowed",
                    opacity: canGoNewer ? 1 : 0.4,
                    transition: "all 0.15s",
                  }}
                >
                  NEWER &#9654;
                </button>
              </div>
            )}
          </>
        )}
      </main>

      {/* ── Footer ──────────────────────────────────────────────────── */}
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
          {briefing
            ? `${briefing.sections.length} TOPICS \u2500\u2500\u2500 ${countStories(briefing)} STORIES \u2500\u2500\u2500 ${countResonances(briefing)} RESONANCES \u2500\u2500\u2500 TAVILY + HAIKU`
            : "CORTEX BRIEFING"}
        </span>
      </footer>

      {/* Mobile-hide utility */}
      <style>{`
        @media (max-width: 640px) {
          .hidden-mobile { display: none !important; }
        }
      `}</style>
    </div>
  );
}
