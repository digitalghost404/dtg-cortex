"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import type { VaultStats } from "@/app/api/vault/route";
import LinkDiscovery from "@/app/components/LinkDiscovery";
import { useAuth } from "@/app/components/AuthProvider";
import GuestNav from "@/app/components/GuestNav";
import { relativeTime } from "@/lib/time-utils";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

type Severity = "ok" | "warn" | "danger";

function severity(count: number, warnAt: number, dangerAt: number): Severity {
  if (count === 0) return "ok";
  if (count < dangerAt && count <= warnAt) return "warn";
  return "danger";
}

const SEVERITY_COLORS: Record<Severity, string> = {
  ok: "var(--cyan-bright)",
  warn: "#fbbf24",
  danger: "#f87171",
};

const SEVERITY_BG: Record<Severity, string> = {
  ok: "rgba(34,211,238,0.08)",
  warn: "rgba(251,191,36,0.08)",
  danger: "rgba(248,113,113,0.08)",
};

const SEVERITY_LABELS: Record<Severity, string> = {
  ok: "NOMINAL",
  warn: "ADVISORY",
  danger: "CRITICAL",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="vault-panel__title">{children}</h2>;
}

function StatBlock({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.55rem",
          letterSpacing: "0.18em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
      <span className="vault-stat">{typeof value === "number" ? formatNumber(value) : value}</span>
      {sub && (
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            color: "var(--text-faint)",
            letterSpacing: "0.1em",
          }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

function HealthRow({
  label,
  count,
  warnAt,
  dangerAt,
}: {
  label: string;
  count: number;
  warnAt: number;
  dangerAt: number;
}) {
  const sev = severity(count, warnAt, dangerAt);
  const color = SEVERITY_COLORS[sev];
  const bg = SEVERITY_BG[sev];

  return (
    <div
      className="flex items-center justify-between px-3 py-2 rounded-sm"
      style={{
        background: bg,
        border: `1px solid ${color}22`,
        borderLeft: `3px solid ${color}`,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.65rem",
          letterSpacing: "0.1em",
          color: "var(--text-secondary)",
        }}
      >
        {label}
      </span>
      <div className="flex items-center gap-2">
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.75rem",
            fontWeight: 700,
            color,
          }}
        >
          {count}
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.5rem",
            letterSpacing: "0.14em",
            color,
            opacity: 0.75,
          }}
        >
          {SEVERITY_LABELS[sev]}
        </span>
      </div>
    </div>
  );
}

function HorizontalBar({
  label,
  count,
  maxCount,
}: {
  label: string;
  count: number;
  maxCount: number;
}) {
  const pct = maxCount > 0 ? Math.max(2, Math.round((count / maxCount) * 100)) : 0;

  return (
    <div className="flex items-center gap-2 group">
      <span
        className="vault-bar-label"
        title={label}
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
        {label}
      </span>
      <div className="vault-bar flex-1" style={{ position: "relative", height: "10px" }}>
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
}

function ScrollableList({
  items,
  emptyText,
  itemColor = "var(--text-secondary)",
}: {
  items: string[];
  emptyText: string;
  itemColor?: string;
}) {
  if (items.length === 0) {
    return (
      <p
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.6rem",
          color: "var(--text-faint)",
          letterSpacing: "0.1em",
          padding: "0.5rem 0",
        }}
      >
        {emptyText}
      </p>
    );
  }

  return (
    <div
      className="overflow-y-auto"
      style={{ maxHeight: "180px" }}
    >
      {items.map((item, i) => (
        <div
          key={i}
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.62rem",
            letterSpacing: "0.05em",
            color: itemColor,
            padding: "3px 0",
            borderBottom: "1px solid var(--border-dim)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Error / loading states
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-20">
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
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.7rem",
          letterSpacing: "0.18em",
          color: "var(--cyan-mid)",
        }}
      >
        RUNNING DIAGNOSTICS...
      </span>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div
      className="vault-panel"
      style={{ borderLeftColor: "#f87171", maxWidth: "480px", margin: "2rem auto" }}
    >
      <PanelTitle>DIAGNOSTIC ERROR</PanelTitle>
      <p
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.7rem",
          color: "#f87171",
          marginTop: "0.75rem",
          lineHeight: 1.6,
        }}
      >
        {message}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

interface ScarTombstone {
  path: string;
  name: string;
  folder: string;
  tags: string[];
  connectedNotes: string[];
  deletedAt: string;
}

