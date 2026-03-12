"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

type CommandCategory = "NAVIGATE" | "ACTION" | "COMMAND" | "SESSION";

interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  action: string;
  href?: string;
  template?: string;
  sessionId?: string;
}

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (href: string) => void;
  onAction: (action: string) => void;
  onSlashCommand: (template: string) => void;
  onSwitchSession: (sessionId: string) => void;
}

// ---------------------------------------------------------------------------
// Static commands
// ---------------------------------------------------------------------------

const STATIC_COMMANDS: Command[] = [
  { id: "nav-home",     label: "Go to Chat",            category: "NAVIGATE", action: "navigate", href: "/" },
  { id: "nav-vault",    label: "Go to Vault Dashboard", category: "NAVIGATE", action: "navigate", href: "/vault" },
  { id: "nav-graph",    label: "Go to Graph Explorer",  category: "NAVIGATE", action: "navigate", href: "/graph" },
  { id: "nav-ambient",  label: "Go to Ambient Mode",    category: "NAVIGATE", action: "navigate", href: "/ambient" },
  { id: "nav-lineage",  label: "Go to Thought Lineage", category: "NAVIGATE", action: "navigate", href: "/lineage" },
  { id: "nav-digest",   label: "Go to Daily Digest",    category: "NAVIGATE", action: "navigate", href: "/digest" },
  { id: "nav-clusters", label: "Go to Topic Clusters",  category: "NAVIGATE", action: "navigate", href: "/clusters" },
  { id: "act-reindex",     label: "Re-index Vault",       category: "ACTION", action: "reindex" },
  { id: "act-new-session", label: "New Chat Session",      category: "ACTION", action: "new-session" },
  { id: "act-focus",       label: "Toggle Focus Mode",     category: "ACTION", action: "focus" },
  { id: "cmd-summarize",   label: "/summarize — Summarize a topic",      category: "COMMAND", action: "slash", template: "Summarize everything I know about " },
  { id: "cmd-connections", label: "/connections — Find connections",      category: "COMMAND", action: "slash", template: "What connections exist between " },
  { id: "cmd-gaps",        label: "/gaps — Knowledge gaps",               category: "COMMAND", action: "slash", template: "What am I missing or haven't written about regarding " },
  { id: "cmd-explain",     label: "/explain — Explain concept",           category: "COMMAND", action: "slash", template: "Explain the concept of " },
  { id: "cmd-debate",      label: "/debate — Challenge my knowledge",     category: "COMMAND", action: "slash", template: "Challenge my understanding of " },
  { id: "cmd-web",         label: "/web — Web search",                    category: "COMMAND", action: "slash", template: "/web " },
  { id: "cmd-search",      label: "/search — Vault search",               category: "COMMAND", action: "slash", template: "/search " },
];

const CATEGORY_ORDER: CommandCategory[] = ["NAVIGATE", "ACTION", "COMMAND", "SESSION"];

// ---------------------------------------------------------------------------
// Fuzzy match: each character of query must appear in order in label
// ---------------------------------------------------------------------------

function fuzzyMatch(label: string, query: string): boolean {
  if (!query) return true;
  const lower = label.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CommandPalette({
  isOpen,
  onClose,
  onNavigate,
  onAction,
  onSlashCommand,
  onSwitchSession,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeItemRef = useRef<HTMLButtonElement>(null);

  // Fetch sessions whenever palette opens
  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setActiveIndex(0);
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((data: SessionSummary[]) => setSessions(Array.isArray(data) ? data : []))
      .catch(() => setSessions([]));
  }, [isOpen]);

  // Focus input when open
  useEffect(() => {
    if (isOpen) {
      // Small tick to ensure the element is rendered and visible
      const id = setTimeout(() => inputRef.current?.focus(), 20);
      return () => clearTimeout(id);
    }
  }, [isOpen]);

  // Build dynamic session commands
  const sessionCommands: Command[] = sessions.map((s) => ({
    id: `session-${s.id}`,
    label: `Switch to: ${s.title}`,
    category: "SESSION" as CommandCategory,
    action: "switch-session",
    sessionId: s.id,
  }));

  const allCommands: Command[] = [...STATIC_COMMANDS, ...sessionCommands];

  // Filter by query
  const filtered = allCommands.filter((c) => fuzzyMatch(c.label, query));

  // Group by category in defined order
  const grouped: { category: CommandCategory; items: Command[] }[] = CATEGORY_ORDER
    .map((cat) => ({
      category: cat,
      items: filtered.filter((c) => c.category === cat),
    }))
    .filter((g) => g.items.length > 0);

  // Flat ordered list for keyboard navigation
  const flatFiltered: Command[] = grouped.flatMap((g) => g.items);

  // Keep activeIndex in range when filtered list changes
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  const executeCommand = useCallback(
    (cmd: Command) => {
      onClose();
      if (cmd.action === "navigate" && cmd.href) {
        onNavigate(cmd.href);
      } else if (cmd.action === "slash" && cmd.template) {
        onSlashCommand(cmd.template);
      } else if (cmd.action === "switch-session" && cmd.sessionId) {
        onSwitchSession(cmd.sessionId);
      } else {
        onAction(cmd.action);
      }
    },
    [onClose, onNavigate, onSlashCommand, onSwitchSession, onAction]
  );

  // Keyboard handler on the input
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatFiltered.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const cmd = flatFiltered[activeIndex];
      if (cmd) executeCommand(cmd);
      return;
    }
  }

  if (!isOpen) return null;

  // Build a map from command id to flat index for highlighting
  const indexMap = new Map<string, number>(flatFiltered.map((c, i) => [c.id, i]));

  return (
    <div
      className="cmd-palette-backdrop"
      onMouseDown={(e) => {
        // Close when clicking the backdrop (not the palette itself)
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div className="cmd-palette">
        {/* Search input */}
        <input
          ref={inputRef}
          type="text"
          className="cmd-palette__input"
          placeholder="TYPE A COMMAND OR SEARCH..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          aria-label="Command search"
          autoComplete="off"
          spellCheck={false}
        />

        {/* Results */}
        <div className="cmd-palette__results" role="listbox">
          {flatFiltered.length === 0 ? (
            <p className="cmd-palette__empty">NO COMMANDS FOUND</p>
          ) : (
            grouped.map(({ category, items }) => (
              <div key={category}>
                <p className="cmd-palette__category">{category}</p>
                {items.map((cmd) => {
                  const flatIdx = indexMap.get(cmd.id) ?? 0;
                  const isActive = flatIdx === activeIndex;
                  return (
                    <button
                      key={cmd.id}
                      ref={isActive ? activeItemRef : undefined}
                      role="option"
                      aria-selected={isActive}
                      className={`cmd-palette__item${isActive ? " cmd-palette__item--active" : ""}`}
                      onMouseEnter={() => setActiveIndex(flatIdx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        executeCommand(cmd);
                      }}
                    >
                      <span>{cmd.label}</span>
                      <span className="cmd-palette__item-badge">{cmd.category}</span>
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Hint bar */}
        <div className="cmd-palette__hint" aria-hidden="true">
          <span>&#8593;&#8595; NAVIGATE</span>
          <span>&#9166; SELECT</span>
          <span>ESC CLOSE</span>
        </div>
      </div>
    </div>
  );
}
