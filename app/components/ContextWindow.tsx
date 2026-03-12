"use client";

import { useState } from "react";

export interface ContextWindowProps {
  sources: Array<{ name: string; path: string; score: number }>;
  isStreaming: boolean;
}

function isWebSource(path: string): boolean {
  return path.startsWith("http://") || path.startsWith("https://");
}

export default function ContextWindow({ sources, isStreaming }: ContextWindowProps) {
  const [collapsed, setCollapsed] = useState(false);

  // Only render the panel when there is something to show (sources present, or
  // streaming has just started). We keep it mounted but hidden otherwise so the
  // collapse transition can fire.
  const hasContent = sources.length > 0;
  if (!hasContent && !isStreaming) return null;

  const panelClass = [
    "context-window",
    collapsed
      ? "context-window--collapsed"
      : isStreaming
      ? "context-window--active"
      : "context-window--idle",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={panelClass} role="region" aria-label="Context sources">
      {/* Header / label bar — always visible, click toggles collapse */}
      <div
        className="context-window__header"
        onClick={() => setCollapsed((v) => !v)}
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setCollapsed((v) => !v);
          }
        }}
      >
        <span className="context-window__label">
          <span
            className={`context-window__dot${isStreaming ? " context-window__dot--active" : ""}`}
          />
          CONTEXT
          {hasContent && !collapsed && (
            <span
              style={{
                color: "var(--text-faint)",
                marginLeft: 4,
              }}
            >
              &mdash; {sources.length} NODE{sources.length !== 1 ? "S" : ""}
            </span>
          )}
        </span>

        <span
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.5rem",
            color: "var(--text-faint)",
            letterSpacing: "0.1em",
            userSelect: "none",
          }}
        >
          {collapsed ? "EXPAND" : "COLLAPSE"}
        </span>
      </div>

      {/* Source chip list — only rendered when not collapsed */}
      {!collapsed && hasContent && (
        <div className="context-window__sources">
          {sources.map((src, i) => {
            const web = isWebSource(src.path);
            const highScore = src.score >= 0.7;
            const chipClass = [
              "context-source",
              web ? "context-source--web" : highScore ? "context-source--high" : "",
            ]
              .filter(Boolean)
              .join(" ");

            // Glow intensity scales with score — only for vault notes
            const glowStyle =
              !web && highScore
                ? {
                    boxShadow: `0 0 ${Math.round(src.score * 12)}px rgba(34, 211, 238, ${(
                      src.score * 0.4
                    ).toFixed(2)})`,
                    borderColor: `rgba(34, 211, 238, ${(src.score * 0.6).toFixed(2)})`,
                  }
                : undefined;

            return (
              <div
                key={`${src.path}-${i}`}
                className={chipClass}
                style={glowStyle}
                title={src.path}
              >
                <span>{src.name}</span>
                <span className="context-source__score">
                  {Math.round(src.score * 100)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
