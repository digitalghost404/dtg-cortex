"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback, KeyboardEvent, ChangeEvent, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FolderMode = "existing" | "new";

interface FormState {
  title: string;
  folderMode: FolderMode;
  folderSelected: string;
  folderNew: string;
  tags: string[];
  tagInput: string;
  content: string;
}

type ViewMode = "edit" | "preview";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip markdown syntax and return clean plain text for the preview pane.
 * Mirrors the same logic used on the discover page.
 */
function stripMarkdown(raw: string): string {
  let text = raw;

  // Remove YAML frontmatter
  text = text.replace(/^---[\s\S]*?---\n?/, "");

  // Remove code fences
  text = text.replace(/^```[\s\S]*?```\s*/gm, "");
  text = text.replace(/^~~~[\s\S]*?~~~\s*/gm, "");

  // Remove ATX headings
  text = text.replace(/^#{1,6}\s+/gm, "");

  // Wikilinks
  text = text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2");
  text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");

  // Markdown links
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Images
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");

  // Bold / italic combinations then singles
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

  // List markers
  text = text.replace(/^[\s]*[-*+]\s+/gm, "");
  text = text.replace(/^[\s]*\d+\.\s+/gm, "");

  // Bare URLs
  text = text.replace(/https?:\/\/\S+/g, "");

  // Collapse blank lines
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

const EMPTY_FORM: FormState = {
  title: "",
  folderMode: "existing",
  folderSelected: "(root)",
  folderNew: "",
  tags: [],
  tagInput: "",
  content: "",
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "block",
        fontFamily: "var(--font-geist-mono, monospace)",
        fontSize: "0.6rem",
        letterSpacing: "0.15em",
        textTransform: "uppercase",
        color: "var(--text-muted)",
        marginBottom: "0.4rem",
      }}
    >
      {children}
    </span>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  padding: "0.6rem 0.75rem",
  background: "var(--bg-surface)",
  border: "1px solid var(--border-dim)",
  borderRadius: "2px",
  color: "var(--text-primary)",
  fontFamily: "var(--font-geist-mono, monospace)",
  fontSize: "0.75rem",
  outline: "none",
};

function useInputFocusBorder() {
  return {
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.borderColor = "var(--border-mid)";
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      (e.currentTarget as HTMLElement).style.borderColor = "var(--border-dim)";
    },
  };
}

// ---------------------------------------------------------------------------
// TagInput
// ---------------------------------------------------------------------------

