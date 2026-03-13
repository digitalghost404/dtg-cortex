import { useRef, useCallback } from "react";
import type { NeuronNode, NeuralEdge } from "./useNeuralGraph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AnimPhase = "idle" | "activating" | "propagating" | "cooling";

export interface PulseParticle {
  active: boolean;
  edgeIdx: number;
  progress: number; // 0-1 along edge
  speed: number;
  brightness: number;
  forward: boolean; // direction along edge
}

export interface RippleEffect {
  neuronIdx: number;
  startTime: number;
  duration: number; // ms
}

export interface AnimState {
  // Per-neuron activation level (0 = idle, 1 = fully lit)
  activations: Float32Array;
  // Per-neuron breathing phase offset (randomized for organic feel)
  breathingOffsets: Float32Array;
  // Pulse particles
  particles: PulseParticle[];
  // Ripple effects
  ripples: RippleEffect[];
  // Current phase
  phase: AnimPhase;
  // Time of last source arrival
  lastActivationTime: number;
  // Sequence counter for staggered activation
  activationQueue: { neuronIdx: number; score: number; triggerTime: number }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BREATHING_CYCLE = 7000; // ms
const DREAM_BREATHING_CYCLE = 12000; // slower when dreaming
const IDLE_PULSE_INTERVAL = 3000; // ms between random dim edge pulses
const ACTIVATION_STAGGER = 200; // ms between sequential source activations
const ACTIVATION_RAMP = 300; // ms to ramp up
const PROPAGATION_DELAY = 400; // ms after last source before propagating
const COOLING_DECAY = 0.985; // per frame multiplier
const COOLING_THRESHOLD = 0.01;
const PARTICLE_POOL_SIZE = 50;
const RIPPLE_DURATION = 600; // ms

// Easing: easeOutQuart
function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useNeuralAnimation(
  neurons: NeuronNode[],
  edges: NeuralEdge[]
) {
  const stateRef = useRef<AnimState | null>(null);
  const lastIdlePulseRef = useRef(0);
  const neuronCountRef = useRef(0);

  // Initialize or reinitialize when neuron count changes
  if (neurons.length > 0 && neurons.length !== neuronCountRef.current) {
    neuronCountRef.current = neurons.length;
    const activations = new Float32Array(neurons.length);
    const breathingOffsets = new Float32Array(neurons.length);
    for (let i = 0; i < neurons.length; i++) {
      // Deterministic-ish offset based on position
      breathingOffsets[i] = ((neurons[i].x + 1) * 1000 + (neurons[i].y + 1) * 500) % BREATHING_CYCLE;
    }
    const particles: PulseParticle[] = [];
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      particles.push({
        active: false,
        edgeIdx: 0,
        progress: 0,
        speed: 0,
        brightness: 0,
        forward: true,
      });
    }
    stateRef.current = {
      activations,
      breathingOffsets,
      particles,
      ripples: [],
      phase: "idle",
      lastActivationTime: 0,
      activationQueue: [],
    };
  }

  // Activate a neuron (called when a source arrives)
  const activateNeuron = useCallback(
    (neuronIdx: number, score: number, sequenceIndex: number) => {
      const state = stateRef.current;
      if (!state || neuronIdx < 0 || neuronIdx >= neurons.length) return;

      const triggerTime = performance.now() + sequenceIndex * ACTIVATION_STAGGER;
      state.activationQueue.push({ neuronIdx, score, triggerTime });
      state.phase = "activating";
    },
    [neurons.length]
  );

  // Spawn a pulse particle on a random available slot
  const spawnParticle = useCallback(
    (edgeIdx: number, brightness: number, forward: boolean) => {
      const state = stateRef.current;
      if (!state) return;
      for (const p of state.particles) {
        if (!p.active) {
          p.active = true;
          p.edgeIdx = edgeIdx;
          p.progress = forward ? 0 : 1;
          p.speed = 0.008 + Math.random() * 0.006; // per frame
          p.brightness = brightness;
          p.forward = forward;
          return;
        }
      }
    },
    []
  );

