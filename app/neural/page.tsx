"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/app/components/AuthProvider";
import { useNeuralGraph, type ClustersData, type NeuronNode } from "@/app/hooks/useNeuralGraph";
import { useNeuralAnimation } from "@/app/hooks/useNeuralAnimation";
import { useNeuralChat } from "@/app/hooks/useNeuralChat";
import { useNeuralSounds } from "@/app/hooks/useNeuralSounds";
import NeuralCanvas from "@/app/components/NeuralCanvas";
import NeuralChatInput from "@/app/components/NeuralChatInput";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NeuralPage() {
  const { isAuthenticated, logout } = useAuth();

  // Data
  const [data, setData] = useState<ClustersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Interaction
  const [selectedNeuron, setSelectedNeuron] = useState<NeuronNode | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; color: string } | null>(null);

  // Fetch cluster data
  useEffect(() => {
    setLoading(true);
    fetch("/api/clusters")
      .then((r) => r.json())
      .then((d: ClustersData) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load neural data");
        setLoading(false);
      });
  }, []);

  // Build graph
  const { neurons, edges, neuronsByPath, clusterColors } = useNeuralGraph(data);

  // Sound effects
  const { ensureResumed, playActivation, playPulseTravel, playBrainPulse, playCooldown } =
    useNeuralSounds();

  // Animation
  const { animStateRef, activateNeuron, tick, getPhase } = useNeuralAnimation(neurons, edges);

  // Wrap activateNeuron to also trigger sound
  const activateNeuronWithSound = useCallback(
    (neuronIdx: number, score: number, sequenceIndex: number) => {
      activateNeuron(neuronIdx, score, sequenceIndex);
      playActivation(score, sequenceIndex);
      // Play brain pulse on first activation of a batch
      if (sequenceIndex === 0) {
        playBrainPulse();
      }
    },
    [activateNeuron, playActivation, playBrainPulse]
  );

  // Chat — uses the sound-wrapped activator
  const { input, setInput, submit, isLoading: chatLoading, streamingText, lastResponse } =
    useNeuralChat(neuronsByPath, activateNeuronWithSound);

  // Track phase transitions for sound effects
  const prevPhaseRef = useRef<string>("idle");
  const pulseParticleSoundRef = useRef(0);

  // Phase transition sound effects
  useEffect(() => {
    const interval = setInterval(() => {
      const phase = getPhase();
      const prev = prevPhaseRef.current;
      if (phase !== prev) {
        prevPhaseRef.current = phase;
        if (phase === "propagating") {
          playPulseTravel();
        } else if (phase === "cooling") {
          playCooldown();
        }
      }
      // Play pulse travel sound when new particles spawn (throttled in hook)
      const anim = animStateRef.current;
      if (anim) {
        const activeParticles = anim.particles.filter((p) => p.active).length;
        if (activeParticles > pulseParticleSoundRef.current + 2) {
          playPulseTravel();
        }
        pulseParticleSoundRef.current = activeParticles;
      }
    }, 100);
    return () => clearInterval(interval);
  }, [getPhase, playPulseTravel, playCooldown, animStateRef]);

  // Handlers
  const handleHover = useCallback(
    (neuron: NeuronNode | null, x: number, y: number) => {
      if (neuron) {
        setTooltip({ x, y, name: neuron.name, color: neuron.color });
      } else {
        setTooltip(null);
      }
    },
    []
  );

  const handleClick = useCallback(
    (neuron: NeuronNode | null) => {
      ensureResumed();
      setSelectedNeuron((prev) => (prev?.id === neuron?.id ? null : neuron ?? null));
    },
    [ensureResumed]
  );

  // Wrap submit to ensure audio context is active
  const handleSubmit = useCallback(
    (e?: React.FormEvent) => {
      ensureResumed();
      submit(e);
    },
    [ensureResumed, submit]
  );

  // Derived
  const selectedCluster = selectedNeuron
    ? data?.clusters.find((c) => c.id === selectedNeuron.cluster)
    : null;

  const nearbyNeurons = selectedNeuron
    ? neurons
        .filter((n) => n.id !== selectedNeuron.id && n.cluster === selectedNeuron.cluster)
        .slice(0, 5)
    : [];

  const phase = neurons.length > 0 ? getPhase() : "idle";

  return (
    <div
      className="cortex-bg"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        overflow: "hidden",
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header
        className="hud-header-rule hud-enter"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.65rem 1rem",
          background: "var(--bg-deep)",
          flexShrink: 0,
          zIndex: 20,
          position: "relative",
          gap: "0.5rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Link
            href="/"
            className="btn-secondary"
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.6rem",
              letterSpacing: "0.12em",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "4px 10px",
              borderRadius: "2px",
              textDecoration: "none",
            }}
          >
            <span style={{ fontSize: "0.8rem" }}>&#8592;</span>
            <span className="hidden sm:inline">BACK TO CORTEX</span>
          </Link>

          <span
            className="hidden sm:inline"
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
            NEURAL PULSE
          </h1>

          {neurons.length > 0 && (
            <span
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.5rem",
                letterSpacing: "0.1em",
                color: "var(--text-faint)",
                textTransform: "uppercase",
              }}
            >
              {phase}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {isAuthenticated ? (
            <button
              onClick={logout}
              className="btn-secondary"
              style={{ fontSize: "0.6rem", letterSpacing: "0.12em", padding: "3px 10px", borderRadius: "2px" }}
            >
              LOGOUT
            </button>
          ) : (
            <Link
              href="/login"
              className="btn-secondary hidden sm:flex"
              style={{ fontSize: "0.6rem", letterSpacing: "0.12em", padding: "3px 10px", borderRadius: "2px", textDecoration: "none" }}
            >
              LOGIN
            </Link>
          )}
        </div>
      </header>

      {/* ── Canvas area ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}>
        {/* Loading */}
        {loading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: "1rem",
              zIndex: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "3px" }}>
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
              MAPPING NEURAL TOPOLOGY...
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 10,
            }}
          >
            <div className="vault-panel" style={{ borderLeftColor: "#f87171", maxWidth: 400, margin: "1rem" }}>
              <p
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.65rem",
                  letterSpacing: "0.1em",
                  color: "var(--cyan-mid)",
                  marginBottom: "0.5rem",
                  textTransform: "uppercase",
                }}
              >
                NEURAL ERROR
              </p>
              <p style={{ fontFamily: "var(--font-geist-mono, monospace)", fontSize: "0.7rem", color: "#f87171" }}>
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Canvas */}
        {neurons.length > 0 && (
          <NeuralCanvas
            neurons={neurons}
            edges={edges}
            animStateRef={animStateRef}
            tick={tick}
            onHover={handleHover}
            onClick={handleClick}
          />
        )}

        {/* Chat input */}
        {neurons.length > 0 && (
          <NeuralChatInput
            input={input}
            setInput={setInput}
            onSubmit={handleSubmit}
            isLoading={chatLoading}
            streamingText={streamingText}
            lastResponse={lastResponse}
          />
        )}

        {/* Selected neuron panel */}
        {selectedNeuron && (
          <aside className="cluster-info-panel" role="complementary" aria-label="Neuron details">
            <div className="graph-info-panel__header">
              <span className="graph-info-panel__label">NEURON DETAIL</span>
              <button
                onClick={() => setSelectedNeuron(null)}
                className="graph-info-panel__close"
                aria-label="Close neuron detail"
              >
                &times;
              </button>
            </div>
            <div className="graph-info-panel__body">
              <p className="graph-info-panel__name">{selectedNeuron.name}</p>
              <div className="graph-info-panel__rows">
                <div className="graph-info-panel__row">
                  <span className="graph-info-panel__key">PATH</span>
                  <span className="graph-info-panel__val graph-info-panel__val--faint">
                    {selectedNeuron.path}
                  </span>
                </div>
                <div className="graph-info-panel__row">
                  <span className="graph-info-panel__key">CLUSTER</span>
                  <span
                    className="graph-info-panel__val"
                    style={{ color: selectedCluster?.color ?? "var(--cyan-bright)" }}
                  >
                    {selectedCluster?.label ?? `#${selectedNeuron.cluster}`}
                  </span>
                </div>
                <div className="graph-info-panel__row">
                  <span className="graph-info-panel__key">CHUNKS</span>
                  <span className="graph-info-panel__val">{selectedNeuron.connections}</span>
                </div>
              </div>

              {nearbyNeurons.length > 0 && (
                <div>
                  <p
                    style={{
                      fontFamily: "var(--font-geist-mono, monospace)",
                      fontSize: "0.5rem",
                      letterSpacing: "0.18em",
                      color: "var(--text-muted)",
                      margin: "0 0 6px 0",
                      textTransform: "uppercase",
                    }}
                  >
                    SAME CLUSTER
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {nearbyNeurons.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => setSelectedNeuron(n)}
                        style={{
                          textAlign: "left",
                          background: "transparent",
                          border: "none",
                          cursor: "pointer",
                          fontFamily: "var(--font-geist-mono, monospace)",
                          fontSize: "0.62rem",
                          letterSpacing: "0.04em",
                          color: selectedCluster?.color ?? "var(--text-secondary)",
                          padding: "2px 0",
                          opacity: 0.8,
                          transition: "opacity 0.12s ease",
                        }}
                        onMouseEnter={(e) => ((e.target as HTMLElement).style.opacity = "1")}
                        onMouseLeave={(e) => ((e.target as HTMLElement).style.opacity = "0.8")}
                      >
                        &#9656; {n.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Stats bar ────────────────────────────────────────────────── */}
      <footer className="cluster-stats-bar" role="contentinfo" aria-label="Neural statistics">
        <div className="graph-stats-bar__item">
          <span className="graph-stats-bar__key">NEURONS</span>
          <span className="graph-stats-bar__val">{neurons.length}</span>
        </div>
        <span className="graph-stats-bar__divider" aria-hidden="true">&#9472;</span>
        <div className="graph-stats-bar__item">
          <span className="graph-stats-bar__key">SYNAPSES</span>
          <span className="graph-stats-bar__val">{edges.length}</span>
        </div>
        <span className="graph-stats-bar__divider" aria-hidden="true">&#9472;</span>
        <div className="graph-stats-bar__item">
          <span
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.55rem",
              letterSpacing: "0.1em",
              color: "var(--text-faint)",
            }}
          >
            SCROLL TO ZOOM &nbsp;&#9632;&nbsp; DRAG TO PAN &nbsp;&#9632;&nbsp; ASK BELOW TO PULSE
          </span>
        </div>
      </footer>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="cluster-tooltip"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 8,
            borderColor: tooltip.color,
            color: tooltip.color,
          }}
          aria-hidden="true"
        >
          {tooltip.name}
        </div>
      )}
    </div>
  );
}
