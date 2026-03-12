"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemoryEntry {
  id: string;
  type: "preference" | "interest" | "fact" | "pattern";
  content: string;
  source: string;
  createdAt: string;
  lastReferencedAt: string;
  referenceCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const TYPE_LABELS: Record<MemoryEntry["type"], string> = {
  preference: "PREFERENCE",
  interest: "INTEREST",
  fact: "FACT",
  pattern: "PATTERN",
};

const TYPE_ORDER: MemoryEntry["type"][] = ["preference", "interest", "fact", "pattern"];

// ---------------------------------------------------------------------------
// MemoryCard
// ---------------------------------------------------------------------------

interface MemoryCardProps {
  entry: MemoryEntry;
  onDelete: (id: string) => void;
}

function MemoryCard({ entry, onDelete }: MemoryCardProps) {
  return (
    <div className={`memory-card memory-card--${entry.type}`}>
      <div className="memory-card__header">
        <span className={`memory-card__type memory-card__type--${entry.type}`}>
          {TYPE_LABELS[entry.type]}
        </span>
        <button
          className="memory-card__delete"
          onClick={() => onDelete(entry.id)}
          aria-label="Delete memory"
          title="Delete memory"
        >
          ×
        </button>
      </div>
      <p className="memory-card__content">{entry.content}</p>
      <div className="memory-card__meta">
        <span>Created {formatDate(entry.createdAt)}</span>
        <span className="memory-card__meta-sep">·</span>
        <span>
          Referenced{" "}
          <strong style={{ color: "var(--cyan-bright)" }}>{entry.referenceCount}</strong>{" "}
          time{entry.referenceCount === 1 ? "" : "s"}
        </span>
        {entry.source && entry.source !== "manual" && (
          <>
            <span className="memory-card__meta-sep">·</span>
            <span
              className="memory-card__source"
              title={`Session: ${entry.source}`}
            >
              auto-captured
            </span>
          </>
        )}
        {entry.source === "manual" && (
          <>
            <span className="memory-card__meta-sep">·</span>
            <span className="memory-card__source">manual</span>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AddForm
// ---------------------------------------------------------------------------

interface AddFormProps {
  onAdd: (content: string, type: MemoryEntry["type"]) => Promise<void>;
}

function AddForm({ onAdd }: AddFormProps) {
  const [content, setContent] = useState("");
  const [type, setType] = useState<MemoryEntry["type"]>("fact");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    try {
      await onAdd(content.trim(), type);
      setContent("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="memory-add-form" onSubmit={handleSubmit}>
      <div className="memory-add-form__row">
        <select
          className="memory-add-form__type"
          value={type}
          onChange={(e) => setType(e.target.value as MemoryEntry["type"])}
          aria-label="Memory type"
        >
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          className="memory-add-form__input"
          type="text"
          placeholder="Add a memory... e.g. prefers concise responses"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          aria-label="Memory content"
          maxLength={300}
        />
        <button
          type="submit"
          className="memory-add-form__submit"
          disabled={saving || !content.trim()}
        >
          {saving ? "SAVING..." : "+ ADD"}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MemoryPage() {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMemories = useCallback(async () => {
    try {
      const res = await fetch("/api/memory");
      if (!res.ok) throw new Error("Failed to load memories");
      const data = (await res.json()) as MemoryEntry[];
      setMemories(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  async function handleDelete(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    try {
      await fetch("/api/memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      // Optimistic update already applied; re-fetch to reconcile
      fetchMemories();
    }
  }

  async function handleAdd(content: string, type: MemoryEntry["type"]) {
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, type }),
    });
    await fetchMemories();
  }

  // Group by type
  const grouped = TYPE_ORDER.reduce<Record<MemoryEntry["type"], MemoryEntry[]>>(
    (acc, t) => {
      acc[t] = memories.filter((m) => m.type === t);
      return acc;
    },
    { preference: [], interest: [], fact: [], pattern: [] }
  );

  const totalCount = memories.length;

  return (
    <div
      className="cortex-bg"
      style={{ minHeight: "100vh", overflowY: "auto", overflowX: "hidden" }}
    >
      {/* Header */}
      <header
        className="flex items-center justify-between flex-wrap gap-2 px-4 py-3 hud-header-rule hud-enter"
        style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--bg-deep)" }}
      >
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              letterSpacing: "0.1em",
              fontSize: "0.6rem",
            }}
          >
            <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#8592;</span>
            BACK TO CORTEX
          </Link>

          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.6rem",
              color: "var(--text-faint)",
            }}
          >
            /
          </span>

          <span
            className="cortex-wordmark text-sm font-bold tracking-widest uppercase"
            style={{ fontSize: "0.75rem" }}
          >
            CORTEX MEMORY
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.6rem",
              color: "var(--text-muted)",
              letterSpacing: "0.1em",
            }}
          >
            {totalCount} / 50 ENTRIES
          </span>
        </div>
      </header>

      {/* Main content */}
      <main
        style={{
          maxWidth: 900,
          margin: "0 auto",
          padding: "1.5rem 1rem",
          width: "100%",
        }}
      >
        {/* Add form */}
        <div className="vault-panel" style={{ marginBottom: "1.5rem" }}>
          <h2 className="vault-panel__title" style={{ marginBottom: "1rem" }}>
            ADD MEMORY
          </h2>
          <AddForm onAdd={handleAdd} />
        </div>

        {/* Loading / error states */}
        {loading && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.65rem",
              color: "var(--text-muted)",
              letterSpacing: "0.1em",
              textAlign: "center",
              padding: "3rem 0",
            }}
          >
            <span className="indexing-ring" style={{ display: "inline-block", marginRight: 8 }} />
            LOADING MEMORIES...
          </div>
        )}

        {error && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.65rem",
              color: "#f87171",
              letterSpacing: "0.1em",
              textAlign: "center",
              padding: "2rem 0",
            }}
          >
            ERROR: {error}
          </div>
        )}

        {!loading && !error && memories.length === 0 && (
          <div className="vault-panel" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
            <p
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.65rem",
                color: "var(--text-muted)",
                letterSpacing: "0.1em",
                margin: 0,
              }}
            >
              NO MEMORIES YET
            </p>
            <p
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.55rem",
                color: "var(--text-faint)",
                letterSpacing: "0.08em",
                marginTop: "0.5rem",
              }}
            >
              Tell Cortex things like &quot;I prefer concise responses&quot; or &quot;I&#39;m a backend engineer&quot; and it will remember them.
            </p>
          </div>
        )}

        {!loading && !error && memories.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            {TYPE_ORDER.map((type) => {
              const group = grouped[type];
              if (group.length === 0) return null;
              return (
                <div key={type} className="vault-panel">
                  <h2 className="vault-panel__title" style={{ marginBottom: "1rem" }}>
                    {TYPE_LABELS[type]}S &mdash; {group.length}
                  </h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                    {group
                      .sort((a, b) => b.referenceCount - a.referenceCount)
                      .map((entry) => (
                        <MemoryCard key={entry.id} entry={entry} onDelete={handleDelete} />
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