  // Main tick — call once per frame
  const tick = useCallback(
    (now: number) => {
      const state = stateRef.current;
      if (!state) return;

      const { activations, activationQueue, particles, ripples } = state;

      // ── Process activation queue ──────────────────────────────────────
      for (let i = activationQueue.length - 1; i >= 0; i--) {
        const entry = activationQueue[i];
        if (now >= entry.triggerTime) {
          const elapsed = now - entry.triggerTime;
          const t = Math.min(elapsed / ACTIVATION_RAMP, 1);
          const value = easeOutQuart(t) * entry.score;
          activations[entry.neuronIdx] = Math.max(activations[entry.neuronIdx], value);

          if (t >= 1) {
            // Fully ramped — remove from queue, add ripple
            activationQueue.splice(i, 1);
            state.lastActivationTime = now;
            ripples.push({
              neuronIdx: entry.neuronIdx,
              startTime: now,
              duration: RIPPLE_DURATION,
            });
          }
        }
      }

      // ── Phase transitions ─────────────────────────────────────────────
      if (state.phase === "activating" && activationQueue.length === 0) {
        if (now - state.lastActivationTime > PROPAGATION_DELAY) {
          state.phase = "propagating";
          // Spawn pulse particles from activated neurons along edges
          for (let ei = 0; ei < edges.length; ei++) {
            const edge = edges[ei];
            const srcAct = activations[edge.source];
            const tgtAct = activations[edge.target];
            if (srcAct > 0.3) {
              spawnParticle(ei, srcAct * 0.8, true);
            }
            if (tgtAct > 0.3) {
              spawnParticle(ei, tgtAct * 0.8, false);
            }
          }
          // Short propagation window then transition to cooling
          setTimeout(() => {
            if (stateRef.current) stateRef.current.phase = "cooling";
          }, 800);
        }
      }

      // ── Cooling: decay activations ────────────────────────────────────
      if (state.phase === "cooling") {
        let anyActive = false;
        for (let i = 0; i < activations.length; i++) {
          if (activations[i] > COOLING_THRESHOLD) {
            activations[i] *= COOLING_DECAY;
            anyActive = true;
          } else {
            activations[i] = 0;
          }
        }
        if (!anyActive) {
          state.phase = "idle";
        }
      }

      // ── Update pulse particles ────────────────────────────────────────
      for (const p of particles) {
        if (!p.active) continue;
        if (p.forward) {
          p.progress += p.speed;
          if (p.progress >= 1) {
            p.active = false;
            // Chain: activate target neuron slightly
            const edge = edges[p.edgeIdx];
            if (edge && activations[edge.target] < 0.2) {
              activations[edge.target] = Math.max(activations[edge.target], p.brightness * 0.3);
            }
          }
        } else {
          p.progress -= p.speed;
          if (p.progress <= 0) {
            p.active = false;
            const edge = edges[p.edgeIdx];
            if (edge && activations[edge.source] < 0.2) {
              activations[edge.source] = Math.max(activations[edge.source], p.brightness * 0.3);
            }
          }
        }
        p.brightness *= 0.997; // gentle fade
      }

      // ── Clean up expired ripples ──────────────────────────────────────
      for (let i = ripples.length - 1; i >= 0; i--) {
        if (now - ripples[i].startTime > ripples[i].duration) {
          ripples.splice(i, 1);
        }
      }

      // ── Idle: random dim edge pulses ──────────────────────────────────
      if (state.phase === "idle" && edges.length > 0) {
        if (now - lastIdlePulseRef.current > IDLE_PULSE_INTERVAL) {
          lastIdlePulseRef.current = now;
          const randomEdge = Math.floor(Math.random() * edges.length);
          spawnParticle(randomEdge, 0.25, Math.random() > 0.5);
        }
      }
    },
    [edges, spawnParticle]
  );

  return {
    animStateRef: stateRef,
    activateNeuron,
    tick,
    getPhase: () => stateRef.current?.phase ?? "idle",
  };
}
