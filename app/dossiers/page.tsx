"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/app/components/AuthProvider";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VaultFinding {
  noteName: string;
  notePath: string;
  score: number;
  excerpt: string;
}

interface WebFinding {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

interface DossierSynthesis {
  vaultSummary: string;
  webSummary: string;
  agreements: string[];
  gaps: string[];
  recommendations: string[];
}

interface Dossier {
  id: string;
  topic: string;
  createdAt: string;
  savedToVault: boolean;
  suggestedTags: string[];
  vaultFindings: VaultFinding[];
  webFindings: WebFinding[];
  synthesis: DossierSynthesis;
}

interface DossierSummary {
  id: string;
  topic: string;
  createdAt: string;
  savedToVault: boolean;
  vaultFindingCount: number;
  webFindingCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(isoStr).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DossiersPage() {
  const { isAuthenticated, isLoading: authLoading, logout } = useAuth();
  const [summaries, setSummaries] = useState<DossierSummary[]>([]);
  const [activeDossier, setActiveDossier] = useState<Dossier | null>(null);
  const [topic, setTopic] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    try {
      const res = await fetch("/api/dossier");
      if (!res.ok) return;
      const data = await res.json();
      setSummaries(data.dossiers ?? []);
    } catch {
      // ignore
    }
  }, []);

