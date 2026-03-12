"use client";

import { useRef, useState, useCallback } from "react";

interface NotePreviewProps {
  notePath: string;
  noteName: string;
  children: React.ReactNode;
}

type FetchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; name: string; content: string }
  | { status: "error" };

export default function NotePreview({ notePath, noteName, children }: NotePreviewProps) {
  const [visible, setVisible] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>({ status: "idle" });
  // Cache result so we only fetch once per mount
  const cacheRef = useRef<{ name: string; content: string } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = useCallback(async () => {
    setVisible(true);

    // Already fetched — nothing more to do
    if (cacheRef.current) return;
    // Already in-flight
    if (fetchState.status === "loading") return;

    setFetchState({ status: "loading" });
    try {
      const res = await fetch(`/api/note?path=${encodeURIComponent(notePath)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { name: string; content: string };
      cacheRef.current = data;
      setFetchState({ status: "success", name: data.name, content: data.content });
    } catch {
      setFetchState({ status: "error" });
    }
  }, [notePath, fetchState.status]);

  const handleMouseLeave = useCallback(() => {
    setVisible(false);
  }, []);

  // Decide which side of the viewport we're on so the popover can flip
  // We check at render time using the wrapper element's bounding rect.
  const getNearBottom = () => {
    if (!wrapperRef.current) return false;
    const rect = wrapperRef.current.getBoundingClientRect();
    return rect.bottom > window.innerHeight - 240;
  };

  const nearBottom = visible ? getNearBottom() : false;

  return (
    <span
      ref={wrapperRef}
      className="note-preview-wrapper"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}

      <span
        className={`note-preview-popover${visible ? " note-preview-popover--visible" : ""}${nearBottom ? " note-preview-popover--below" : ""}`}
        role="tooltip"
        aria-label={`Preview of ${noteName}`}
      >
        {/* Title bar */}
        <span className="note-preview-popover__title">
          <span className="note-preview-popover__title-bracket">[[ </span>
          {noteName}
          <span className="note-preview-popover__title-bracket"> ]]</span>
        </span>

        {/* Divider */}
        <span className="note-preview-popover__divider" aria-hidden="true" />

        {/* Content area */}
        <span className="note-preview-popover__content">
          {fetchState.status === "idle" || fetchState.status === "loading" ? (
            <span className="note-preview-popover__loading">
              <span className="note-preview-popover__loading-dot" />
              <span className="note-preview-popover__loading-dot" />
              <span className="note-preview-popover__loading-dot" />
            </span>
          ) : fetchState.status === "error" ? (
            <span className="note-preview-popover__error">Could not load preview</span>
          ) : (
            fetchState.content || (
              <span className="note-preview-popover__error">Empty note</span>
            )
          )}
        </span>
      </span>
    </span>
  );
}
