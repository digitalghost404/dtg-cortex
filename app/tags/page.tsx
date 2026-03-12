"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/app/components/AuthProvider";
import GuestNav from "@/app/components/GuestNav";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TagNote {
  name: string;
  path: string;
  words: number;
}

interface TagEntry {
  tag: string;
  count: number;
  notes: TagNote[];
}

interface TagsResponse {
  tags: TagEntry[];
  totalTags: number;
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        padding: "5rem 1rem",
      }}
    >
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
        INDEXING TAG CORPUS...
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

function ErrorState({ message }: { message: string }) {
  return (
    <div
      style={{
        maxWidth: "480px",
        margin: "2rem auto",
        padding: "1.25rem",
        background: "var(--bg-surface)",
        border: "1px solid rgba(248,113,113,0.25)",
        borderLeft: "3px solid #f87171",
        borderRadius: "2px",
      }}
    >
      <p
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.55rem",
          letterSpacing: "0.18em",
          color: "var(--cyan-mid)",
          marginBottom: "0.5rem",
          textTransform: "uppercase",
        }}
      >
        TAG BROWSER ERROR
      </p>
      <p
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.7rem",
          color: "#f87171",
          lineHeight: 1.6,
          margin: 0,
        }}
      >
        {message}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        padding: "5rem 1rem",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.65rem",
          letterSpacing: "0.18em",
          color: "var(--text-faint)",
          textAlign: "center",
        }}
      >
        NO TAGS FOUND IN VAULT
      </span>
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.55rem",
          letterSpacing: "0.1em",
          color: "var(--text-faint)",
          textAlign: "center",
        }}
      >
        ADD YAML FRONT-MATTER TAGS TO YOUR NOTES TO SEE THEM HERE
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tag card
// ---------------------------------------------------------------------------

