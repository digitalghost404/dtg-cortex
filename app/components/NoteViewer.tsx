"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

interface NoteViewerProps {
  notePath: string | null;
  onClose: () => void;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

interface NoteData {
  name: string;
  content: string;
}

type ViewMode = "read" | "edit";

// ---------------------------------------------------------------------------
// Markdown renderer with wikilink support
// ---------------------------------------------------------------------------

interface RenderedToken {
  type:
    | "h1"
    | "h2"
    | "h3"
    | "paragraph"
    | "code_block"
    | "hr"
    | "list_item"
    | "blank";
  raw: string;
}

function tokenize(markdown: string): RenderedToken[] {
  const lines = markdown.split("\n");
  const tokens: RenderedToken[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const fence = line.slice(0, 3);
      const parts = [line];
      i++;
      while (i < lines.length && !lines[i].startsWith(fence)) {
        parts.push(lines[i]);
        i++;
      }
      if (i < lines.length) parts.push(lines[i]);
      tokens.push({ type: "code_block", raw: parts.join("\n") });
      i++;
      continue;
    }

    // Headings
    if (line.startsWith("### ")) {
      tokens.push({ type: "h3", raw: line.slice(4) });
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      tokens.push({ type: "h2", raw: line.slice(3) });
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      tokens.push({ type: "h1", raw: line.slice(2) });
      i++;
      continue;
    }

    // HR
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      tokens.push({ type: "hr", raw: line });
      i++;
      continue;
    }

    // List items
    if (/^(\s*[-*+]|\s*\d+\.) /.test(line)) {
      tokens.push({ type: "list_item", raw: line });
      i++;
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      tokens.push({ type: "blank", raw: "" });
      i++;
      continue;
    }

    // Paragraph
    tokens.push({ type: "paragraph", raw: line });
    i++;
  }

  return tokens;
}

// Render inline markdown: bold, italic, inline code, wikilinks
function renderInline(
  text: string,
  onWikilink: (target: string) => void
): React.ReactNode[] {
  // Split on wikilinks [[...]], bold **...**, italic *...*, inline code `...`
  const pattern = /(\[\[([^\]]+)\]\]|\*\*(.+?)\*\*|(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|\`([^`]+)\`)/g;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }

    const full = match[0];

    if (full.startsWith("[[")) {
      const target = match[2];
      nodes.push(
        <span
          key={match.index}
          className="note-viewer__wikilink"
          role="button"
          tabIndex={0}
          onClick={() => onWikilink(target)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onWikilink(target);
            }
          }}
        >
          {`[[${target}]]`}
        </span>
      );
    } else if (full.startsWith("**")) {
      nodes.push(<strong key={match.index}>{match[3]}</strong>);
    } else if (full.startsWith("`")) {
      nodes.push(<code key={match.index}>{match[5]}</code>);
    } else {
      // italic
      nodes.push(<em key={match.index}>{match[4]}</em>);
    }

    last = match.index + full.length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes;
}

interface MarkdownContentProps {
  markdown: string;
  onWikilink: (target: string) => void;
}

