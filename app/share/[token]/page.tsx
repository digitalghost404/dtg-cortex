"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface SharedNote {
  name: string;
  content: string;
  tags: string[];
}

export default function SharedNotePage() {
  const params = useParams();
  const token = params.token as string;
  const [note, setNote] = useState<SharedNote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchNote() {
      try {
        const res = await fetch(`/api/share/${token}`);
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as SharedNote;
        setNote(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load note");
      } finally {
        setLoading(false);
      }
    }

    fetchNote();
  }, [token]);

  if (loading) {
    return (
      <div
        className="cortex-bg"
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.7rem",
            letterSpacing: "0.18em",
            color: "var(--cyan-mid, #2dd4bf)",
          }}
        >
          LOADING...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="cortex-bg"
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "2rem",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.75rem",
            letterSpacing: "0.15em",
            color: "#f87171",
          }}
        >
          {error === "Share not found or expired" || error === "Share has expired"
            ? "THIS LINK HAS EXPIRED OR DOES NOT EXIST"
            : `ERROR: ${error.toUpperCase()}`}
        </span>
        <a
          href="/"
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            letterSpacing: "0.12em",
            color: "var(--text-muted, #888)",
            textDecoration: "none",
            marginTop: "1rem",
          }}
        >
          GO TO CORTEX
        </a>
      </div>
    );
  }

  if (!note) return null;

  return (
    <div
      className="cortex-bg"
      style={{ minHeight: "100vh", overflowY: "auto" }}
    >
      {/* Header */}
      <header
        style={{
          padding: "1.5rem 2rem",
          borderBottom: "1px solid var(--border-dim, #333)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "1.1rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: "var(--cyan-bright, #22d3ee)",
            margin: 0,
            textShadow: "0 0 8px rgba(34,211,238,0.4)",
          }}
        >
          {note.name}
        </h1>
        {note.tags.length > 0 && (
          <div
            style={{
              display: "flex",
              gap: "0.4rem",
              flexWrap: "wrap",
              marginTop: "0.75rem",
            }}
          >
            {note.tags.map((tag) => (
              <span
                key={tag}
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.55rem",
                  letterSpacing: "0.08em",
                  color: "var(--text-muted, #888)",
                  border: "1px solid var(--border-dim, #333)",
                  borderRadius: "2px",
                  padding: "1px 6px",
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Content */}
      <main
        style={{
          maxWidth: "720px",
          margin: "0 auto",
          padding: "2rem 1.5rem 4rem",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.8rem",
            lineHeight: 1.8,
            color: "var(--text-secondary, #ccc)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {note.content}
        </div>
      </main>

      {/* Footer */}
      <footer
        style={{
          padding: "1rem 2rem",
          borderTop: "1px solid var(--border-dim, #333)",
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.5rem",
            letterSpacing: "0.18em",
            color: "var(--text-faint, #666)",
          }}
        >
          SHARED FROM CORTEX
        </span>
      </footer>
    </div>
  );
}
