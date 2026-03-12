"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

interface PersonalitySettings {
  formality: number;
  length: number;
  challenge: number;
  creativity: number;
}

const DEFAULT_PERSONALITY: PersonalitySettings = {
  formality: 50,
  length: 50,
  challenge: 30,
  creativity: 40,
};

// ── Slider descriptors ────────────────────────────────────────────────────────

type SliderDef = {
  key: keyof PersonalitySettings;
  title: string;
  lowLabel: string;
  highLabel: string;
  lowHint: string;
  highHint: string;
};

const SLIDERS: SliderDef[] = [
  {
    key: "formality",
    title: "FORMALITY",
    lowLabel: "CASUAL",
    highLabel: "ACADEMIC",
    lowHint: "conversational, contractions fine",
    highHint: "precise terminology, formal register",
  },
  {
    key: "length",
    title: "RESPONSE LENGTH",
    lowLabel: "CONCISE",
    highLabel: "THOROUGH",
    lowHint: "2-3 sentences max",
    highHint: "paragraphs with examples",
  },
  {
    key: "challenge",
    title: "ENGAGEMENT STYLE",
    lowLabel: "SUPPORTIVE",
    highLabel: "SOCRATIC",
    lowHint: "affirm and encourage",
    highHint: "probe assumptions, push back",
  },
  {
    key: "creativity",
    title: "CREATIVITY",
    lowLabel: "FACTUAL",
    highLabel: "EXPLORATORY",
    lowHint: "established knowledge only",
    highHint: "speculative, novel connections",
  },
];

// ── Preview generation (mirrors lib/personality.ts) ──────────────────────────

function interpolateLabel(value: number, low: string, mid: string, high: string): string {
  if (value <= 20) return low;
  if (value >= 80) return high;
  return mid;
}