export default function VaultPage() {
  const { isAuthenticated, logout } = useAuth();
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [scars, setScars] = useState<ScarTombstone[]>([]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/vault");
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as VaultStats;
      setStats(data);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Fetch scars
    fetch("/api/scars")
      .then((r) => r.json())
      .then((d) => setScars(d.scars ?? []))
      .catch(() => {});
  }, [fetchStats]);

  // Fetch vault meta for lastSyncAt
  useEffect(() => {
    fetch("/api/vault")
      .then((r) => r.json())
      .then(() => {
        // lastSyncAt comes from vault meta — we'll read it from the stats fetch
      })
      .catch(() => {});
    // Also check vault meta directly
    fetch("/api/vault")
      .then(() => {})
      .catch(() => {});
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { totalNotes: number; totalWords: number };
      setLastSyncAt(new Date().toISOString());
      // Refresh vault stats after sync
      fetchStats();
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  }, [fetchStats]);

  const maxTagCount = stats?.topTags[0]?.count ?? 1;
  const maxFolderCount = stats?.folderSizes[0]?.count ?? 1;

  return (
    <div
      className="cortex-bg"
      style={{ height: "100vh", overflowY: "auto" }}
    >
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
          flexWrap: "wrap",
          gap: "0.5rem",
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
            VAULT DIAGNOSTICS
          </h1>
        </div>

        {/* Right: guest nav + refresh button + auth */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <GuestNav />
          {lastRefreshed && (
            <span
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.55rem",
                letterSpacing: "0.1em",
                color: "var(--text-faint)",
              }}
            >
              LAST SCAN: {lastRefreshed.toLocaleTimeString()}
            </span>
          )}
          {lastSyncAt && (
            <span
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.5rem",
                letterSpacing: "0.1em",
                color: "var(--text-faint)",
              }}
            >
              SYNCED: {relativeTime(lastSyncAt)}
            </span>
          )}
          {isAuthenticated && (
            <button
              onClick={handleSync}
              disabled={syncing}
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
              {syncing ? (
                <>
                  <span className="indexing-ring" />
                  SYNCING
                </>
              ) : (
                "SYNC NOW"
              )}
            </button>
          )}
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
              className="btn-secondary"
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

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <main style={{ maxWidth: "1400px", margin: "0 auto", padding: "1.5rem 1rem", width: "100%" }}>

        {loading && !stats && <LoadingState />}
        {error && <ErrorState message={error} />}

        {stats && (
          <div className="vault-grid">

            {/* ── Panel 1: Overview ──────────────────────────────────────────── */}
            <div className="vault-panel">
              <PanelTitle>OVERVIEW</PanelTitle>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))",
                  gap: "1rem",
                  marginTop: "1rem",
                }}
              >
                <StatBlock label="Notes" value={stats.totalNotes} />
                <StatBlock label="Folders" value={stats.totalFolders} />
                <StatBlock
                  label="Words"
                  value={stats.totalWords}
                  sub={`~${Math.round(stats.totalWords / Math.max(stats.totalNotes, 1))} avg`}
                />
              </div>
            </div>

            {/* ── Panel 2: Health ───────────────────────────────────────────── */}
            <div className="vault-panel">
              <PanelTitle>HEALTH STATUS</PanelTitle>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                  marginTop: "1rem",
                }}
              >
                <HealthRow
                  label="BROKEN LINKS"
                  count={stats.brokenLinks.length}
                  warnAt={5}
                  dangerAt={20}
                />
                <HealthRow
                  label="ORPHAN NOTES"
                  count={stats.orphans.length}
                  warnAt={10}
                  dangerAt={30}
                />
                <HealthRow
                  label="EMPTY NOTES"
                  count={stats.emptyNotes.length}
                  warnAt={3}
                  dangerAt={10}
                />
              </div>
            </div>

            {/* ── Panel 3: Top Tags ──────────────────────────────────────────── */}
            <div className="vault-panel">
              <PanelTitle>TOP TAGS</PanelTitle>
              {stats.topTags.length === 0 ? (
                <p
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    color: "var(--text-faint)",
                    letterSpacing: "0.1em",
                    marginTop: "0.75rem",
                  }}
                >
                  NO TAGS FOUND
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
                  {stats.topTags.map(({ tag, count }) => (
                    <HorizontalBar
                      key={tag}
                      label={tag}
                      count={count}
                      maxCount={maxTagCount}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── Panel 4: Folder Distribution ──────────────────────────────── */}
            <div className="vault-panel">
              <PanelTitle>FOLDER DISTRIBUTION</PanelTitle>
              {stats.folderSizes.length === 0 ? (
                <p
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    color: "var(--text-faint)",
                    letterSpacing: "0.1em",
                    marginTop: "0.75rem",
                  }}
                >
                  NO SUBFOLDERS
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
                  {stats.folderSizes.map(({ folder, count }) => (
                    <HorizontalBar
                      key={folder}
                      label={folder}
                      count={count}
                      maxCount={maxFolderCount}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* ── Panel 5: Recently Modified ────────────────────────────────── */}
            <div className="vault-panel">
              <PanelTitle>RECENTLY MODIFIED</PanelTitle>
              {stats.recentlyModified.length === 0 ? (
                <p
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    color: "var(--text-faint)",
                    letterSpacing: "0.1em",
                    marginTop: "0.75rem",
                  }}
                >
                  NO FILES FOUND
                </p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    marginTop: "0.75rem",
                  }}
                >
                  {stats.recentlyModified.map((note) => (
                    <div
                      key={note.path}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "5px 0",
                        borderBottom: "1px solid var(--border-dim)",
                        gap: "0.5rem",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono, monospace)",
                          fontSize: "0.62rem",
                          color: "var(--text-secondary)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          flex: 1,
                        }}
                        title={note.path}
                      >
                        {note.name}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono, monospace)",
                          fontSize: "0.55rem",
                          color: "var(--text-faint)",
                          letterSpacing: "0.08em",
                          flexShrink: 0,
                        }}
                      >
                        {relativeTime(note.modified)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Panel 6: Broken Links ─────────────────────────────────────── */}
            <div className="vault-panel">
              <PanelTitle>
                BROKEN LINKS
                {stats.brokenLinks.length > 0 && (
                  <span
                    style={{
                      marginLeft: "0.5rem",
                      fontSize: "0.6rem",
                      color: "#f87171",
                      fontWeight: 400,
                    }}
                  >
                    ({stats.brokenLinks.length})
                  </span>
                )}
              </PanelTitle>
              <div style={{ marginTop: "0.75rem" }}>
                <ScrollableList
                  items={stats.brokenLinks}
                  emptyText="NO BROKEN LINKS DETECTED"
                  itemColor="#f87171"
                />
              </div>
            </div>

            {/* ── Panel 7: Orphan Notes ─────────────────────────────────────── */}
            <div className="vault-panel">
              <PanelTitle>
                ORPHAN NOTES
                {stats.orphans.length > 0 && (
                  <span
                    style={{
                      marginLeft: "0.5rem",
                      fontSize: "0.6rem",
                      color: "#fbbf24",
                      fontWeight: 400,
                    }}
                  >
                    ({stats.orphans.length})
                  </span>
                )}
              </PanelTitle>
              <div style={{ marginTop: "0.75rem" }}>
                <ScrollableList
                  items={stats.orphans}
                  emptyText="ALL NOTES ARE LINKED"
                  itemColor="#fbbf24"
                />
              </div>
            </div>

            {/* ── Panel 8: Empty Notes ──────────────────────────────────────── */}
            {stats.emptyNotes.length > 0 && (
              <div className="vault-panel">
                <PanelTitle>
                  EMPTY NOTES
                  <span
                    style={{
                      marginLeft: "0.5rem",
                      fontSize: "0.6rem",
                      color: "var(--text-muted)",
                      fontWeight: 400,
                    }}
                  >
                    ({stats.emptyNotes.length})
                  </span>
                </PanelTitle>
                <div style={{ marginTop: "0.75rem" }}>
                  <ScrollableList
                    items={stats.emptyNotes}
                    emptyText="NO EMPTY NOTES"
                    itemColor="var(--text-muted)"
                  />
                </div>
              </div>
            )}

            {/* ── Panel 9: Scar Tissue ──────────────────────────────────────── */}
            {scars.length > 0 && (
              <div className="vault-panel" style={{ gridColumn: "1 / -1" }}>
                <PanelTitle>
                  SCAR TISSUE
                  <span
                    style={{
                      marginLeft: "0.5rem",
                      fontSize: "0.6rem",
                      color: "var(--text-muted)",
                      fontWeight: 400,
                    }}
                  >
                    ({scars.length})
                  </span>
                </PanelTitle>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    marginTop: "0.75rem",
                  }}
                >
                  {scars.map((scar) => (
                    <div
                      key={scar.path}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        padding: "8px 0",
                        borderBottom: "1px solid var(--border-dim)",
                        gap: "1rem",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <span
                          style={{
                            fontFamily: "var(--font-geist-mono, monospace)",
                            fontSize: "0.65rem",
                            color: "var(--text-secondary)",
                            opacity: 0.6,
                          }}
                        >
                          {scar.name}
                        </span>
                        <div style={{ display: "flex", gap: "0.5rem", marginTop: "2px", flexWrap: "wrap" }}>
                          <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.5rem", color: "var(--text-faint)" }}>
                            {scar.folder}
                          </span>
                          {scar.connectedNotes.length > 0 && (
                            <span style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.5rem", color: "var(--text-faint)" }}>
                              was linked to: {scar.connectedNotes.slice(0, 3).join(", ")}
                              {scar.connectedNotes.length > 3 ? ` +${scar.connectedNotes.length - 3}` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono, monospace)",
                          fontSize: "0.55rem",
                          color: "var(--text-faint)",
                          letterSpacing: "0.08em",
                          flexShrink: 0,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {relativeTime(scar.deletedAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Panel 10: Link Discovery (full-width) ─────────────────────── */}
            <LinkDiscovery />

          </div>
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
          CORTEX VAULT DIAGNOSTICS &nbsp;&#9472;&nbsp; READ-ONLY ANALYSIS
        </span>
      </footer>
    </div>
  );
}