function TagCard({
  entry,
  maxCount,
  isExpanded,
  onToggle,
}: {
  entry: TagEntry;
  maxCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const barPct = maxCount > 0 ? Math.max(2, Math.round((entry.count / maxCount) * 100)) : 0;
  const contentRef = useRef<HTMLDivElement>(null);

  // Animate the expand/collapse using max-height
  const [maxH, setMaxH] = useState("0px");
  useEffect(() => {
    if (!contentRef.current) return;
    if (isExpanded) {
      // Force a layout read so the browser knows the scroll height
      const scrollH = contentRef.current.scrollHeight;
      setMaxH(`${scrollH}px`);
    } else {
      setMaxH("0px");
    }
  }, [isExpanded, entry.notes.length]);

  return (
    <div
      style={{
        background: isExpanded ? "var(--bg-overlay)" : "var(--bg-surface)",
        border: `1px solid ${isExpanded ? "var(--border-mid)" : "var(--border-dim)"}`,
        borderLeft: `3px solid ${isExpanded ? "var(--cyan-bright)" : "var(--border-mid)"}`,
        borderRadius: "2px",
        transition: "background 0.15s ease, border-color 0.15s ease",
        overflow: "hidden",
      }}
    >
      {/* Card header — always visible, click to toggle */}
      <button
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          width: "100%",
          gap: "0.75rem",
          padding: "0.7rem 0.85rem",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Collapse" : "Expand"} tag ${entry.tag}`}
      >
        {/* Chevron */}
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            color: isExpanded ? "var(--cyan-bright)" : "var(--text-faint)",
            flexShrink: 0,
            transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease, color 0.15s ease",
            display: "inline-block",
          }}
        >
          &#9656;
        </span>

        {/* Tag name */}
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.72rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: isExpanded ? "var(--cyan-bright)" : "var(--text-secondary)",
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textShadow: isExpanded ? "0 0 8px rgba(34,211,238,0.4)" : "none",
            transition: "color 0.15s ease, text-shadow 0.15s ease",
          }}
        >
          {entry.tag}
        </span>

        {/* Count badge */}
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: isExpanded ? "var(--cyan-bright)" : "var(--text-muted)",
            background: isExpanded ? "rgba(34,211,238,0.1)" : "rgba(255,255,255,0.03)",
            border: `1px solid ${isExpanded ? "rgba(34,211,238,0.3)" : "var(--border-dim)"}`,
            borderRadius: "2px",
            padding: "1px 6px",
            flexShrink: 0,
            transition: "all 0.15s ease",
          }}
        >
          {entry.count}
        </span>
      </button>

      {/* Frequency bar */}
      <div
        style={{
          padding: "0 0.85rem 0.6rem 2.35rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
        }}
      >
        <div
          style={{
            flex: 1,
            height: "3px",
            background: "var(--border-dim)",
            borderRadius: "2px",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${barPct}%`,
              height: "100%",
              background: isExpanded
                ? "var(--cyan-bright)"
                : "linear-gradient(90deg, var(--cyan-mid), var(--cyan-dim))",
              borderRadius: "2px",
              boxShadow: isExpanded ? "0 0 6px rgba(34,211,238,0.5)" : "none",
              transition: "background 0.15s ease, box-shadow 0.15s ease",
            }}
          />
        </div>
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.5rem",
            letterSpacing: "0.08em",
            color: "var(--text-faint)",
            flexShrink: 0,
            minWidth: "2rem",
            textAlign: "right",
          }}
        >
          {barPct}%
        </span>
      </div>

      {/* Expandable notes list */}
      <div
        ref={contentRef}
        style={{
          maxHeight: maxH,
          overflow: "hidden",
          transition: "max-height 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
        aria-hidden={!isExpanded}
      >
        <div
          style={{
            borderTop: "1px solid var(--border-dim)",
            padding: "0.5rem 0.85rem 0.75rem 0.85rem",
          }}
        >
          {/* Sub-header */}
          <p
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.5rem",
              letterSpacing: "0.16em",
              color: "var(--text-faint)",
              margin: "0 0 0.5rem 0",
              textTransform: "uppercase",
            }}
          >
            NOTES &mdash; {entry.count}
          </p>

          {/* Note rows */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            {entry.notes.map((note, idx) => (
              <NoteRow key={`${note.path}-${idx}`} note={note} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Note row inside an expanded tag card
// ---------------------------------------------------------------------------

function NoteRow({ note }: { note: TagNote }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.5rem",
        padding: "5px 6px",
        borderBottom: "1px solid var(--border-dim)",
        borderRadius: "2px",
        background: hovered ? "rgba(34,211,238,0.04)" : "transparent",
        cursor: "default",
        transition: "background 0.12s ease",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          minWidth: 0,
          flex: 1,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.5rem",
            color: hovered ? "var(--cyan-bright)" : "var(--text-faint)",
            flexShrink: 0,
            transition: "color 0.12s ease",
          }}
        >
          &#9642;
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.62rem",
            letterSpacing: "0.03em",
            color: hovered ? "var(--text-primary)" : "var(--text-secondary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            transition: "color 0.12s ease",
          }}
          title={note.path}
        >
          {note.name}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.52rem",
          letterSpacing: "0.06em",
          color: "var(--text-faint)",
          flexShrink: 0,
          whiteSpace: "nowrap",
        }}
      >
        {note.words.toLocaleString()}w
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function TagsPage() {
  const { isAuthenticated, logout } = useAuth();
  const [data, setData] = useState<TagsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());

  const fetchTags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tags");
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as TagsResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTags();
  }, [fetchTags]);

  const toggleTag = useCallback((tag: string) => {
    setExpandedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, []);

  const filteredTags =
    data?.tags.filter((t) =>
      filter.trim() === ""
        ? true
        : t.tag.toLowerCase().includes(filter.trim().toLowerCase())
    ) ?? [];

  const maxCount = data?.tags[0]?.count ?? 1;

  return (
    <div
      className="cortex-bg"
      style={{ minHeight: "100vh", overflowY: "auto" }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header
        className="hud-header-rule hud-enter"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.65rem 1rem",
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "var(--bg-deep)",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        {/* Left: back link + breadcrumb + title */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Link
            href="/"
            className="btn-secondary"
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.6rem",
              letterSpacing: "0.12em",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "4px 10px",
              borderRadius: "2px",
              textDecoration: "none",
            }}
          >
            <span style={{ fontSize: "0.8rem" }}>&#8592;</span>
            <span className="hidden sm:inline">BACK TO CORTEX</span>
          </Link>

          <span
            className="hidden sm:inline"
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
            TAG BROWSER
          </h1>

          {data && (
            <span
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.55rem",
                letterSpacing: "0.1em",
                color: "var(--text-faint)",
                background: "rgba(34,211,238,0.06)",
                border: "1px solid var(--border-dim)",
                borderRadius: "2px",
                padding: "1px 6px",
              }}
            >
              {data.totalTags}
            </span>
          )}
        </div>

        {/* Right: guest nav + auth */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            justifyContent: "flex-end",
          }}
        >
          <div className="hidden sm:flex">
            <GuestNav />
          </div>

          {isAuthenticated ? (
            <button
              onClick={logout}
              className="btn-secondary"
              style={{
                fontSize: "0.6rem",
                letterSpacing: "0.12em",
                padding: "4px 12px",
                borderRadius: "2px",
              }}
            >
              LOGOUT
            </button>
          ) : (
            <Link
              href="/login"
              className="btn-secondary hidden sm:flex"
              style={{
                fontSize: "0.6rem",
                letterSpacing: "0.12em",
                padding: "4px 12px",
                borderRadius: "2px",
                textDecoration: "none",
              }}
            >
              LOGIN
            </Link>
          )}
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "1.5rem 1rem", width: "100%" }}>

        {loading && <LoadingState />}
        {error && <ErrorState message={error} />}

        {!loading && !error && data && (
          <>
            {/* Search / filter bar */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                marginBottom: "1.25rem",
              }}
            >
              <div
                style={{
                  flex: 1,
                  position: "relative",
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    left: "0.65rem",
                    top: "50%",
                    transform: "translateY(-50%)",
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    color: "var(--text-faint)",
                    pointerEvents: "none",
                  }}
                >
                  #
                </span>
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="FILTER TAGS..."
                  aria-label="Filter tags by name"
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem 0.5rem 1.75rem",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-dim)",
                    borderRadius: "2px",
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.65rem",
                    letterSpacing: "0.08em",
                    color: "var(--text-secondary)",
                    outline: "none",
                    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-mid)";
                    e.currentTarget.style.boxShadow = "var(--shadow-glow-sm)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-dim)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
              </div>

              {filter && (
                <button
                  onClick={() => setFilter("")}
                  className="btn-secondary"
                  style={{
                    fontSize: "0.6rem",
                    letterSpacing: "0.1em",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "2px",
                    flexShrink: 0,
                  }}
                  aria-label="Clear filter"
                >
                  CLR
                </button>
              )}
            </div>

            {/* Filter result count */}
            {filter && (
              <p
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.55rem",
                  letterSpacing: "0.12em",
                  color: "var(--text-faint)",
                  margin: "-0.75rem 0 1rem 0",
                }}
              >
                {filteredTags.length} / {data.totalTags} TAGS MATCHING &ldquo;{filter}&rdquo;
              </p>
            )}

            {/* Expand/collapse all controls */}
            {filteredTags.length > 0 && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  marginBottom: "0.75rem",
                }}
              >
                <button
                  onClick={() => setExpandedTags(new Set(filteredTags.map((t) => t.tag)))}
                  className="btn-secondary"
                  style={{
                    fontSize: "0.55rem",
                    letterSpacing: "0.1em",
                    padding: "3px 8px",
                    borderRadius: "2px",
                  }}
                >
                  EXPAND ALL
                </button>
                <button
                  onClick={() => setExpandedTags(new Set())}
                  className="btn-secondary"
                  style={{
                    fontSize: "0.55rem",
                    letterSpacing: "0.1em",
                    padding: "3px 8px",
                    borderRadius: "2px",
                  }}
                >
                  COLLAPSE ALL
                </button>
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.5rem",
                    letterSpacing: "0.1em",
                    color: "var(--text-faint)",
                    marginLeft: "0.25rem",
                  }}
                >
                  {expandedTags.size > 0
                    ? `${expandedTags.size} EXPANDED`
                    : "CLICK TAG TO EXPAND"}
                </span>
              </div>
            )}

            {/* Tag grid */}
            {filteredTags.length === 0 && filter ? (
              <div
                style={{
                  padding: "3rem 1rem",
                  textAlign: "center",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.65rem",
                    letterSpacing: "0.14em",
                    color: "var(--text-faint)",
                  }}
                >
                  NO TAGS MATCH &ldquo;{filter}&rdquo;
                </span>
              </div>
            ) : filteredTags.length === 0 ? (
              <EmptyState />
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
                  gap: "0.6rem",
                }}
              >
                {filteredTags.map((entry) => (
                  <TagCard
                    key={entry.tag}
                    entry={entry}
                    maxCount={maxCount}
                    isExpanded={expandedTags.has(entry.tag)}
                    onToggle={() => toggleTag(entry.tag)}
                  />
                ))}
              </div>
            )}
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
          CORTEX TAG BROWSER &nbsp;&#9472;&nbsp; READ-ONLY ANALYSIS
        </span>
      </footer>
    </div>
  );
}