function TagInput({
  tags,
  tagInput,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
}: {
  tags: string[];
  tagInput: string;
  onTagInputChange: (val: string) => void;
  onAddTag: (tag: string) => void;
  onRemoveTag: (tag: string) => void;
}) {
  const focusHandlers = useInputFocusBorder();

  function commitTag(raw: string) {
    const trimmed = raw.replace(/^#/, "").trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      onAddTag(trimmed);
    }
    onTagInputChange("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commitTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      onRemoveTag(tags[tags.length - 1]);
    }
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    // auto-commit on comma typed inline
    if (val.endsWith(",")) {
      commitTag(val.slice(0, -1));
    } else {
      onTagInputChange(val);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "0.35rem",
        padding: "0.45rem 0.6rem",
        background: "var(--bg-surface)",
        border: "1px solid var(--border-dim)",
        borderRadius: "2px",
        minHeight: "2.35rem",
        cursor: "text",
      }}
      onClick={(e) => {
        const input = (e.currentTarget as HTMLDivElement).querySelector("input");
        input?.focus();
      }}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            background: "var(--bg-surface)",
            border: "1px solid var(--border-dim)",
            borderRadius: "2px",
            padding: "1px 6px",
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem",
            color: "var(--text-secondary)",
            letterSpacing: "0.06em",
            whiteSpace: "nowrap",
          }}
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemoveTag(tag);
            }}
            style={{
              background: "none",
              border: "none",
              padding: "0",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.65rem",
              lineHeight: 1,
              display: "flex",
              alignItems: "center",
            }}
            aria-label={`Remove tag ${tag}`}
          >
            x
          </button>
        </span>
      ))}
      <input
        type="text"
        value={tagInput}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? "type tag, press enter..." : ""}
        style={{
          background: "none",
          border: "none",
          outline: "none",
          color: "var(--text-primary)",
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.75rem",
          flex: "1 1 80px",
          minWidth: "80px",
          padding: "1px 2px",
        }}
        {...focusHandlers}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function NewNotePage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [folders, setFolders] = useState<string[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successPath, setSuccessPath] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const hasFetchedFolders = useRef(false);
  const [suggestedTags, setSuggestedTags] = useState<string[]>([]);
  const suggestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Fetch folders on mount ──────────────────────────────────────────────

  useEffect(() => {
    if (hasFetchedFolders.current) return;
    hasFetchedFolders.current = true;

    async function fetchFolders() {
      try {
        const res = await fetch("/api/folders");
        if (res.ok) {
          const data = (await res.json()) as { folders: string[] };
          setFolders(data.folders ?? []);
        }
      } finally {
        setFoldersLoading(false);
      }
    }

    fetchFolders();
  }, []);

  // ── Debounced tag suggestions ───────────────────────────────────────────

  useEffect(() => {
    if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);

    if (form.content.trim().length < 50) {
      setSuggestedTags([]);
      return;
    }

    suggestTimerRef.current = setTimeout(async () => {
      try {
        const existingTags = form.tags.map((t) => (t.startsWith("#") ? t : `#${t}`));
        const res = await fetch("/api/tags/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: form.content, existingTags }),
        });
        if (res.ok) {
          const data = (await res.json()) as { tags: string[] };
          // Filter out already-selected tags
          const filtered = data.tags.filter(
            (t) => !form.tags.includes(t.replace(/^#/, ""))
          );
          setSuggestedTags(filtered);
        }
      } catch {
        // Silently fail — suggestions are non-critical
      }
    }, 1500);

    return () => {
      if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.content]);

  // ── Auto-grow textarea ──────────────────────────────────────────────────

  function growTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    growTextarea();
  }, [form.content]);

  // ── Field updaters ──────────────────────────────────────────────────────

  const setField = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  function handleFolderSelectChange(e: ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    if (val === "__new__") {
      setForm((prev) => ({ ...prev, folderMode: "new", folderSelected: val }));
    } else {
      setForm((prev) => ({ ...prev, folderMode: "existing", folderSelected: val }));
    }
  }

  function addTag(tag: string) {
    setForm((prev) => ({ ...prev, tags: [...prev.tags, tag] }));
  }

  function removeTag(tag: string) {
    setForm((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }));
  }

  // ── Resolve effective folder ────────────────────────────────────────────

  function resolveFolder(): string {
    if (form.folderMode === "new") {
      return form.folderNew.trim() || "";
    }
    if (form.folderSelected === "(root)") return "";
    return form.folderSelected;
  }

  // ── Submit ──────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;

    setSubmitting(true);
    setSubmitError(null);

    const folder = resolveFolder();

    try {
      const res = await fetch("/api/notes/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          content: form.content,
          folder: folder || undefined,
          tags: form.tags,
        }),
      });

      const data = (await res.json()) as { success?: boolean; path?: string; error?: string };

      if (!res.ok || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      setSuccessPath(data.path ?? null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCreateAnother() {
    setForm(EMPTY_FORM);
    setSuccessPath(null);
    setSubmitError(null);
    setViewMode("edit");
  }

  // ── Render ──────────────────────────────────────────────────────────────

  const focusHandlers = useInputFocusBorder();

  const preview = stripMarkdown(form.content);

  return (
    <div
      className="cortex-bg"
      style={{ height: "100vh", overflowY: "auto" }}
    >
      {/* ── Header ────────────────────────────────────────────────────────── */}
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
            aria-label="Back to Cortex"
          >
            <span style={{ fontSize: "0.8rem" }}>&#8592;</span>
            <span className="back-text">BACK TO CORTEX</span>
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
            NEW NOTE
          </h1>
        </div>
      </header>

      {/* ── Main ──────────────────────────────────────────────────────────── */}
      <main
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          padding: "2rem 1rem 4rem",
          width: "100%",
        }}
      >
        {/* ── Success state ─────────────────────────────────────────────── */}
        {successPath && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <div
              style={{
                background: "rgba(34,211,238,0.05)",
                border: "1px solid var(--border-mid)",
                borderLeft: "3px solid var(--cyan-bright)",
                borderRadius: "3px",
                padding: "1.25rem 1.5rem",
              }}
            >
              <p
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.6rem",
                  letterSpacing: "0.15em",
                  color: "var(--text-muted)",
                  margin: "0 0 0.5rem",
                  textTransform: "uppercase",
                }}
              >
                NOTE CREATED
              </p>
              <p
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.75rem",
                  color: "var(--cyan-bright)",
                  margin: 0,
                  wordBreak: "break-all",
                  textShadow: "0 0 8px rgba(34,211,238,0.4)",
                }}
              >
                {successPath}
              </p>
            </div>

            <button
              type="button"
              onClick={handleCreateAnother}
              className="btn-secondary"
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.65rem",
                letterSpacing: "0.15em",
                padding: "0.6rem 1.5rem",
                borderRadius: "2px",
                alignSelf: "flex-start",
                cursor: "pointer",
              }}
            >
              CREATE ANOTHER
            </button>
          </div>
        )}

        {/* ── Form ──────────────────────────────────────────────────────── */}
        {!successPath && (
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}
            noValidate
          >
            {/* ── Title ─────────────────────────────────────────────────── */}
            <div>
              <FieldLabel>Title</FieldLabel>
              <input
                type="text"
                required
                value={form.title}
                onChange={(e) => setField("title", e.target.value)}
                placeholder="Note title..."
                autoFocus
                style={INPUT_STYLE}
                {...focusHandlers}
              />
            </div>

            {/* ── Folder ────────────────────────────────────────────────── */}
            <div>
              <FieldLabel>Folder</FieldLabel>
              <select
                value={form.folderMode === "new" ? "__new__" : form.folderSelected}
                onChange={handleFolderSelectChange}
                disabled={foldersLoading}
                style={{
                  ...INPUT_STYLE,
                  appearance: "none",
                  WebkitAppearance: "none",
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%232e6a7e'/%3E%3C/svg%3E\")",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 0.75rem center",
                  paddingRight: "2rem",
                  cursor: foldersLoading ? "wait" : "pointer",
                }}
                {...focusHandlers}
              >
                <option value="(root)">(root)</option>
                {folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
                <option value="__new__">New folder...</option>
              </select>

              {form.folderMode === "new" && (
                <input
                  type="text"
                  value={form.folderNew}
                  onChange={(e) => setField("folderNew", e.target.value)}
                  placeholder="folder/path..."
                  autoFocus
                  style={{
                    ...INPUT_STYLE,
                    marginTop: "0.5rem",
                  }}
                  {...focusHandlers}
                />
              )}
            </div>

            {/* ── Tags ──────────────────────────────────────────────────── */}
            <div>
              <FieldLabel>Tags</FieldLabel>
              <TagInput
                tags={form.tags}
                tagInput={form.tagInput}
                onTagInputChange={(val) => setField("tagInput", val)}
                onAddTag={addTag}
                onRemoveTag={removeTag}
              />
              <p
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.55rem",
                  letterSpacing: "0.1em",
                  color: "var(--text-faint)",
                  margin: "0.35rem 0 0",
                }}
              >
                PRESS ENTER OR COMMA TO ADD A TAG
              </p>

              {/* Suggested tags */}
              {suggestedTags.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.3rem",
                    marginTop: "0.5rem",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-geist-mono, monospace)",
                      fontSize: "0.5rem",
                      letterSpacing: "0.12em",
                      color: "var(--text-faint)",
                      alignSelf: "center",
                      marginRight: "0.25rem",
                    }}
                  >
                    SUGGESTED:
                  </span>
                  {suggestedTags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        addTag(tag.replace(/^#/, ""));
                        setSuggestedTags((prev) => prev.filter((t) => t !== tag));
                      }}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.2rem",
                        background: "rgba(34,211,238,0.06)",
                        border: "1px solid var(--border-dim)",
                        borderRadius: "2px",
                        padding: "2px 8px",
                        fontFamily: "var(--font-geist-mono, monospace)",
                        fontSize: "0.55rem",
                        color: "var(--cyan-mid)",
                        letterSpacing: "0.06em",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      + {tag.replace(/^#/, "")}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Content ───────────────────────────────────────────────── */}
            <div>
              {/* Edit / Preview toggle on mobile */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: "0.4rem",
                }}
              >
                <FieldLabel>Content</FieldLabel>
                <div className="mode-toggle" style={{ display: "flex", gap: "0.3rem" }}>
                  {(["edit", "preview"] as ViewMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewMode(mode)}
                      style={{
                        fontFamily: "var(--font-geist-mono, monospace)",
                        fontSize: "0.55rem",
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        padding: "2px 8px",
                        borderRadius: "2px",
                        cursor: "pointer",
                        border: "1px solid",
                        borderColor:
                          viewMode === mode ? "var(--border-mid)" : "var(--border-dim)",
                        background:
                          viewMode === mode
                            ? "rgba(34,211,238,0.08)"
                            : "transparent",
                        color:
                          viewMode === mode
                            ? "var(--cyan-bright)"
                            : "var(--text-muted)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Editor */}
              <div className={`editor-panel${viewMode === "edit" ? "" : " content-hidden"}`}>
                <textarea
                  ref={textareaRef}
                  value={form.content}
                  onChange={(e) => {
                    setField("content", e.target.value);
                  }}
                  placeholder="Write in markdown..."
                  rows={12}
                  style={{
                    ...INPUT_STYLE,
                    resize: "none",
                    lineHeight: 1.7,
                    overflowY: "hidden",
                    minHeight: "200px",
                  }}
                  {...focusHandlers}
                />
              </div>

              {/* Preview — on desktop appears below editor as live preview */}
              <p
                className="desktop-preview-label"
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.55rem",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  margin: "0.75rem 0 0.4rem",
                  display: "none",
                }}
              >
                Live Preview
              </p>
              <div className={`preview-panel${viewMode === "preview" ? "" : " content-hidden"}`}>
                {form.content.trim() ? (
                  <div
                    style={{
                      width: "100%",
                      padding: "0.6rem 0.75rem",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-dim)",
                      borderRadius: "2px",
                      minHeight: "200px",
                    }}
                  >
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
                    </p>
                  </div>
                ) : (
                  <div
                    style={{
                      width: "100%",
                      padding: "0.6rem 0.75rem",
                      background: "var(--bg-surface)",
                      border: "1px solid var(--border-dim)",
                      borderRadius: "2px",
                      minHeight: "200px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <p
                      style={{
                        fontFamily: "var(--font-geist-mono, monospace)",
                        fontSize: "0.6rem",
                        letterSpacing: "0.12em",
                        color: "var(--text-faint)",
                        margin: 0,
                      }}
                    >
                      NO CONTENT TO PREVIEW
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Error ─────────────────────────────────────────────────── */}
            {submitError && (
              <div
                style={{
                  background: "rgba(248,113,113,0.06)",
                  border: "1px solid rgba(248,113,113,0.2)",
                  borderLeft: "3px solid #f87171",
                  borderRadius: "3px",
                  padding: "0.75rem 1rem",
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
                  ERROR — {submitError}
                </p>
              </div>
            )}

            {/* ── Submit ────────────────────────────────────────────────── */}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                disabled={submitting || !form.title.trim()}
                className="btn-secondary"
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.65rem",
                  letterSpacing: "0.18em",
                  padding: "0.65rem 1.75rem",
                  borderRadius: "2px",
                  cursor: submitting || !form.title.trim() ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.6rem",
                  color:
                    submitting || !form.title.trim()
                      ? "var(--text-muted)"
                      : "var(--cyan-bright)",
                  borderColor:
                    submitting || !form.title.trim()
                      ? "var(--border-dim)"
                      : "var(--border-mid)",
                  background:
                    submitting || !form.title.trim()
                      ? "transparent"
                      : "rgba(34,211,238,0.05)",
                  transition: "all 0.15s ease",
                }}
              >
                {submitting ? (
                  <>
                    <span className="indexing-ring" />
                    CREATING...
                  </>
                ) : (
                  "CREATE NOTE"
                )}
              </button>
            </div>
          </form>
        )}
      </main>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
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
          CORTEX &nbsp;&#9472;&nbsp; NEW NOTE
        </span>
      </footer>

      {/* ── Responsive utilities ──────────────────────────────────────────── */}
      <style>{`
        @media (max-width: 640px) {
          .back-text { display: none; }
        }
        /* Mobile: toggle controls visibility */
        .content-hidden { display: none; }
        /* Desktop: always show both editor and preview, hide the toggle */
        @media (min-width: 641px) {
          .mode-toggle { display: none !important; }
          .editor-panel { display: block !important; }
          .preview-panel { display: block !important; }
          .desktop-preview-label { display: block !important; }
        }
      `}</style>
    </div>
  );
}