  const fetchDossier = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/dossier?id=${id}`);
      if (!res.ok) return;
      const data: Dossier = await res.json();
      setActiveDossier(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      fetchList();
    }
  }, [authLoading, isAuthenticated, fetchList]);

  const handleGenerate = async () => {
    if (!topic.trim()) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/dossier", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Generation failed");
      }
      const dossier: Dossier = await res.json();
      setActiveDossier(dossier);
      setTopic("");
      fetchList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate dossier");
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveToVault = async () => {
    if (!activeDossier) return;
    setSaving(true);
    try {
      // Build markdown content
      const content = buildDossierMarkdown(activeDossier);

      // Create note via existing API
      const createRes = await fetch("/api/notes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: `Dossier — ${activeDossier.topic}`,
          folder: "cortex-dossier",
          tags: [...activeDossier.suggestedTags.map((t) => `#${t}`), "#cortex-dossier"],
          content,
          sourcePaths: activeDossier.vaultFindings.map((v) => v.notePath),
        }),
      });

      if (createRes.ok) {
        // Mark as saved
        await fetch("/api/dossier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "saveToVault", id: activeDossier.id }),
        });
        setActiveDossier({ ...activeDossier, savedToVault: true });
        fetchList();
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/dossier?id=${id}`, { method: "DELETE" });
    if (activeDossier?.id === id) setActiveDossier(null);
    fetchList();
  };

  if (authLoading) return null;

  if (!isAuthenticated) {
    return (
      <div className="cortex-bg" style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
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
          LOGIN TO VIEW DOSSIERS
        </Link>
      </div>
    );
  }

  return (
    <div className="cortex-bg" style={{ height: "100vh", overflowY: "auto" }}>
      {/* Header */}
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
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link
            href="/"
            className="btn-secondary"
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.65rem",
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
            BACK TO CORTEX
          </Link>
          <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.6rem", color: "var(--border-dim)" }}>/</span>
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
            DOSSIERS
          </h1>
        </div>
        <button
          onClick={logout}
          className="btn-secondary"
          style={{ fontSize: "0.6rem", letterSpacing: "0.12em", padding: "4px 12px", borderRadius: "2px" }}
        >
          LOGOUT
        </button>
      </header>

      {/* Main */}
      <main style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem 1rem 4rem", width: "100%" }}>
        {/* Generate form */}
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-dim)",
            borderRadius: "3px",
            padding: "1.25rem 1.5rem",
            marginBottom: "1.5rem",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.6rem",
              letterSpacing: "0.18em",
              color: "var(--text-muted)",
              margin: "0 0 0.75rem",
              textTransform: "uppercase",
            }}
          >
            GENERATE INTELLIGENCE DOSSIER
          </p>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleGenerate(); }}
              placeholder="Enter topic..."
              disabled={generating}
              style={{
                flex: 1,
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.7rem",
                padding: "8px 12px",
                background: "var(--bg-deep)",
                border: "1px solid var(--border-dim)",
                borderRadius: "2px",
                color: "var(--text-primary)",
                outline: "none",
              }}
            />
            <button
              onClick={handleGenerate}
              disabled={generating || !topic.trim()}
              className="btn-secondary"
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.6rem",
                letterSpacing: "0.12em",
                padding: "8px 16px",
                borderRadius: "2px",
                whiteSpace: "nowrap",
              }}
            >
              {generating ? "COMPILING..." : "COMPILE DOSSIER"}
            </button>
          </div>
          {error && (
            <p style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.6rem", color: "#f87171", marginTop: "0.5rem" }}>
              {error}
            </p>
          )}
        </div>

        {/* Dossier list */}
        {summaries.length > 0 && !activeDossier && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {summaries.map((s) => (
              <div
                key={s.id}
                onClick={() => fetchDossier(s.id)}
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-dim)",
                  borderLeft: "3px solid var(--cyan-mid)",
                  borderRadius: "3px",
                  padding: "1rem 1.25rem",
                  cursor: "pointer",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border-mid)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "var(--shadow-glow-sm)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--border-dim)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "none";
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono, monospace)",
                      fontSize: "0.72rem",
                      fontWeight: 600,
                      color: "var(--cyan-bright)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {s.topic.toUpperCase()}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    {s.savedToVault && (
                      <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.5rem", color: "var(--cyan-mid)", letterSpacing: "0.1em" }}>
                        SAVED
                      </span>
                    )}
                    <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.55rem", color: "var(--text-faint)" }}>
                      {relativeTime(s.createdAt)}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                      style={{
                        fontFamily: "var(--font-geist-mono, monospace)",
                        fontSize: "0.55rem",
                        color: "var(--text-faint)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: "2px 6px",
                      }}
                    >
                      &times;
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: "1rem", marginTop: "0.4rem" }}>
                  <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.55rem", color: "var(--text-muted)" }}>
                    {s.vaultFindingCount} vault sources
                  </span>
                  <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.55rem", color: "var(--text-muted)" }}>
                    {s.webFindingCount} web sources
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Active dossier detail */}
        {activeDossier && (
          <div>
            {/* Back to list */}
            <button
              onClick={() => setActiveDossier(null)}
              className="btn-secondary"
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.6rem",
                letterSpacing: "0.1em",
                padding: "4px 10px",
                borderRadius: "2px",
                marginBottom: "1rem",
              }}
            >
              &#8592; ALL DOSSIERS
            </button>

            {/* Topic header */}
            <div
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border-dim)",
                borderRadius: "3px",
                padding: "1.5rem",
                marginBottom: "1.25rem",
                textAlign: "center",
              }}
            >
              <p style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.85rem",
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: "var(--cyan-bright)",
                textShadow: "0 0 8px rgba(34,211,238,0.3)",
                margin: "0 0 0.25rem",
              }}>
                {activeDossier.topic.toUpperCase()}
              </p>
              <p style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.55rem",
                color: "var(--text-faint)",
                letterSpacing: "0.12em",
                margin: 0,
              }}>
                COMPILED {new Date(activeDossier.createdAt).toLocaleString()}
              </p>
              {activeDossier.suggestedTags.length > 0 && (
                <div style={{ display: "flex", gap: "0.4rem", justifyContent: "center", marginTop: "0.75rem", flexWrap: "wrap" }}>
                  {activeDossier.suggestedTags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        fontFamily: "var(--font-geist-mono, monospace)",
                        fontSize: "0.5rem",
                        letterSpacing: "0.08em",
                        color: "var(--cyan-mid)",
                        border: "1px solid var(--border-dim)",
                        borderRadius: "2px",
                        padding: "2px 8px",
                      }}
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Vault Summary */}
            <DossierSection title="VAULT INTELLIGENCE" borderColor="var(--cyan-mid)">
              <p className="dossier-text">{activeDossier.synthesis.vaultSummary}</p>
              {activeDossier.vaultFindings.length > 0 && (
                <div style={{ marginTop: "0.75rem" }}>
                  {activeDossier.vaultFindings.map((v, i) => (
                    <div key={i} style={{ padding: "0.4rem 0", borderBottom: "1px solid var(--border-dim)" }}>
                      <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.62rem", color: "var(--cyan-bright)" }}>
                        [[{v.noteName}]]
                      </span>
                      <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.5rem", color: "var(--text-faint)", marginLeft: "0.5rem" }}>
                        {Math.round(v.score * 100)}%
                      </span>
                      <p style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.58rem", color: "var(--text-muted)", margin: "0.2rem 0 0", lineHeight: 1.5 }}>
                        {v.excerpt}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </DossierSection>

            {/* Web Summary */}
            <DossierSection title="WEB INTELLIGENCE" borderColor="var(--blue-bright)">
              <p className="dossier-text">{activeDossier.synthesis.webSummary}</p>
              {activeDossier.webFindings.length > 0 && (
                <div style={{ marginTop: "0.75rem" }}>
                  {activeDossier.webFindings.map((w, i) => (
                    <div key={i} style={{ padding: "0.4rem 0", borderBottom: "1px solid var(--border-dim)" }}>
                      <a
                        href={w.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.62rem", color: "var(--blue-bright)", textDecoration: "none" }}
                      >
                        {w.title}
                      </a>
                      <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.5rem", color: "var(--text-faint)", marginLeft: "0.5rem" }}>
                        {w.source}
                      </span>
                      <p style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.58rem", color: "var(--text-muted)", margin: "0.2rem 0 0", lineHeight: 1.5 }}>
                        {w.snippet}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </DossierSection>

            {/* Agreements */}
            {activeDossier.synthesis.agreements.length > 0 && (
              <DossierSection title="CONVERGENCE POINTS" borderColor="var(--cyan-bright)">
                <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                  {activeDossier.synthesis.agreements.map((a, i) => (
                    <li key={i} className="dossier-text" style={{ marginBottom: "0.3rem" }}>{a}</li>
                  ))}
                </ul>
              </DossierSection>
            )}

            {/* Gaps */}
            {activeDossier.synthesis.gaps.length > 0 && (
              <DossierSection title="KNOWLEDGE GAPS" borderColor="#fbbf24">
                <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                  {activeDossier.synthesis.gaps.map((g, i) => (
                    <li key={i} className="dossier-text" style={{ marginBottom: "0.3rem" }}>{g}</li>
                  ))}
                </ul>
              </DossierSection>
            )}

            {/* Recommendations */}
            {activeDossier.synthesis.recommendations.length > 0 && (
              <DossierSection title="RECOMMENDATIONS" borderColor="var(--cyan-mid)">
                <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                  {activeDossier.synthesis.recommendations.map((r, i) => (
                    <li key={i} className="dossier-text" style={{ marginBottom: "0.3rem" }}>{r}</li>
                  ))}
                </ul>
              </DossierSection>
            )}

            {/* Save to vault button */}
            <div style={{ textAlign: "center", marginTop: "1.5rem" }}>
              <button
                onClick={handleSaveToVault}
                disabled={saving || activeDossier.savedToVault}
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.65rem",
                  letterSpacing: "0.14em",
                  padding: "10px 24px",
                  borderRadius: "2px",
                  border: activeDossier.savedToVault
                    ? "1px solid var(--cyan-mid)"
                    : "1px solid var(--border-mid)",
                  background: activeDossier.savedToVault
                    ? "rgba(34,211,238,0.1)"
                    : "transparent",
                  color: "var(--cyan-bright)",
                  cursor: saving || activeDossier.savedToVault ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                  textShadow: activeDossier.savedToVault ? "0 0 8px rgba(34,211,238,0.4)" : "none",
                }}
              >
                {activeDossier.savedToVault ? "SAVED TO VAULT" : saving ? "SAVING..." : "SAVE TO VAULT"}
              </button>
            </div>
          </div>
        )}

        {/* Empty state */}
        {summaries.length === 0 && !activeDossier && !generating && (
          <div style={{ textAlign: "center", padding: "3rem 0" }}>
            <p style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.65rem", color: "var(--text-faint)", letterSpacing: "0.12em" }}>
              NO DOSSIERS COMPILED YET
            </p>
            <p style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.55rem", color: "var(--text-faint)", marginTop: "0.5rem" }}>
              Enter a topic above to generate your first intelligence dossier.
            </p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer
        className="hud-footer-rule"
        style={{ padding: "0.6rem 1.5rem", display: "flex", justifyContent: "center", marginTop: "1rem" }}
      >
        <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.55rem", letterSpacing: "0.14em", color: "var(--text-faint)" }}>
          CORTEX DOSSIER ENGINE &mdash; VAULT + WEB + HAIKU
        </span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DossierSection({
  title,
  borderColor,
  children,
}: {
  title: string;
  borderColor: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border-dim)",
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: "3px",
        padding: "1.25rem 1.5rem",
        marginBottom: "1.25rem",
      }}
    >
      <h2
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.65rem",
          fontWeight: 700,
          letterSpacing: "0.22em",
          color: "var(--cyan-bright)",
          textShadow: "0 0 8px rgba(34,211,238,0.4)",
          margin: "0 0 0.75rem",
        }}
      >
        {title}
      </h2>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown builder for vault save
// ---------------------------------------------------------------------------

function buildDossierMarkdown(dossier: Dossier): string {
  const lines: string[] = [];

  lines.push(`# Dossier: ${dossier.topic}\n`);
  lines.push(`> Compiled: ${new Date(dossier.createdAt).toLocaleString()}\n`);

  lines.push(`## Vault Intelligence\n`);
  lines.push(dossier.synthesis.vaultSummary + "\n");
  if (dossier.vaultFindings.length > 0) {
    lines.push("### Referenced Notes\n");
    for (const v of dossier.vaultFindings) {
      lines.push(`- [[${v.noteName}]] (${Math.round(v.score * 100)}% match)`);
    }
    lines.push("");
  }

  lines.push(`## Web Intelligence\n`);
  lines.push(dossier.synthesis.webSummary + "\n");
  if (dossier.webFindings.length > 0) {
    lines.push("### Sources\n");
    for (const w of dossier.webFindings) {
      lines.push(`- [${w.title}](${w.url}) — ${w.source}`);
    }
    lines.push("");
  }

  if (dossier.synthesis.agreements.length > 0) {
    lines.push(`## Convergence Points\n`);
    for (const a of dossier.synthesis.agreements) {
      lines.push(`- ${a}`);
    }
    lines.push("");
  }

  if (dossier.synthesis.gaps.length > 0) {
    lines.push(`## Knowledge Gaps\n`);
    for (const g of dossier.synthesis.gaps) {
      lines.push(`- ${g}`);
    }
    lines.push("");
  }

  if (dossier.synthesis.recommendations.length > 0) {
    lines.push(`## Recommendations\n`);
    for (const r of dossier.synthesis.recommendations) {
      lines.push(`- ${r}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