function buildPreview(settings: PersonalitySettings): string {
  const tone = interpolateLabel(
    settings.formality,
    "Hey — here's the short version:",
    "Here's what you need to know:",
    "The following analysis addresses your query:",
  );

  const length = interpolateLabel(
    settings.length,
    "I'll keep it brief.",
    "I'll cover the key points.",
    "I'll walk through this thoroughly, with examples.",
  );

  const challenge = interpolateLabel(
    settings.challenge,
    "That's a solid line of thinking.",
    "There's merit here — though a few angles are worth examining.",
    "Before we proceed: what's the underlying assumption driving this question?",
  );

  const creativity = interpolateLabel(
    settings.creativity,
    "Sticking to what's established:",
    "Primarily evidence-based, with a few connections worth noting:",
    "This opens some unconventional possibilities worth exploring:",
  );

  return `${tone} ${length} ${challenge} ${creativity}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<PersonalitySettings>(DEFAULT_PERSONALITY);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load current settings on mount
  useEffect(() => {
    fetch("/api/personality")
      .then((r) => r.json())
      .then((data: PersonalitySettings) => {
        setSettings(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handleSliderChange = useCallback(
    (key: keyof PersonalitySettings, value: number) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
      setSaved(false);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/personality", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Save failed");
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }
  }, [settings]);

  const handleReset = useCallback(() => {
    setSettings({ ...DEFAULT_PERSONALITY });
    setSaved(false);
  }, []);

  const preview = buildPreview(settings);

  return (
    <div
      className="cortex-bg"
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header
        className="hud-header-rule hud-enter"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1rem",
          flexShrink: 0,
          flexWrap: "wrap",
          gap: "0.5rem",
        }}
      >
        <Link
          href="/"
          className="btn-secondary"
          style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            letterSpacing: "0.1em",
            fontSize: "0.6rem",
            padding: "0.25rem 0.75rem",
            borderRadius: "2px",
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            textDecoration: "none",
          }}
        >
          <span style={{ fontSize: "0.55rem", opacity: 0.7 }}>&#9664;</span>
          BACK TO CORTEX
        </Link>

        <h1
          className="cortex-wordmark"
          style={{
            fontSize: "0.75rem",
            margin: 0,
            color: "var(--cyan-bright)",
            letterSpacing: "0.25em",
          }}
        >
          PERSONALITY TUNING
        </h1>

        <div style={{ width: 120, flexShrink: 1 }} aria-hidden="true" />
      </header>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <main
        style={{
          flex: 1,
          maxWidth: 720,
          width: "100%",
          margin: "0 auto",
          padding: "1.5rem 1rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
        }}
      >
        {loading ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              paddingTop: "4rem",
              color: "var(--text-muted)",
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.7rem",
              letterSpacing: "0.14em",
            }}
          >
            LOADING...
          </div>
        ) : (
          <>
            {/* ── Sliders panel ─────────────────────────────────────────────── */}
            <div className="vault-panel">
              <h2 className="vault-panel__title" style={{ marginBottom: "1.25rem" }}>
                COMMUNICATION PARAMETERS
              </h2>

              <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
                {SLIDERS.map((def) => (
                  <div key={def.key}>
                    {/* Title row */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        marginBottom: "0.4rem",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono, monospace)",
                          fontSize: "0.6rem",
                          letterSpacing: "0.18em",
                          color: "var(--cyan-mid)",
                          textTransform: "uppercase",
                        }}
                      >
                        {def.title}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono, monospace)",
                          fontSize: "0.6rem",
                          letterSpacing: "0.08em",
                          color: "var(--cyan-bright)",
                        }}
                      >
                        {settings[def.key]}
                      </span>
                    </div>

                    {/* Extreme labels */}
                    <div
                      className="personality-label"
                      style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}
                    >
                      <span>{def.lowLabel}</span>
                      <span>{def.highLabel}</span>
                    </div>

                    {/* Slider */}
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={settings[def.key]}
                      onChange={(e) =>
                        handleSliderChange(def.key, Number(e.target.value))
                      }
                      className="personality-slider"
                      aria-label={def.title}
                      style={
                        {
                          "--slider-pct": `${settings[def.key]}%`,
                        } as React.CSSProperties
                      }
                    />

                    {/* Hints */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: "0.3rem",
                        flexWrap: "wrap",
                        gap: "0.25rem",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono, monospace)",
                          fontSize: "0.55rem",
                          color: "var(--text-faint)",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {def.lowHint}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono, monospace)",
                          fontSize: "0.55rem",
                          color: "var(--text-faint)",
                          letterSpacing: "0.04em",
                          textAlign: "right",
                        }}
                      >
                        {def.highHint}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Preview panel ─────────────────────────────────────────────── */}
            <div className="vault-panel">
              <h2 className="vault-panel__title" style={{ marginBottom: "0.75rem" }}>
                RESPONSE PREVIEW
              </h2>
              <p
                className="personality-preview"
              >
                {preview}
              </p>
            </div>

            {/* ── Actions ───────────────────────────────────────────────────── */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-boot"
                style={{
                  padding: "0.5rem 1.5rem",
                  borderRadius: "2px",
                  fontSize: "0.7rem",
                  letterSpacing: "0.18em",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                {saving ? "SAVING..." : saved ? "SAVED" : "SAVE"}
              </button>

              <button
                onClick={handleReset}
                disabled={saving}
                className="btn-secondary"
                style={{
                  padding: "0.5rem 1.25rem",
                  borderRadius: "2px",
                  fontSize: "0.65rem",
                  letterSpacing: "0.14em",
                  cursor: saving ? "not-allowed" : "pointer",
                }}
              >
                RESET TO DEFAULTS
              </button>

              {saved && (
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    letterSpacing: "0.12em",
                    color: "var(--cyan-bright)",
                    animation: "msg-appear 0.2s ease both",
                  }}
                >
                  &#10003; SETTINGS PERSISTED
                </span>
              )}

              {error && (
                <span
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.6rem",
                    letterSpacing: "0.1em",
                    color: "#f87171",
                  }}
                >
                  ERROR: {error}
                </span>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
