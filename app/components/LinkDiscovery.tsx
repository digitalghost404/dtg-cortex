"use client";

import { useEffect, useState, useCallback } from "react";
import NotePreview from "@/app/components/NotePreview";
import type { DiscoverResponse, DiscoverSuggestion } from "@/app/api/links/discover/route";

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScanLoader() {
  return (
    <div className="scan-loader">
      <div className="scan-loader__bar" />
      <div className="scan-loader__bar" />
      <div className="scan-loader__bar" />
      <div className="scan-loader__bar" />
      <div className="scan-loader__bar" />
    </div>
  );
}

function SimilarityBar({ similarity }: { similarity: number }) {
  const pct = Math.round(similarity * 100);

  return (
    <div className="link-discovery__score">
      <div
        className="link-discovery__score-fill"
        style={{ width: `${pct}%` }}
        aria-hidden="true"
      />
      <span className="link-discovery__score-label">{pct}%</span>
    </div>
  );
}

function SuggestionCard({ suggestion }: { suggestion: DiscoverSuggestion }) {
  return (
    <div className="link-discovery__card">
      <div className="link-discovery__notes">
        <NotePreview notePath={suggestion.pathA} noteName={suggestion.noteA}>
          <span className="link-discovery__note-name">{suggestion.noteA}</span>
        </NotePreview>

        <span className="link-discovery__connector" aria-hidden="true">
          &#8592;&#8594;
        </span>

        <NotePreview notePath={suggestion.pathB} noteName={suggestion.noteB}>
          <span className="link-discovery__note-name">{suggestion.noteB}</span>
        </NotePreview>
      </div>

      <SimilarityBar similarity={suggestion.similarity} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type FetchStatus = "idle" | "loading" | "success" | "error";

export default function LinkDiscovery() {
  const [status, setStatus] = useState<FetchStatus>("idle");
  const [suggestions, setSuggestions] = useState<DiscoverSuggestion[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setStatus("loading");
    setErrorMsg(null);

    try {
      const res = await fetch("/api/links/discover");
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as DiscoverResponse;
      setSuggestions(data.suggestions);
      setStatus("success");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Scan failed");
      setStatus("error");
    }
  }, []);

  // Auto-scan on mount
  useEffect(() => {
    runScan();
  }, [runScan]);

  return (
    <div className="link-discovery vault-panel" style={{ gridColumn: "1 / -1" }}>
      {/* Header */}
      <div className="link-discovery__header">
        <h2 className="vault-panel__title">MISSING SYNAPSES</h2>

        <button
          className="btn-secondary link-discovery__scan-btn"
          onClick={runScan}
          disabled={status === "loading"}
          aria-label="Scan for missing links"
        >
          {status === "loading" ? (
            <>
              <span className="indexing-ring" />
              SCANNING
            </>
          ) : (
            <>
              <span
                style={{ fontSize: "0.55rem", opacity: 0.7 }}
                aria-hidden="true"
              >
                &#9732;
              </span>
              SCAN FOR MISSING LINKS
            </>
          )}
        </button>
      </div>

      {/* Body */}
      {status === "idle" && null}

      {status === "loading" && (
        <div className="link-discovery__loading">
          <ScanLoader />
          <span className="link-discovery__loading-label">
            ANALYSING SEMANTIC GRAPH&hellip;
          </span>
        </div>
      )}

      {status === "error" && (
        <p className="link-discovery__error">{errorMsg}</p>
      )}

      {status === "success" && suggestions.length === 0 && (
        <p className="link-discovery__empty">
          NO MISSING SYNAPSES DETECTED &mdash; ALL SEMANTIC NEIGHBOURS ARE
          ALREADY LINKED
        </p>
      )}

      {status === "success" && suggestions.length > 0 && (
        <div className="link-discovery__list">
          {suggestions.map((s) => (
            <SuggestionCard
              key={`${s.noteA}--${s.noteB}`}
              suggestion={s}
            />
          ))}
        </div>
      )}
    </div>
  );
}
