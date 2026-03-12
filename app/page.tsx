"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, UIMessage } from "ai";
import { isTextUIPart, SourceUrlUIPart } from "ai";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NotePreview from "./components/NotePreview";
import { useVoiceInput } from "./hooks/useVoiceInput";
import { useTTS } from "./hooks/useTTS";
import CommandPalette from "./components/CommandPalette";
import VaultDNA from "./components/VaultDNA";
import ContextWindow from "./components/ContextWindow";
import NoteViewer from "./components/NoteViewer";
import { useAuth } from "./components/AuthProvider";

// ---------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------

const SLASH_COMMANDS = [
  { cmd: "/summarize",   label: "SUMMARIZE NOTE",      template: "Summarize everything I know about " },
  { cmd: "/connections", label: "FIND CONNECTIONS",    template: "What connections exist between " },
  { cmd: "/gaps",        label: "KNOWLEDGE GAPS",      template: "What am I missing or haven't written about regarding " },
  { cmd: "/explain",     label: "EXPLAIN CONCEPT",     template: "Explain the concept of " },
  { cmd: "/related",     label: "RELATED NOTES",       template: "What notes are related to " },
  { cmd: "/timeline",    label: "BUILD TIMELINE",      template: "Create a chronological timeline of events related to " },
  { cmd: "/debate",      label: "CHALLENGE KNOWLEDGE", template: "Challenge my understanding of " },
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Source {
  name: string;
  path: string;
  score: number;
}

interface SearchResultItem {
  name: string;
  path: string;
  score: number;
  preview: string;
}

interface SearchEntry {
  id: string;
  query: string;
  results: SearchResultItem[];
}

interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreToBars(score: number): number {
  if (score >= 0.85) return 4;
  if (score >= 0.70) return 3;
  if (score >= 0.55) return 2;
  return 1;
}

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
// CitationRow
// ---------------------------------------------------------------------------

interface CitationRowProps {
  sources: Source[];
  onCitationClick?: (path: string) => void;
}

function CitationRow({ sources, onCitationClick }: CitationRowProps) {
  const deduped = Object.values(
    sources.reduce<Record<string, Source>>((acc, s) => {
      if (!acc[s.name] || s.score > acc[s.name].score) {
        acc[s.name] = s;
      }
      return acc;
    }, {})
  );

  const avgScore =
    sources.reduce((sum, s) => sum + s.score, 0) / sources.length;
  const filledBars = scoreToBars(avgScore);

  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      <div
        className="flex items-end gap-[3px] flex-shrink-0"
        title={`Confidence: ${Math.round(avgScore * 100)}%`}
        aria-label={`Confidence ${Math.round(avgScore * 100)} percent`}
      >
        {[1, 2, 3, 4].map((bar) => (
          <div
            key={bar}
            className={`signal-bar ${bar <= filledBars ? "signal-bar--filled" : "signal-bar--empty"}`}
            style={{ height: `${5 + bar * 3}px` }}
          />
        ))}
      </div>

      {deduped.map((src) => (
        <NotePreview key={src.name} notePath={src.path} noteName={src.name}>
          <span
            className="citation-chip"
            style={onCitationClick ? { cursor: "pointer" } : undefined}
            onClick={onCitationClick ? () => onCitationClick(src.path) : undefined}
            role={onCitationClick ? "button" : undefined}
            tabIndex={onCitationClick ? 0 : undefined}
            onKeyDown={
              onCitationClick
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onCitationClick(src.path);
                    }
                  }
                : undefined
            }
          >
            {`[[ ${src.name} ]]`}
          </span>
        </NotePreview>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page — wraps ChatView so we can remount by key when session changes
// ---------------------------------------------------------------------------

export default function Home() {
  const router = useRouter();
  const { logout } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [initialMessages, setInitialMessages] = useState<StoredMessage[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [indexStatus, setIndexStatus] = useState<"unknown" | "indexed" | "not_indexed">("unknown");
  const [isIndexing, setIsIndexing] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [viewerNotePath, setViewerNotePath] = useState<string | null>(null);
  // Ref to the ChatView's setInput — populated by ChatView via onInjectInput
  const chatInputSetterRef = useRef<((text: string) => void) | null>(null);

  // ------------------------------------------------------------------
  // Load index status once
  // ------------------------------------------------------------------
  useEffect(() => {
    fetch("/api/index")
      .then((r) => r.json())
      .then((d) => setIndexStatus(d.indexed ? "indexed" : "not_indexed"));
  }, []);

  // ------------------------------------------------------------------
  // Cmd+K / Ctrl+K — open command palette
  // ------------------------------------------------------------------
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  // ------------------------------------------------------------------
  // Session helpers
  // ------------------------------------------------------------------

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions");
      const data = (await res.json()) as SessionSummary[];
      setSessions(data);
      return data;
    } catch {
      return [];
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/sessions/${id}`);
      if (!res.ok) return;
      const data = (await res.json()) as { messages: StoredMessage[] };
      setInitialMessages(data.messages ?? []);
      setSessionId(id);
    } catch {
      // fall through
    }
  }, []);

  const createAndActivateSession = useCallback(async () => {
    const res = await fetch("/api/sessions", { method: "POST" });
    const session = (await res.json()) as SessionSummary;
    setSessions((prev) => [session, ...prev]);
    setInitialMessages([]);
    setSessionId(session.id);
    return session;
  }, []);

  // ------------------------------------------------------------------
  // Bootstrap: on mount load existing sessions or create a fresh one
  // ------------------------------------------------------------------
  useEffect(() => {
    (async () => {
      const list = await fetchSessions();
      if (list.length > 0) {
        await loadSession(list[0].id);
      } else {
        await createAndActivateSession();
      }
    })();
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Handlers
  // ------------------------------------------------------------------

  async function handleNewSession() {
    await createAndActivateSession();
    // Refresh sidebar list so the new session appears
    await fetchSessions();
  }

  async function handleSelectSession(id: string) {
    await loadSession(id);
    setSidebarOpen(false);
  }

  async function handleDeleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/sessions/${id}`, { method: "DELETE" });
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);

    if (sessionId === id) {
      if (remaining.length > 0) {
        await loadSession(remaining[0].id);
      } else {
        await createAndActivateSession();
      }
    }
  }

  async function handleIndex() {
    setIsIndexing(true);
    try {
      const res = await fetch("/api/index", { method: "POST" });
      const data = await res.json();
      if (data.success) setIndexStatus("indexed");
      else alert("Indexing failed: " + data.error);
    } finally {
      setIsIndexing(false);
    }
  }

  // Callback from ChatView when a new message is sent/finished — refresh
  // session list so the title and time update in the sidebar.
  const handleSessionUpdated = useCallback(async () => {
    await fetchSessions();
  }, [fetchSessions]);

  return (
    <>
    <CommandPalette
      isOpen={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      onNavigate={(href) => { setPaletteOpen(false); router.push(href); }}
      onAction={(action) => {
        setPaletteOpen(false);
        if (action === "reindex") handleIndex();
        else if (action === "new-session") handleNewSession();
      }}
      onSlashCommand={(template) => {
        setPaletteOpen(false);
        if (chatInputSetterRef.current) chatInputSetterRef.current(template);
      }}
      onSwitchSession={(sid) => { setPaletteOpen(false); loadSession(sid); }}
    />
    <div className="flex h-full cortex-bg overflow-hidden">

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className={`session-sidebar${sidebarOpen ? " session-sidebar--open" : ""}`}>

        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 py-3 border-b"
          style={{ borderColor: "var(--border-dim)" }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.6rem",
              letterSpacing: "0.16em",
              color: "var(--text-muted)",
            }}
          >
            SESSIONS
          </span>
          <button
            onClick={handleNewSession}
            className="btn-secondary text-xs px-2 py-1 rounded-sm"
            style={{ letterSpacing: "0.08em", fontSize: "0.6rem" }}
          >
            + NEW
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto py-1">
          {sessions.length === 0 && (
            <p
              className="px-3 py-4 text-center"
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.6rem",
                color: "var(--text-faint)",
              }}
            >
              NO SESSIONS
            </p>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => handleSelectSession(s.id)}
              className={`session-item${s.id === sessionId ? " session-item--active" : ""}`}
            >
              <div className="flex-1 min-w-0">
                <p className="session-item__title">{s.title}</p>
                <p className="session-item__time">{relativeTime(s.updatedAt)}</p>
              </div>
              <button
                onClick={(e) => handleDeleteSession(s.id, e)}
                className="session-item__delete"
                aria-label="Delete session"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Sidebar footer decoration */}
        <div className="px-3 py-2 border-t" style={{ borderColor: "var(--border-dim)" }}>
          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.55rem",
              color: "var(--text-faint)",
              letterSpacing: "0.1em",
            }}
          >
            MEM &nbsp;&#9472;&nbsp; PERSISTENT
          </span>
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* ── Header / HUD ────────────────────────────────────────────── */}
        <header className="flex items-center justify-between px-3 sm:px-6 py-3 hud-header-rule hud-enter relative z-10 flex-shrink-0">

          {/* Left cluster */}
          <div className="flex items-center gap-4">

            {/* Sidebar toggle */}
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="btn-secondary flex items-center justify-center rounded-sm flex-shrink-0"
              style={{ width: 28, height: 28, fontSize: "0.85rem", padding: 0 }}
              aria-label="Toggle session sidebar"
              title="Sessions"
            >
              &#8801;
            </button>

            {/* Logo */}
            <div className="relative flex-shrink-0 cortex-logo-icon">
              <VaultDNA size={36} />
              <span className="logo-bracket logo-bracket--tl" />
              <span className="logo-bracket logo-bracket--tr" />
              <span className="logo-bracket logo-bracket--bl" />
              <span className="logo-bracket logo-bracket--br" />
            </div>

            {/* Wordmark */}
            <span className="cortex-wordmark text-sm font-bold tracking-widest uppercase hidden sm:inline">
              Cortex
            </span>

            <span
              className="text-xs select-none"
              style={{ color: "var(--text-faint)", fontFamily: "var(--font-geist-mono, monospace)" }}
            >
              /
            </span>

            {/* Index status badge */}
            {indexStatus === "indexed" && (
              <span className="badge-indexed flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.08em" }}
              >
                <span className="status-dot" />
                VAULT INDEXED
              </span>
            )}
            {indexStatus === "not_indexed" && (
              <span className="badge-warn flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.08em" }}
              >
                <span className="status-dot status-dot--warn" />
                NOT INDEXED
              </span>
            )}
            {indexStatus === "unknown" && (
              <span
                className="text-xs px-2.5 py-0.5 rounded-sm"
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  letterSpacing: "0.08em",
                  color: "var(--text-muted)",
                  border: "1px solid var(--border-dim)",
                }}
              >
                SCANNING...
              </span>
            )}
          </div>

          {/* Right cluster */}
          <div className="flex items-center gap-3">

            {/* Desktop: index buttons */}
            {indexStatus === "not_indexed" && (
              <button
                onClick={handleIndex}
                disabled={isIndexing}
                className="hidden sm:flex btn-boot items-center gap-2 text-xs px-4 py-1.5 rounded-sm"
              >
                {isIndexing ? (
                  <>
                    <span className="indexing-ring" />
                    <span>BOOTING...</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: "0.6rem", opacity: 0.7 }}>&#9654;</span>
                    <span>INIT VAULT INDEX</span>
                  </>
                )}
              </button>
            )}
            {indexStatus === "indexed" && (
              <button
                onClick={handleIndex}
                disabled={isIndexing}
                className="hidden sm:flex btn-secondary items-center gap-2 text-xs px-3 py-1.5 rounded-sm"
              >
                {isIndexing ? (
                  <>
                    <span className="indexing-ring" />
                    <span>RE-INDEXING</span>
                  </>
                ) : (
                  <span>RE-INDEX</span>
                )}
              </button>
            )}

            <div
              className="hidden sm:flex items-center gap-1 select-none"
              style={{ color: "var(--text-faint)", fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.6rem" }}
            >
              <span>SYS</span>
              <span style={{ color: "var(--border-mid)" }}>|</span>
              <span>READY</span>
            </div>

            {/* Desktop nav links */}
            <nav className="hidden sm:flex items-center gap-3" aria-label="Main navigation">
              <Link
                href="/vault"
                className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.1em", fontSize: "0.6rem" }}
              >
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9707;</span>
                VAULT
              </Link>

              <Link
                href="/graph"
                className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.1em", fontSize: "0.6rem" }}
              >
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9671;</span>
                GRAPH
              </Link>

              <Link
                href="/ambient"
                className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.1em", fontSize: "0.6rem" }}
              >
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9689;</span>
                AMBIENT
              </Link>

              <Link
                href="/lineage"
                className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.1em", fontSize: "0.6rem" }}
              >
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9672;</span>
                LINEAGE
              </Link>

              <Link
                href="/clusters"
                className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.1em", fontSize: "0.6rem" }}
              >
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9678;</span>
                CLUSTERS
              </Link>

              <Link
                href="/digest"
                className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.1em", fontSize: "0.6rem" }}
              >
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9670;</span>
                DIGEST
              </Link>

              <Link
                href="/memory"
                className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.1em", fontSize: "0.6rem" }}
              >
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9673;</span>
                MEMORY
              </Link>

              <Link
                href="/settings"
                className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.1em", fontSize: "0.6rem" }}
              >
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9881;</span>
                SETTINGS
              </Link>

              <button
                onClick={logout}
                className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-sm"
                style={{ fontFamily: "var(--font-geist-mono, monospace)", letterSpacing: "0.1em", fontSize: "0.6rem" }}
              >
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9211;</span>
                LOGOUT
              </button>
            </nav>

            {/* Mobile: hamburger button */}
            <button
              className="sm:hidden btn-secondary flex items-center justify-center rounded-sm flex-shrink-0"
              style={{ width: 32, height: 32, fontSize: "1rem", padding: 0 }}
              aria-label="Open navigation menu"
              aria-expanded={mobileMenuOpen}
              onClick={() => setMobileMenuOpen((v) => !v)}
            >
              {mobileMenuOpen ? "\u2715" : "\u2630"}
            </button>
          </div>
        </header>

        {/* ── Mobile nav dropdown ──────────────────────────────────────── */}
        {mobileMenuOpen && (
          <>
            {/* Backdrop */}
            <div
              className="sm:hidden fixed inset-0 z-20"
              aria-hidden="true"
              onClick={() => setMobileMenuOpen(false)}
            />
            {/* Dropdown panel */}
            <div
              className="sm:hidden fixed right-3 z-30 flex flex-col gap-1 p-3 rounded-sm"
              style={{
                top: "calc(var(--header-height, 52px) + 4px)",
                minWidth: 180,
                background: "var(--bg-raised)",
                border: "1px solid var(--border-mid)",
                boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
                fontFamily: "var(--font-geist-mono, monospace)",
              }}
              role="menu"
              aria-label="Mobile navigation"
            >
              {/* Index action */}
              {indexStatus === "not_indexed" && (
                <button
                  onClick={() => { handleIndex(); setMobileMenuOpen(false); }}
                  disabled={isIndexing}
                  className="btn-boot flex items-center gap-2 text-xs px-3 py-2 rounded-sm w-full"
                  role="menuitem"
                >
                  {isIndexing ? (
                    <><span className="indexing-ring" /><span>BOOTING...</span></>
                  ) : (
                    <><span style={{ fontSize: "0.6rem", opacity: 0.7 }}>&#9654;</span><span>INIT VAULT INDEX</span></>
                  )}
                </button>
              )}
              {indexStatus === "indexed" && (
                <button
                  onClick={() => { handleIndex(); setMobileMenuOpen(false); }}
                  disabled={isIndexing}
                  className="btn-secondary flex items-center gap-2 text-xs px-3 py-2 rounded-sm w-full"
                  role="menuitem"
                >
                  {isIndexing ? (
                    <><span className="indexing-ring" /><span>RE-INDEXING</span></>
                  ) : (
                    <span>RE-INDEX</span>
                  )}
                </button>
              )}
              <div style={{ height: 1, background: "var(--border-dim)", margin: "4px 0" }} />
              {(
                [
                  { href: "/vault",    icon: "\u25c7", label: "VAULT"    },
                  { href: "/graph",    icon: "\u25c7", label: "GRAPH"    },
                  { href: "/ambient",  icon: "\u25c9", label: "AMBIENT"  },
                  { href: "/lineage",  icon: "\u25c8", label: "LINEAGE"  },
                  { href: "/clusters", icon: "\u25ce", label: "CLUSTERS" },
                  { href: "/digest",   icon: "\u25c6", label: "DIGEST"   },
                  { href: "/memory",   icon: "\u25c9", label: "MEMORY"   },
                  { href: "/settings", icon: "\u2699", label: "SETTINGS" },
                ] as const
              ).map(({ href, icon, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="btn-secondary flex items-center gap-2 text-xs px-3 py-2 rounded-sm"
                  style={{ letterSpacing: "0.1em", fontSize: "0.65rem" }}
                  role="menuitem"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>{icon}</span>
                  {label}
                </Link>
              ))}
              <div style={{ height: 1, background: "var(--border-dim)", margin: "4px 0" }} />
              <button
                onClick={() => { logout(); setMobileMenuOpen(false); }}
                className="btn-secondary flex items-center gap-2 text-xs px-3 py-2 rounded-sm w-full"
                style={{ letterSpacing: "0.1em", fontSize: "0.65rem" }}
                role="menuitem"
              >
                <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9211;</span>
                LOGOUT
              </button>
            </div>
          </>
        )}

        {/* ── Chat / split-pane (remounted when session changes) ─────────── */}
        {viewerNotePath !== null ? (
          <div className="split-pane">
            <div className="split-pane__chat">
              {sessionId !== null && (
                <ChatView
                  key={sessionId}
                  sessionId={sessionId}
                  initialMessages={initialMessages}
                  onSessionUpdated={handleSessionUpdated}
                  onInjectInput={(setter) => { chatInputSetterRef.current = setter; }}
                  onCitationClick={setViewerNotePath}
                />
              )}
            </div>
            <NoteViewer
              notePath={viewerNotePath}
              onClose={() => setViewerNotePath(null)}
            />
          </div>
        ) : (
          sessionId !== null && (
            <ChatView
              key={sessionId}
              sessionId={sessionId}
              initialMessages={initialMessages}
              onSessionUpdated={handleSessionUpdated}
              onInjectInput={(setter) => { chatInputSetterRef.current = setter; }}
              onCitationClick={setViewerNotePath}
            />
          )
        )}
      </div>

      {/* Sidebar backdrop (mobile / overlay close) */}
      {sidebarOpen && (
        <div
          className="session-sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
    </>
  );
}

interface ChatViewProps {
  sessionId: string;
  initialMessages: StoredMessage[];
  onSessionUpdated: () => void;
  onInjectInput?: (setter: (text: string) => void) => void;
  onCitationClick?: (path: string) => void;
}

// ---------------------------------------------------------------------------
// SearchCard
// ---------------------------------------------------------------------------

interface SearchCardProps {
  entry: SearchEntry;
}

function SearchCard({ entry }: SearchCardProps) {
  return (
    <div className="search-card">
      <div className="search-card__header">
        <span className="search-card__title">
          VAULT SEARCH &mdash; <strong>&ldquo;{entry.query}&rdquo;</strong>
        </span>
        <span className="search-card__count">
          {entry.results.length} RESULT{entry.results.length !== 1 ? "S" : ""}
        </span>
      </div>

      {entry.results.length === 0 ? (
        <div
          className="px-4 py-5 text-center"
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.65rem",
            letterSpacing: "0.1em",
            color: "var(--text-muted)",
          }}
        >
          NO MATCHES FOUND
        </div>
      ) : (
        entry.results.map((r, i) => (
          <div key={i} className="search-result-row">
            <span className="search-result-row__name">{r.name}</span>
            <span className="search-result-row__score">
              {Math.round(r.score * 100)}%
            </span>
            <span className="search-result-row__path">{r.path}</span>
            {r.preview && (
              <p className="search-result-row__preview">{r.preview}</p>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SlashMenu
// ---------------------------------------------------------------------------

interface SlashMenuProps {
  commands: readonly SlashCommand[];
  activeIndex: number;
  onSelect: (cmd: SlashCommand) => void;
}

function SlashMenu({ commands, activeIndex, onSelect }: SlashMenuProps) {
  if (commands.length === 0) return null;
  return (
    <div className="slash-menu" role="listbox" aria-label="Slash command suggestions">
      {commands.map((c, i) => (
        <button
          key={c.cmd}
          role="option"
          aria-selected={i === activeIndex}
          className={`slash-menu-item${i === activeIndex ? " slash-menu-item--active" : ""}`}
          onMouseDown={(e) => {
            // Prevent textarea blur before we can fill it
            e.preventDefault();
            onSelect(c);
          }}
        >
          <span className="slash-menu-item__cmd">{c.cmd}</span>
          <span className="slash-menu-item__label">{c.label}</span>
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatView — isolated so remounting on key change resets useChat state
// ---------------------------------------------------------------------------

function ChatView({ sessionId, initialMessages, onSessionUpdated, onInjectInput, onCitationClick }: ChatViewProps) {
  const [input, setInput] = useState("");
  const [searchEntries, setSearchEntries] = useState<SearchEntry[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);
  const [savedNotes, setSavedNotes] = useState<Set<string>>(new Set());
  const [pendingImages, setPendingImages] = useState<Array<{ file: File; preview: string }>>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Expose setInput to the parent so the command palette can inject text
  useEffect(() => {
    if (!onInjectInput) return;
    onInjectInput((text: string) => {
      setInput(text);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(text.length, text.length);
        }
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onInjectInput]);

  // State to trigger auto-send after voice recognition completes
  const [pendingVoiceText, setPendingVoiceText] = useState<string | null>(null);

  const { isListening, isSupported: voiceSupported, startListening, stopListening } = useVoiceInput(
    (text, isFinal) => {
      if (isFinal) {
        // Auto-send: store the final transcript and clear UI state
        setInput("");
        setLiveTranscript("");
        setPendingVoiceText(text);
      } else {
        setLiveTranscript(text);
      }
    }
  );

  const { isSpeaking, isSupported: ttsSupported, speak, stop: stopSpeaking } = useTTS();
  const [autoSpeak, setAutoSpeak] = useState(false);

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: { sessionId },
    }),
    // StoredMessage is structurally compatible with UIMessage — same id/role/parts shape.
    messages: initialMessages as unknown as UIMessage[],
    onFinish: ({ message }) => {
      onSessionUpdated();
      if (autoSpeak) {
        const text = message.parts
          .filter(isTextUIPart)
          .map((p) => p.text)
          .join("");
        if (text) speak(text);
      }
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Extract source-url parts from the streaming assistant message so the
  // ContextWindow can show which vault nodes are being pulled in real-time.
  const streamingSources = (() => {
    if (!isLoading) return [];
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return [];
    return lastMsg.parts
      .filter((p): p is SourceUrlUIPart => p.type === "source-url")
      .map((p) => ({
        name: p.title ?? p.url,
        path: p.url,
        score: parseFloat(p.sourceId.split("|")[1] ?? "0"),
      }));
  })();

  // Auto-send voice transcript once sendMessage is available
  useEffect(() => {
    if (pendingVoiceText && !isLoading) {
      const text = pendingVoiceText;
      setPendingVoiceText(null);
      sendMessage({ parts: [{ type: "text", text }] });
    }
  }, [pendingVoiceText, isLoading, sendMessage]);

  // Detect /search mode — case-insensitive, must start the input
  const isSearchMode = /^\/search /i.test(input);

  // Slash command menu: visible when input starts with "/" but is NOT "/search "
  // and the user hasn't yet committed to free text after a command selection.
  const slashMenuVisible =
    input.startsWith("/") &&
    !isSearchMode &&
    // Hide once a full command has been selected (input matches a full template)
    !SLASH_COMMANDS.some((c) => input === c.template) &&
    // Hide once the user has moved past any partial command token (space after non-command text)
    (() => {
      const token = input.split(" ")[0].toLowerCase();
      return SLASH_COMMANDS.some((c) => c.cmd.startsWith(token));
    })();

  const filteredCommands = slashMenuVisible
    ? SLASH_COMMANDS.filter((c) =>
        c.cmd.startsWith(input.split(" ")[0].toLowerCase())
      )
    : ([] as unknown as typeof SLASH_COMMANDS);

  function selectSlashCommand(cmd: SlashCommand) {
    setInput(cmd.template);
    setSlashActiveIndex(0);
    // Move cursor to end on next tick after state update
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(cmd.template.length, cmd.template.length);
      }
    });
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, searchEntries]);

  async function handleSearch(rawInput: string) {
    const query = rawInput.replace(/^\/search\s+/i, "").trim();
    if (!query) return;

    setIsSearching(true);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, topK: 6 }),
      });
      const data = (await res.json()) as
        | { results: SearchResultItem[] }
        | { error: string };

      const results = "results" in data ? data.results : [];
      const entry: SearchEntry = {
        id: `search-${Date.now()}`,
        query,
        results,
      };
      setSearchEntries((prev) => [...prev, entry]);
    } catch {
      const entry: SearchEntry = {
        id: `search-${Date.now()}`,
        query,
        results: [],
      };
      setSearchEntries((prev) => [...prev, entry]);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleSaveNote(messageId: string, text: string, sources: Source[]) {
    const defaultTitle = text.trim().slice(0, 40).replace(/\s+/g, " ").trim();
    const title = window.prompt("Save as note — enter a title:", defaultTitle);
    if (!title || !title.trim()) return;

    setSavingNoteId(messageId);
    try {
      const sourcePaths = sources.map((s) => s.path);
      const res = await fetch("/api/notes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: text, sourcePaths, sessionId }),
      });
      if (res.ok || res.status === 409) {
        setSavedNotes((prev) => new Set(prev).add(messageId));
      } else {
        const data = (await res.json()) as { error?: string };
        alert("Failed to save note: " + (data.error ?? res.statusText));
      }
    } catch {
      alert("Failed to save note: network error");
    } finally {
      setSavingNoteId(null);
    }
  }

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();

    if (isSearchMode) {
      if (!input.trim()) return;
      if (isSearching) return;
      handleSearch(input);
      setInput("");
      return;
    }

    if (isLoading) return;

    if (pendingImages.length > 0) {
      const imageParts = await Promise.all(
        pendingImages.map(async (img) => {
          const buffer = await img.file.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
          return {
            type: "file" as const,
            url: `data:${img.file.type};base64,${base64}`,
            mediaType: img.file.type,
          };
        })
      );

      sendMessage({
        parts: [
          ...imageParts,
          { type: "text" as const, text: input || "What do you see in this image?" },
        ],
      });

      // Clean up preview URLs
      pendingImages.forEach((img) => URL.revokeObjectURL(img.preview));
      setPendingImages([]);
      setInput("");
      return;
    }

    if (!input.trim()) return;
    sendMessage({ parts: [{ type: "text", text: input }] });
    setInput("");
  }

  return (
    <>
      {/* ── Context Window — shows vault nodes being pulled during streaming ── */}
      <ContextWindow sources={streamingSources} isStreaming={isLoading} />

      {/* ── Message feed ──────────────────────────────────────────────── */}
      <main
        className="flex-1 overflow-y-auto px-4 py-8 min-h-0 relative"
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
          for (const file of files) {
            const preview = URL.createObjectURL(file);
            setPendingImages(prev => [...prev, { file, preview }]);
          }
        }}
      >
        {/* Drop overlay */}
        {isDragOver && (
          <div className="drop-overlay">
            <span className="drop-overlay__label">DROP IMAGE</span>
          </div>
        )}
        <div className="max-w-2xl mx-auto flex flex-col gap-5">

          {/* Empty state */}
          {messages.length === 0 && searchEntries.length === 0 && (
            <div className="flex flex-col items-center justify-center h-72 gap-6 text-center">
              <div className="relative flex items-center justify-center">
                <div
                  className="absolute rounded-full empty-state-ring"
                  style={{ width: 72, height: 72, animationDelay: "0s" }}
                />
                <div
                  className="absolute rounded-full empty-state-ring"
                  style={{ width: 52, height: 52, animationDelay: "0.8s", opacity: 0.5 }}
                />
                <div
                  className="avatar-cortex flex items-center justify-center"
                  style={{ width: 36, height: 36 }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono, monospace)",
                      fontSize: "0.6rem",
                      fontWeight: 700,
                      color: "#020408",
                    }}
                  >
                    CX
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <p
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.7rem",
                    letterSpacing: "0.18em",
                    color: "var(--cyan-mid)",
                    textTransform: "uppercase",
                  }}
                >
                  CORTEX NEURAL INTERFACE
                </p>
                <p
                  className="text-sm max-w-xs leading-relaxed"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Initialise a query. Cortex will traverse your knowledge vault and synthesise a response from linked nodes.
                </p>
                <p
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.65rem",
                    color: "var(--text-muted)",
                    letterSpacing: "0.1em",
                    marginTop: "0.5rem",
                  }}
                >
                  &#9642; AWAITING INPUT &#9642;
                </p>
              </div>
            </div>
          )}

          {/* Messages */}
          {(() => {
            const lastAssistantIndex = messages.reduce(
              (last, m, i) => (m.role === "assistant" ? i : last),
              -1
            );
            return messages.map((m, index) => {
              const text = m.parts.filter(isTextUIPart).map((p) => p.text).join("");
              const isUser = m.role === "user";
              const showCursor = isLoading && index === lastAssistantIndex;

              // Skip assistant messages with no text yet (source-url parts
              // arrive before text starts streaming, causing a blank bubble)
              if (!isUser && !text && !showCursor) return null;

              const sources: Source[] = !isUser
                ? m.parts
                    .filter((p): p is SourceUrlUIPart => p.type === "source-url")
                    .map((p) => ({
                      name: p.title ?? p.url,
                      path: p.url,
                      score: parseFloat(p.sourceId.split("|")[1] ?? "0"),
                    }))
                : [];

              return (
                <div
                  key={m.id}
                  className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
                >
                  {/* Avatar */}
                  <div className="flex-shrink-0 flex flex-col items-center gap-1.5">
                    <div
                      className={`flex items-center justify-center ${isUser ? "avatar-user" : "avatar-cortex"}`}
                      style={{ width: 30, height: 30 }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono, monospace)",
                          fontSize: "0.55rem",
                          fontWeight: 700,
                          color: isUser ? "var(--cyan-bright)" : "#020408",
                          letterSpacing: "0.03em",
                        }}
                      >
                        {isUser ? "USR" : "CX"}
                      </span>
                    </div>
                  </div>

                  {/* Bubble + citations */}
                  <div className="flex flex-col gap-1 max-w-prose">
                    <span
                      style={{
                        fontFamily: "var(--font-geist-mono, monospace)",
                        fontSize: "0.6rem",
                        letterSpacing: "0.14em",
                        color: isUser ? "var(--cyan-mid)" : "var(--text-muted)",
                        textAlign: isUser ? "right" : "left",
                      }}
                    >
                      {isUser ? "OPERATOR" : "CORTEX"}
                    </span>

                    <div
                      className={`px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap rounded-sm ${
                        isUser ? "msg-user" : "msg-assistant"
                      }`}
                      style={{ color: "var(--text-primary)" }}
                    >
                      {text}
                      {showCursor && (
                        <span
                          style={{
                            animation: "blink-cursor 0.7s step-end infinite",
                            fontFamily: "monospace",
                            fontSize: "inherit",
                            color: "var(--cyan-bright)",
                            marginLeft: "1px",
                          }}
                        >
                          █
                        </span>
                      )}
                    </div>

                    {!isUser && ttsSupported && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isSpeaking) {
                            stopSpeaking();
                          } else {
                            speak(text);
                          }
                        }}
                        className={`btn-tts${isSpeaking ? " btn-tts--active" : ""}`}
                        title={isSpeaking ? "Stop speaking" : "Read aloud"}
                      >
                        {isSpeaking ? "STOP" : "SPEAK"}
                      </button>
                    )}

                    {!isUser && text && (
                      <button
                        type="button"
                        disabled={savedNotes.has(m.id) || savingNoteId === m.id}
                        onClick={() => handleSaveNote(m.id, text, sources)}
                        className={`btn-save-note${savedNotes.has(m.id) ? " btn-save-note--saved" : ""}`}
                        title="Save this response as an Obsidian note"
                      >
                        {savingNoteId === m.id ? (
                          <>
                            <span className="indexing-ring" style={{ width: 8, height: 8 }} />
                            SAVING
                          </>
                        ) : savedNotes.has(m.id) ? (
                          <>&#10003; SAVED</>
                        ) : (
                          "SAVE AS NOTE"
                        )}
                      </button>
                    )}

                    {sources.length > 0 && <CitationRow sources={sources} onCitationClick={onCitationClick} />}
                  </div>
                </div>
              );
            });
          })()}

          {/* Search result cards */}
          {searchEntries.map((entry) => (
            <SearchCard key={entry.id} entry={entry} />
          ))}

          {/* Search-in-progress indicator */}
          {isSearching && (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-sm"
              style={{
                background: "var(--bg-raised)",
                border: "1px solid var(--border-dim)",
                borderLeft: "3px solid var(--cyan-mid)",
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
                  letterSpacing: "0.12em",
                  color: "var(--cyan-mid)",
                }}
              >
                SCANNING VAULT...
              </span>
            </div>
          )}

          {/* Loading / scanning indicator */}
          {isLoading && (
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <div
                  className="avatar-cortex flex items-center justify-center"
                  style={{ width: 30, height: 30 }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono, monospace)",
                      fontSize: "0.55rem",
                      fontWeight: 700,
                      color: "#020408",
                    }}
                  >
                    CX
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    letterSpacing: "0.14em",
                    color: "var(--text-muted)",
                  }}
                >
                  CORTEX
                </span>
                <div className="msg-assistant px-4 py-3 rounded-sm flex items-center gap-3">
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
                      letterSpacing: "0.12em",
                      color: "var(--cyan-mid)",
                    }}
                  >
                    TRAVERSING VAULT...
                  </span>
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* ── Input / terminal bar ────────────────────────────────────────── */}
      <div className="px-4 pb-3 sm:pb-6 pt-3 hud-footer-rule relative z-10 flex-shrink-0">
        <div className="max-w-2xl mx-auto">

          {/* Image preview strip */}
          {pendingImages.length > 0 && (
            <div className="image-preview-strip mb-2">
              {pendingImages.map((img, i) => (
                <div key={i} className="image-preview-thumb">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.preview} alt={`Pending image ${i + 1}`} />
                  <button
                    type="button"
                    className="image-preview-thumb__remove"
                    aria-label="Remove image"
                    onClick={() => {
                      URL.revokeObjectURL(img.preview);
                      setPendingImages((prev) => prev.filter((_, idx) => idx !== i));
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Hidden file input for image picker */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label="Attach images"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []).filter((f) =>
                f.type.startsWith("image/")
              );
              for (const file of files) {
                const preview = URL.createObjectURL(file);
                setPendingImages((prev) => [...prev, { file, preview }]);
              }
              e.target.value = "";
            }}
          />

          {/* Search mode badge */}
          {isSearchMode && (
            <div className="mb-2 flex items-center gap-2">
              <span className="search-mode-badge">
                <span className="search-mode-badge__dot" />
                SEARCH MODE
                <span className="search-mode-badge__esc">
                  &nbsp;&mdash;&nbsp; raw vault query, no AI synthesis
                </span>
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.55rem",
                  letterSpacing: "0.1em",
                  color: "var(--text-faint)",
                }}
              >
                ESC to cancel
              </span>
            </div>
          )}

          <form onSubmit={handleSend} className="flex gap-3 items-end">

            <div className="flex-1 relative">
              <span
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none select-none"
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.75rem",
                  color: isSearchMode ? "var(--cyan-bright)" : "var(--cyan-mid)",
                  lineHeight: 1,
                  transition: "color 0.15s ease",
                }}
              >
                {isSearchMode ? "/\u2315" : ">_"}
              </span>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Slash menu keyboard navigation
                  if (slashMenuVisible && filteredCommands.length > 0) {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setSlashActiveIndex((i) => (i + 1) % filteredCommands.length);
                      return;
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setSlashActiveIndex((i) =>
                        i === 0 ? filteredCommands.length - 1 : i - 1
                      );
                      return;
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      selectSlashCommand(filteredCommands[slashActiveIndex]);
                      return;
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setInput("");
                      setSlashActiveIndex(0);
                      return;
                    }
                  }

                  if (e.key === "Escape" && isSearchMode) {
                    e.preventDefault();
                    setInput("");
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={isSearchMode ? "enter search query..." : "query the vault..."}
                rows={1}
                className="cortex-input w-full rounded-sm pl-10 pr-4 py-3 max-h-40 overflow-y-auto"
                style={
                  isSearchMode
                    ? { borderColor: "var(--border-bright)", boxShadow: "var(--shadow-glow-md), inset 0 0 16px rgba(34,211,238,0.04)" }
                    : undefined
                }
              />
            </div>

            {/* Auto-speak toggle — hidden on mobile to save space */}
            {ttsSupported && (
              <button
                type="button"
                onClick={() => setAutoSpeak((v) => !v)}
                className={`hidden sm:flex btn-auto-speak px-3 py-3 rounded-sm flex-shrink-0${autoSpeak ? " btn-auto-speak--on" : ""}`}
                title={autoSpeak ? "Auto-speak on — click to turn off" : "Auto-speak off — click to enable"}
              >
                {autoSpeak ? "VOICE ON" : "VOICE OFF"}
              </button>
            )}

            {/* Mic button */}
            {voiceSupported && (
              <button
                type="button"
                onClick={() => {
                  if (isListening) {
                    stopListening();
                  } else {
                    startListening();
                    setAutoSpeak(true); // Enable auto-speak when mic activates
                  }
                }}
                className={`btn-mic px-3 py-3 rounded-sm text-xs font-bold flex-shrink-0${isListening ? " btn-mic--listening" : ""}`}
                title={isListening ? "Stop listening" : "Voice input"}
              >
                MIC
              </button>
            )}

            {/* Image attach button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-image flex-shrink-0"
              title="Attach image"
              aria-label="Attach image"
            >
              IMG
            </button>

            <button
              type="submit"
              disabled={(isSearchMode ? isSearching : isLoading) || (!input.trim() && pendingImages.length === 0)}
              className="btn-send px-5 py-3 rounded-sm text-xs font-bold flex-shrink-0"
            >
              {isSearchMode ? "SCAN" : "SEND"}
            </button>
          </form>

          {/* Live voice transcript */}
          {isListening && liveTranscript && (
            <p style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.7rem",
              color: "var(--cyan-mid)",
              marginTop: "0.4rem",
              opacity: 0.8,
            }}>
              {liveTranscript}
            </p>
          )}

          <p className="hidden sm:block text-center hud-hint mt-2.5">
            {isSearchMode
              ? "ENTER \u2472 SCAN VAULT \u3000 ESC \u2472 CANCEL SEARCH"
              : "SHIFT+ENTER \u00a0\u2500\u00a0 NEW LINE \u00a0\u00a0\u2502\u00a0\u00a0 ENTER \u00a0\u2500\u00a0 TRANSMIT"}
          </p>
        </div>
      </div>
    </>
  );
}
