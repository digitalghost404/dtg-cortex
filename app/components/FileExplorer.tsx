"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { relativeTime } from "@/lib/time-utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TreeNote {
  name: string;
  path: string;
  folder: string;
  words: number;
  tags: string[];
  modifiedAt: string;
}

interface FolderNode {
  name: string;
  fullPath: string;
  children: FolderNode[];
  notes: TreeNote[];
}

interface FileExplorerProps {
  open: boolean;
  onClose: () => void;
  onSelectNote: (path: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildTree(notes: TreeNote[]): FolderNode {
  const root: FolderNode = { name: "(root)", fullPath: "", children: [], notes: [] };

  for (const note of notes) {
    if (note.folder === "(root)") {
      root.notes.push(note);
      continue;
    }

    const parts = note.folder.split("/");
    let current = root;

    for (const part of parts) {
      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          fullPath: current.fullPath ? `${current.fullPath}/${part}` : part,
          children: [],
          notes: [],
        };
        current.children.push(child);
        // Keep children sorted
        current.children.sort((a, b) => a.name.localeCompare(b.name));
      }
      current = child;
    }

    current.notes.push(note);
  }

  return root;
}

function countAllNotes(node: FolderNode): number {
  return (
    node.notes.length +
    node.children.reduce((sum, child) => sum + countAllNotes(child), 0)
  );
}


// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FolderItem({
  node,
  depth,
  expandedSet,
  onToggle,
  onSelectNote,
  filterText,
}: {
  node: FolderNode;
  depth: number;
  expandedSet: Set<string>;
  onToggle: (path: string) => void;
  onSelectNote: (path: string) => void;
  filterText: string;
}) {
  const isExpanded = expandedSet.has(node.fullPath);
  const noteCount = countAllNotes(node);

  // Filter notes
  const filteredNotes = filterText
    ? node.notes.filter(
        (n) =>
          n.name.toLowerCase().includes(filterText) ||
          n.tags.some((t) => t.toLowerCase().includes(filterText))
      )
    : node.notes;

  // If filtering and nothing matches in this subtree, hide
  const hasMatchingChildren = filterText
    ? node.children.some((c) => hasMatches(c, filterText))
    : true;

  if (filterText && filteredNotes.length === 0 && !hasMatchingChildren) {
    return null;
  }

  return (
    <>
      <button
        onClick={() => onToggle(node.fullPath)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          width: "100%",
          padding: `4px 8px 4px ${8 + depth * 16}px`,
          background: "none",
          border: "none",
          borderBottom: "1px solid var(--border-dim)",
          cursor: "pointer",
          textAlign: "left",
          transition: "background 0.1s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(34,211,238,0.04)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background = "none";
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.55rem",
            color: "var(--cyan-mid)",
            width: "0.6rem",
            flexShrink: 0,
            transition: "transform 0.15s",
            transform: isExpanded ? "rotate(90deg)" : "none",
          }}
        >
          &#9656;
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            letterSpacing: "0.06em",
            color: "var(--text-secondary)",
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {node.name}
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.5rem",
            color: "var(--text-faint)",
            flexShrink: 0,
          }}
        >
          {noteCount}
        </span>
      </button>

      {isExpanded && (
        <>
          {node.children.map((child) => (
            <FolderItem
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              expandedSet={expandedSet}
              onToggle={onToggle}
              onSelectNote={onSelectNote}
              filterText={filterText}
            />
          ))}
          {filteredNotes.map((note) => (
            <NoteItem
              key={note.path}
              note={note}
              depth={depth + 1}
              onSelect={onSelectNote}
            />
          ))}
        </>
      )}
    </>
  );
}

function NoteItem({
  note,
  depth,
  onSelect,
}: {
  note: TreeNote;
  depth: number;
  onSelect: (path: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(note.path)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.35rem",
        width: "100%",
        padding: `4px 8px 4px ${8 + depth * 16 + 14}px`,
        background: "none",
        border: "none",
        borderBottom: "1px solid var(--border-dim)",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 0.1s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background =
          "rgba(34,211,238,0.06)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "none";
      }}
      title={note.path}
    >
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.45rem",
          color: "var(--text-faint)",
          flexShrink: 0,
        }}
      >
        &#9724;
      </span>
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.6rem",
          color: "var(--text-primary)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          letterSpacing: "0.02em",
        }}
      >
        {note.name}
      </span>
      <span
        style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.45rem",
          color: "var(--text-faint)",
          flexShrink: 0,
          letterSpacing: "0.06em",
        }}
      >
        {relativeTime(note.modifiedAt, true)}
      </span>
    </button>
  );
}

