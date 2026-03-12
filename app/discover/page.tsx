"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "@/app/components/AuthProvider";
import GuestNav from "@/app/components/GuestNav";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RandomNote {
  name: string;
  path: string;
  content: string;
  tags: string[];
  words: number;
  folder: string;
  outgoing: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown syntax and return clean plain text.
 * Handles: frontmatter, headings, bold/italic, wikilinks, bare links,
 * inline code, code fences, blockquotes, horizontal rules, list markers.
 */
function stripMarkdown(raw: string): string {
  let text = raw;

  // Remove YAML frontmatter
  text = text.replace(/^---[\s\S]*?---\n?/, "");

  // Remove code fences (``` or ~~~)
  text = text.replace(/^```[\s\S]*?```\s*/gm, "");
  text = text.replace(/^~~~[\s\S]*?~~~\s*/gm, "");

  // Remove ATX headings (# Heading)
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Wikilinks: [[Target|Alias]] -> Alias, [[Target]] -> Target
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // Markdown links: [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Images: ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Bold/italic combinations first, then singles
  text = text.replace(/\*{3}([^*]+)\*{3}/g, "$1");
  text = text.replace(/_{3}([^_]+)_{3}/g, "$1");
  text = text.replace(/\*{2}([^*]+)\*{2}/g, "$1");
  text = text.replace(/_{2}([^_]+)_{2}/g, "$1");
  text = text.replace(/\*([^*]+)\*/g, "$1");
  text = text.replace(/_([^_]+)_/g, "$1");

  // Inline code
  text = text.replace(/`([^`]+)`/g, "$1");

  // Blockquotes
  text = text.replace(/^>\s?/gm, "");

  // Horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");

  // List markers (unordered and ordered)
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");

  // Bare URLs
  text = text.replace(/https?:\/\/\S+/g, "");

  // Collapse multiple blank lines
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScanLoader() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "3px",
      }}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="scan-loader__bar" />
      ))}
    </div>
  );
}

function MetaPill({
  children,
  color = "var(--text-muted)",
  bg = "rgba(34,211,238,0.06)",
  border = "var(--border-dim)",
}: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
  border?: string;
}) {
  return (
    <span
      style={{
        fontFamily: "var(--font-geist-mono, monospace)",
        fontSize: "0.55rem",
        letterSpacing: "0.12em",
        color,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: "2px",
        padding: "2px 7px",
        display: "inline-block",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function NoteCard({
  note,
  visible,
}: {
  note: RandomNote;
  visible: boolean;
}) {
  const preview = stripMarkdown(note.content).slice(0, 800);

  return (
    <div
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(10px)",
        transition: "opacity 0.3s ease, transform 0.3s ease",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-dim)",
        borderLeft: "3px solid var(--cyan-mid)",
        borderRadius: "3px",
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
      }}
    >
      {/* Note name */}
      <div>
        <h2
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "1.1rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            color: "var(--cyan-bright)",
            textShadow: "0 0 8px rgba(34,211,238,0.4)",
            margin: 0,
            lineHeight: 1.3,
            wordBreak: "break-word",
          }}
        >
          {note.name}
        </h2>

        {/* Folder path */}
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            letterSpacing: "0.1em",
            color: "var(--text-faint)",
            margin: "0.35rem 0 0",
          }}
        >
          {note.folder !== "(root)" ? note.folder + "/" : ""}{note.name}.md
        </p>
      </div>

      {/* Meta row: tags + word count + link count */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.4rem",
          alignItems: "center",
        }}
      >
        {note.tags.map((tag) => (
          <MetaPill
            key={tag}
            color="var(--cyan-bright)"
            bg="rgba(34,211,238,0.07)"
            border="rgba(34,211,238,0.2)"
          >
            {tag}
          </MetaPill>
        ))}

        <MetaPill>
          {formatNumber(note.words)} WORDS
        </MetaPill>

        {note.outgoing.length > 0 && (
          <MetaPill>
            {note.outgoing.length} LINK{note.outgoing.length !== 1 ? "S" : ""}
          </MetaPill>
        )}
      </div>

      {/* Divider */}
      <div
        style={{
          height: "1px",
          background: "var(--border-dim)",
        }}
      />

      {/* Content preview */}
      <div>
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.52rem",
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
            display: "block",
            marginBottom: "0.6rem",
          }}
        >
          CONTENT PREVIEW
        </span>
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.72rem",
            lineHeight: 1.75,
            color: "var(--text-secondary)",
            margin: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {preview}
          {note.content.length > 800 && (
            <span style={{ color: "var(--text-faint)" }}> …</span>
          )}
        </p>
      </div>

      {/* Outgoing links */}
      {note.outgoing.length > 0 && (
        <div>
          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.52rem",
              letterSpacing: "0.18em",
              color: "var(--text-muted)",
              display: "block",
              marginBottom: "0.5rem",
            }}
          >
            OUTGOING LINKS
          </span>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem",
            }}
          >
            {note.outgoing.map((link) => (
              <MetaPill
                key={link}
                color="var(--text-secondary)"
                bg="rgba(255,255,255,0.02)"
                border="var(--border-dim)"
              >
                {link}
              </MetaPill>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DiscoverPage() {
  const { isAuthenticated, logout } = useAuth();
  const [note, setNote] = useState<RandomNote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardVisible, setCardVisible] = useState(false);
  const hasFetched = useRef(false);

  const fetchNote = useCallback(async () => {
    // Fade out existing card before fetching
    setCardVisible(false);
    setError(null);
    setLoading(true);

    // Brief pause so the fade-out completes before the card is replaced
    await new Promise<void>((resolve) => setTimeout(resolve, 180));

    try {
      const res = await fetch("/api/random-note");
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as RandomNote;
      setNote(data);
      // Small delay so the new card mounts before we trigger the fade-in
      setTimeout(() => setCardVisible(true), 40);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;
    fetchNote();
  }, [fetchNote]);

  return (
    <div
      className="cortex-bg"
      style={{ minHeight: "100vh", overflowY: "auto" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
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
        {/* Left: back arrow + title */}
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
            DISCOVER
          </h1>
        </div>

        {/* Right: guest nav + auth — hidden on mobile, available from main page */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <div className="hidden-mobile">
            <GuestNav />
          </div>

          {isAuthenticated ? (
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
          ) : (
            <Link
              href="/login"
              className="btn-secondary hidden-mobile"
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

      {/* ── Main ─────────────────────────────────────────────────────────────── */}
      <main
        style={{
          maxWidth: "680px",
          margin: "0 auto",
          padding: "2rem 1rem 4rem",
          width: "100%",
        }}
      >
        {/* Shuffle button */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "2rem",
          }}
        >
          <button
            onClick={fetchNote}
            disabled={loading}
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.8rem",
              fontWeight: 700,
              letterSpacing: "0.28em",
              color: loading ? "var(--text-muted)" : "var(--cyan-bright)",
              background: loading
                ? "rgba(34,211,238,0.03)"
                : "rgba(34,211,238,0.06)",
              border: `1px solid ${loading ? "var(--border-dim)" : "var(--border-mid)"}`,
              borderRadius: "3px",
              padding: "0.65rem 2.5rem",
              cursor: loading ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              transition: "all 0.2s ease",
              boxShadow: loading
                ? "none"
                : "0 0 12px rgba(34,211,238,0.15), inset 0 0 8px rgba(34,211,238,0.04)",
              minWidth: "200px",
              justifyContent: "center",
            }}
            onMouseEnter={(e) => {
              if (loading) return;
              const el = e.currentTarget as HTMLButtonElement;
              el.style.borderColor = "var(--border-bright)";
              el.style.boxShadow =
                "0 0 20px rgba(34,211,238,0.3), inset 0 0 12px rgba(34,211,238,0.08)";
              el.style.background = "rgba(34,211,238,0.1)";
            }}
            onMouseLeave={(e) => {
              if (loading) return;
              const el = e.currentTarget as HTMLButtonElement;
              el.style.borderColor = "var(--border-mid)";
              el.style.boxShadow =
                "0 0 12px rgba(34,211,238,0.15), inset 0 0 8px rgba(34,211,238,0.04)";
              el.style.background = "rgba(34,211,238,0.06)";
            }}
          >
            {loading ? (
              <>
                <ScanLoader />
                <span>LOADING</span>
              </>
            ) : (
              <>
                <span
                  style={{
                    fontSize: "0.75rem",
                    opacity: 0.8,
                    display: "inline-block",
                  }}
                >
                  &#8635;
                </span>
                SHUFFLE
              </>
            )}
          </button>
        </div>

        {/* Subheading */}
        <p
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.58rem",
            letterSpacing: "0.16em",
            color: "var(--text-faint)",
            textAlign: "center",
            margin: "0 0 2rem",
          }}
        >
          RANDOM NOTE FROM YOUR VAULT
        </p>

        {/* Error state */}
        {error && !loading && (
          <div
            style={{
              background: "rgba(248,113,113,0.06)",
              border: "1px solid rgba(248,113,113,0.2)",
              borderLeft: "3px solid #f87171",
              borderRadius: "3px",
              padding: "1rem 1.25rem",
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
              ERROR — {error}
            </p>
          </div>
        )}

        {/* Initial loading placeholder */}
        {loading && !note && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1.25rem",
              minHeight: "30vh",
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
              SCANNING VAULT...
            </span>
          </div>
        )}

        {/* Note card */}
        {note && !error && (
          <NoteCard note={note} visible={cardVisible} />
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
          CORTEX DISCOVER &nbsp;&#9472;&nbsp; RANDOM NOTE SURFACING
        </span>
      </footer>

      {/* ── Mobile-hide utility ──────────────────────────────────────────────── */}
      <style>{`
        @media (max-width: 640px) {
          .hidden-mobile { display: none !important; }
        }
      `}</style>
    </div>
  );
}