function MarkdownContent({ markdown, onWikilink }: MarkdownContentProps) {
  const tokens = tokenize(markdown);

  return (
    <div className="note-viewer__content">
      {tokens.map((token, idx) => {
        switch (token.type) {
          case "h1":
            return <h1 key={idx}>{renderInline(token.raw, onWikilink)}</h1>;
          case "h2":
            return <h2 key={idx}>{renderInline(token.raw, onWikilink)}</h2>;
          case "h3":
            return <h3 key={idx}>{renderInline(token.raw, onWikilink)}</h3>;
          case "code_block": {
            const codeLines = token.raw.split("\n");
            // Strip the fence lines
            const inner = codeLines.slice(1, -1).join("\n");
            return (
              <pre key={idx}>
                <code>{inner}</code>
              </pre>
            );
          }
          case "hr":
            return (
              <hr
                key={idx}
                style={{ borderColor: "var(--border-dim)", margin: "1em 0" }}
              />
            );
          case "list_item":
            return (
              <div key={idx} style={{ paddingLeft: "1em", marginBottom: "2px" }}>
                &bull;&nbsp;{renderInline(token.raw.replace(/^\s*[-*+]\s+|\s*\d+\.\s+/, ""), onWikilink)}
              </div>
            );
          case "blank":
            return <div key={idx} style={{ height: "0.6em" }} />;
          default:
            return <p key={idx} style={{ margin: "0 0 0.4em" }}>{renderInline(token.raw, onWikilink)}</p>;
        }
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drag-to-resize divider hook
// ---------------------------------------------------------------------------

interface DragHandleProps {
  onDrag: (dx: number) => void;
}

function DragHandle({ onDrag }: DragHandleProps) {
  const draggingRef = useRef(false);
  const lastXRef = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      lastXRef.current = e.clientX;

      const divider = e.currentTarget as HTMLElement;
      divider.classList.add("split-pane__divider--dragging");

      function onMouseMove(ev: MouseEvent) {
        if (!draggingRef.current) return;
        const dx = ev.clientX - lastXRef.current;
        lastXRef.current = ev.clientX;
        onDrag(dx);
      }

      function onMouseUp() {
        draggingRef.current = false;
        divider.classList.remove("split-pane__divider--dragging");
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      }

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    },
    [onDrag]
  );

  return (
    <div
      className="split-pane__divider"
      onMouseDown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize note viewer"
    />
  );
}

// ---------------------------------------------------------------------------
// NoteViewer
// ---------------------------------------------------------------------------

export default function NoteViewer({ notePath, onClose, fullscreen = false, onToggleFullscreen }: NoteViewerProps) {
  const [note, setNote] = useState<NoteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Edit mode state
  const [viewMode, setViewMode] = useState<ViewMode>("read");
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  // Navigation history: stack of paths, current index
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Viewer panel width (controlled by drag)
  const [viewerWidth, setViewerWidth] = useState(400);

  // Portal target – only available after hydration (SSR-safe)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setPortalTarget(document.body); }, []);

  // Escape in fullscreen: collapse to sidebar (or close if no toggle available)
  // Skip if actively editing to avoid losing unsaved work
  useEffect(() => {
    if (!fullscreen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && viewMode !== "edit") {
        onToggleFullscreen ? onToggleFullscreen() : onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen, viewMode, onClose, onToggleFullscreen]);

  // Lock body scroll when fullscreen overlay is open
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  // Focus the fullscreen panel when it opens
  const fullscreenPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fullscreen) fullscreenPanelRef.current?.focus();
  }, [fullscreen]);

  // When the external notePath changes (citation click), push to history.
  // We use a ref for historyIndex inside the setter to avoid stale closure.
  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;

  useEffect(() => {
    if (!notePath) return;
    const idx = historyIndexRef.current;
    let didPush = false;
    setHistory((prev) => {
      // If navigating to the same note, do nothing
      if (prev[idx] === notePath) return prev;
      // Truncate forward history, push new entry
      didPush = true;
      const next = prev.slice(0, idx + 1);
      next.push(notePath);
      return next;
    });
    if (didPush) {
      setHistoryIndex(idx + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notePath]);

  const activePath = history[historyIndex] ?? null;

  // Fetch note whenever activePath changes
  useEffect(() => {
    if (!activePath) {
      setNote(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setViewMode("read");
    setEditContent("");

    fetch(`/api/note?path=${encodeURIComponent(activePath)}&full=true`, {
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<NoteData>;
      })
      .then((data) => {
        setNote(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        const msg = err instanceof Error ? err.message : "Failed to load note";
        setError(msg);
        setLoading(false);
      });

    return () => controller.abort();
  }, [activePath]);

  // Wikilink navigation: push the linked note onto the history
  const handleWikilink = useCallback(
    (target: string) => {
      // Wikilinks reference note names without path/extension; we attempt the
      // path used in the vault by appending ".md". The API resolves via the
      // vault root, so we just pass the bare name with extension.
      const linkedPath = `${target}.md`;
      const idx = historyIndexRef.current;
      setHistory((prev) => {
        const next = prev.slice(0, idx + 1);
        next.push(linkedPath);
        return next;
      });
      setHistoryIndex(idx + 1);
    },
    [] // no deps needed — historyIndexRef.current is always current
  );

  const canBack = historyIndex > 0;
  const canForward = historyIndex < history.length - 1;

  function handleBack() {
    if (canBack) setHistoryIndex((i) => i - 1);
  }

  function handleForward() {
    if (canForward) setHistoryIndex((i) => i + 1);
  }

  function handleDrag(dx: number) {
    // Dragging left (negative dx) grows the viewer; dragging right shrinks it.
    setViewerWidth((w) => Math.min(600, Math.max(280, w - dx)));
  }

  function handleShare() {
    if (!note) return;
    const text = `# ${note.name}\n\n${note.content}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function handleEdit() {
    if (!note) return;
    setEditContent(note.content);
    setViewMode("edit");
  }

  function handleCancelEdit() {
    setViewMode("read");
    setEditContent("");
  }

  async function handleSave() {
    if (!activePath) return;
    setSaving(true);
    try {
      const res = await fetch("/api/note", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: activePath, content: editContent }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Refresh note data
      setNote({ name: note?.name ?? "", content: editContent });
      setViewMode("read");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  if (!activePath && !notePath) return null;

  const headerContent = (
    <div className="note-viewer__header">
      <div className="note-viewer__nav">
        <button
          className="note-viewer__nav-btn"
          onClick={handleBack}
          disabled={!canBack}
          aria-label="Navigate back"
          title="Back"
        >
          &larr;
        </button>
        <button
          className="note-viewer__nav-btn"
          onClick={handleForward}
          disabled={!canForward}
          aria-label="Navigate forward"
          title="Forward"
        >
          &rarr;
        </button>
      </div>

      <span className="note-viewer__path" title={activePath ?? ""}>
        {activePath ?? ""}
      </span>

      <div className="note-viewer__actions">
        {viewMode === "edit" ? (
          <>
            <button
              className="note-viewer__action-btn note-viewer__action-btn--save"
              onClick={handleSave}
              disabled={saving}
              aria-label="Save changes"
              title="Save"
            >
              {saving ? "\u22EF" : "\u2713"}
            </button>
            <button
              className="note-viewer__action-btn"
              onClick={handleCancelEdit}
              disabled={saving}
              aria-label="Cancel editing"
              title="Cancel"
            >
              &times;
            </button>
          </>
        ) : (
          <>
            <button
              className="note-viewer__action-btn"
              onClick={handleEdit}
              disabled={!note || loading}
              aria-label="Edit note"
              title="Edit"
            >
              &#9998;
            </button>
            <button
              className="note-viewer__action-btn"
              onClick={handleShare}
              disabled={!note || loading}
              aria-label="Copy note to clipboard"
              title={copied ? "Copied!" : "Share"}
            >
              {copied ? "\u2713" : "\u21F1"}
            </button>
            {onToggleFullscreen && (
              <button
                className="note-viewer__action-btn"
                onClick={onToggleFullscreen}
                aria-label={fullscreen ? "Collapse to sidebar" : "Open full screen"}
                title={fullscreen ? "Collapse" : "Expand"}
              >
                {fullscreen ? "\u2913" : "\u2922"}
              </button>
            )}
            <button
              className="note-viewer__action-btn"
              onClick={onClose}
              aria-label="Close note viewer"
              title="Close"
            >
              &times;
            </button>
          </>
        )}
      </div>
    </div>
  );

  const bodyContent = (
    <>
      {loading && (
        <div
          className="flex items-center gap-3 px-4 py-6"
          aria-live="polite"
          aria-busy="true"
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
            LOADING NOTE...
          </span>
        </div>
      )}

      {!loading && error && (
        <div
          className="note-viewer__content"
          style={{ color: "var(--text-muted)", fontStyle: "italic" }}
          role="alert"
        >
          {error}
        </div>
      )}

      {!loading && !error && note && viewMode === "read" && (
        <MarkdownContent
          markdown={note.content}
          onWikilink={handleWikilink}
        />
      )}

      {!loading && !error && note && viewMode === "edit" && (
        <textarea
          className="note-viewer__editor"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          spellCheck={false}
          autoFocus
        />
      )}
    </>
  );

  // Fullscreen: portal overlay to document.body, hide the sidebar shell
  // Sidebar: render inline in the split-pane
  const fullscreenOverlay = fullscreen && portalTarget
    ? createPortal(
        <div
          className="note-viewer-fullscreen"
          role="dialog"
          aria-modal="true"
          aria-label="Note viewer"
          onClick={() => (onToggleFullscreen ? onToggleFullscreen() : onClose())}
        >
          <div
            ref={fullscreenPanelRef}
            className="note-viewer-fullscreen__panel"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            {headerContent}
            <div className="note-viewer-fullscreen__body">
              {bodyContent}
            </div>
          </div>
        </div>,
        portalTarget
      )
    : null;

  return (
    <>
      {fullscreenOverlay}
      {!fullscreen && (
        <>
          <DragHandle onDrag={handleDrag} />
          <div
            className="split-pane__viewer"
            style={{ width: viewerWidth }}
            role="complementary"
            aria-label="Note viewer"
          >
            {headerContent}
            {bodyContent}
          </div>
        </>
      )}
    </>
  );
}