function hasMatches(node: FolderNode, filter: string): boolean {
  if (node.notes.some((n) => n.name.toLowerCase().includes(filter) || n.tags.some((t) => t.toLowerCase().includes(filter)))) {
    return true;
  }
  return node.children.some((c) => hasMatches(c, filter));
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function FileExplorer({ open, onClose, onSelectNote }: FileExplorerProps) {
  const [notes, setNotes] = useState<TreeNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const filterRef = useRef<HTMLInputElement>(null);
  const hasFetched = useRef(false);

  // Fetch tree data when opened
  useEffect(() => {
    if (!open) return;
    if (hasFetched.current && notes.length > 0) return;

    setLoading(true);
    setError(null);

    fetch("/api/vault/tree")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { notes: TreeNote[] }) => {
        setNotes(data.notes);
        hasFetched.current = true;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));
  }, [open, notes.length]);

  // Focus filter input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => filterRef.current?.focus(), 150);
    }
  }, [open]);

  // Build tree
  const tree = useMemo(() => buildTree(notes), [notes]);

  // Filter
  const filterText = filter.trim().toLowerCase();

  // Filtered root notes
  const filteredRootNotes = filterText
    ? tree.notes.filter(
        (n) =>
          n.name.toLowerCase().includes(filterText) ||
          n.tags.some((t) => t.toLowerCase().includes(filterText))
      )
    : tree.notes;

  // Toggle folder
  const toggleFolder = useCallback((path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Expand all / collapse all
  const expandAll = useCallback(() => {
    const all = new Set<string>();
    function collect(node: FolderNode) {
      if (node.fullPath) all.add(node.fullPath);
      node.children.forEach(collect);
    }
    collect(tree);
    setExpandedFolders(all);
  }, [tree]);

  const collapseAll = useCallback(() => {
    setExpandedFolders(new Set());
  }, []);

  // Auto-expand all when filtering
  useEffect(() => {
    if (filterText) expandAll();
  }, [filterText, expandAll]);

  // Handle note selection
  const handleSelect = useCallback(
    (path: string) => {
      onSelectNote(path);
    },
    [onSelectNote]
  );

  // Refresh
  const handleRefresh = useCallback(() => {
    hasFetched.current = false;
    setNotes([]);
    setLoading(true);
    setError(null);

    fetch("/api/vault/tree")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { notes: TreeNote[] }) => {
        setNotes(data.notes);
        hasFetched.current = true;
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {/* Sidebar */}
      <aside
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(340px, 85vw)",
          background: "var(--bg-deep)",
          borderLeft: "1px solid var(--border-dim)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease",
          boxShadow: open ? "-4px 0 20px rgba(0,0,0,0.3)" : "none",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.6rem 0.75rem",
            borderBottom: "1px solid var(--border-dim)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.6rem",
              letterSpacing: "0.16em",
              color: "var(--cyan-bright)",
            }}
          >
            FILE EXPLORER
          </span>
          <div style={{ display: "flex", gap: "0.3rem" }}>
            <button
              onClick={handleRefresh}
              disabled={loading}
              style={{
                background: "none",
                border: "1px solid var(--border-dim)",
                borderRadius: "2px",
                padding: "2px 6px",
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.5rem",
                color: "var(--text-muted)",
                letterSpacing: "0.1em",
              }}
            >
              {loading ? "..." : "REFRESH"}
            </button>
            <button
              onClick={expandedFolders.size > 0 ? collapseAll : expandAll}
              style={{
                background: "none",
                border: "1px solid var(--border-dim)",
                borderRadius: "2px",
                padding: "2px 6px",
                cursor: "pointer",
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.5rem",
                color: "var(--text-muted)",
                letterSpacing: "0.1em",
              }}
            >
              {expandedFolders.size > 0 ? "COLLAPSE" : "EXPAND"}
            </button>
            <button
              onClick={onClose}
              style={{
                background: "none",
                border: "1px solid var(--border-dim)",
                borderRadius: "2px",
                width: 22,
                height: 22,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.7rem",
                color: "var(--text-muted)",
              }}
            >
              &times;
            </button>
          </div>
        </div>

        {/* Filter */}
        <div style={{ padding: "0.5rem 0.75rem", flexShrink: 0 }}>
          <input
            ref={filterRef}
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter notes..."
            style={{
              width: "100%",
              padding: "0.4rem 0.6rem",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-dim)",
              borderRadius: "2px",
              color: "var(--text-primary)",
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.65rem",
              outline: "none",
            }}
            onFocus={(e) => {
              (e.currentTarget as HTMLInputElement).style.borderColor =
                "var(--border-mid)";
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLInputElement).style.borderColor =
                "var(--border-dim)";
            }}
          />
        </div>

        {/* Note count */}
        <div
          style={{
            padding: "0 0.75rem 0.4rem",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.5rem",
              letterSpacing: "0.12em",
              color: "var(--text-faint)",
            }}
          >
            {notes.length} NOTES
            {filterText && ` (FILTERING)`}
          </span>
        </div>

        {/* Tree content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {loading && notes.length === 0 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "3rem 1rem",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.6rem",
                  letterSpacing: "0.14em",
                  color: "var(--text-faint)",
                }}
              >
                LOADING...
              </span>
            </div>
          )}

          {error && (
            <div style={{ padding: "1rem 0.75rem" }}>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.6rem",
                  color: "#f87171",
                  letterSpacing: "0.1em",
                }}
              >
                ERROR: {error}
              </span>
            </div>
          )}

          {!loading && !error && notes.length > 0 && (
            <>
              {/* Folders */}
              {tree.children.map((child) => (
                <FolderItem
                  key={child.fullPath}
                  node={child}
                  depth={0}
                  expandedSet={expandedFolders}
                  onToggle={toggleFolder}
                  onSelectNote={handleSelect}
                  filterText={filterText}
                />
              ))}

              {/* Root-level notes */}
              {filteredRootNotes.map((note) => (
                <NoteItem
                  key={note.path}
                  note={note}
                  depth={0}
                  onSelect={handleSelect}
                />
              ))}

              {filterText && filteredRootNotes.length === 0 && !tree.children.some((c) => hasMatches(c, filterText)) && (
                <div
                  style={{
                    padding: "2rem 1rem",
                    textAlign: "center",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono, monospace)",
                      fontSize: "0.6rem",
                      letterSpacing: "0.12em",
                      color: "var(--text-faint)",
                    }}
                  >
                    NO MATCHING NOTES
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer hint */}
        <div
          style={{
            padding: "0.5rem 0.75rem",
            borderTop: "1px solid var(--border-dim)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.45rem",
              letterSpacing: "0.12em",
              color: "var(--text-faint)",
            }}
          >
            CLICK NOTE TO OPEN IN VIEWER
          </span>
        </div>
      </aside>

      {/* Backdrop */}
      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            zIndex: 49,
          }}
          onClick={onClose}
        />
      )}
    </>
  );
}
