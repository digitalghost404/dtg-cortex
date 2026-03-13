import { useRef, useCallback } from "react";

// ---------------------------------------------------------------------------
// Procedural sound effects via Web Audio API
// All sounds are synthesized — no audio files needed.
// ---------------------------------------------------------------------------

interface AudioPool {
  ctx: AudioContext;
  masterGain: GainNode;
}

export function useNeuralSounds() {
  const poolRef = useRef<AudioPool | null>(null);
  const lastPulseTimeRef = useRef(0);
  const lastActivationTimeRef = useRef(0);

  const getPool = useCallback((): AudioPool | null => {
    if (poolRef.current) return poolRef.current;
    try {
      const ctx = new AudioContext();
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.15; // keep it subtle
      masterGain.connect(ctx.destination);
      poolRef.current = { ctx, masterGain };
      return poolRef.current;
    } catch {
      return null;
    }
  }, []);

  // Resume audio context on first user interaction
  const ensureResumed = useCallback(() => {
    const pool = getPool();
    if (pool && pool.ctx.state === "suspended") {
      pool.ctx.resume();
    }
  }, [getPool]);

  // ── Neuron activation sound ───────────────────────────────────────────
  // A soft "pluck" / crystalline ping — higher pitch for higher scores
  const playActivation = useCallback(
    (score: number, sequenceIndex: number) => {
      const pool = getPool();
      if (!pool) return;

      const now = pool.ctx.currentTime;
      // Throttle: don't play more than one every 100ms
      if (now - lastActivationTimeRef.current < 0.1) return;
      lastActivationTimeRef.current = now;

      const delay = sequenceIndex * 0.15; // stagger with visuals

      // Base frequency: 400-900Hz based on score, with sequence variation
      const baseFreq = 400 + score * 300 + (sequenceIndex % 5) * 60;

      // Sine oscillator (fundamental)
      const osc = pool.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(baseFreq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + delay + 0.08);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, now + delay + 0.4);

      // Harmonic overtone
      const osc2 = pool.ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(baseFreq * 2.01, now + delay); // slight detune
      osc2.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + delay + 0.3);

      // Envelope
      const env = pool.ctx.createGain();
      env.gain.setValueAtTime(0, now + delay);
      env.gain.linearRampToValueAtTime(0.3 * score, now + delay + 0.02); // fast attack
      env.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.5);   // decay

      const env2 = pool.ctx.createGain();
      env2.gain.setValueAtTime(0, now + delay);
      env2.gain.linearRampToValueAtTime(0.1 * score, now + delay + 0.01);
      env2.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3);

      // Subtle reverb-like delay using a short delay node
      const delayNode = pool.ctx.createDelay(0.3);
      delayNode.delayTime.value = 0.12;
      const delayGain = pool.ctx.createGain();
      delayGain.gain.value = 0.2;

      osc.connect(env);
      osc2.connect(env2);
      env.connect(pool.masterGain);
      env2.connect(pool.masterGain);
      env.connect(delayNode);
      delayNode.connect(delayGain);
      delayGain.connect(pool.masterGain);

      osc.start(now + delay);
      osc2.start(now + delay);
      osc.stop(now + delay + 0.6);
      osc2.stop(now + delay + 0.4);
    },
    [getPool]
  );

  // ── Pulse particle travel sound ───────────────────────────────────────
  // A soft "whoosh" / electrical crackle — filtered noise
  const playPulseTravel = useCallback(() => {
    const pool = getPool();
    if (!pool) return;

    const now = pool.ctx.currentTime;
    // Throttle: max one every 500ms
    if (now - lastPulseTimeRef.current < 0.5) return;
    lastPulseTimeRef.current = now;

    // White noise burst → bandpass filter for "electrical" feel
    const bufferSize = pool.ctx.sampleRate * 0.3;
    const buffer = pool.ctx.createBuffer(1, bufferSize, pool.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.15));
    }

    const noise = pool.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = pool.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(2000, now);
    filter.frequency.exponentialRampToValueAtTime(800, now + 0.25);
    filter.Q.value = 3;

    const env = pool.ctx.createGain();
    env.gain.setValueAtTime(0.12, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    noise.connect(filter);
    filter.connect(env);
    env.connect(pool.masterGain);

    noise.start(now);
    noise.stop(now + 0.3);
  }, [getPool]);

  // ── Brain pulse ambient drone ─────────────────────────────────────────
  // Deep sub-bass throb when activation phase begins
  const playBrainPulse = useCallback(() => {
    const pool = getPool();
    if (!pool) return;

    const now = pool.ctx.currentTime;

    // Deep sine throb (40-60Hz)
    const osc = pool.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(45, now);
    osc.frequency.linearRampToValueAtTime(55, now + 0.5);
    osc.frequency.linearRampToValueAtTime(40, now + 1.2);

    // Sub-harmonic
    const osc2 = pool.ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(90, now);
    osc2.frequency.linearRampToValueAtTime(110, now + 0.4);
    osc2.frequency.linearRampToValueAtTime(85, now + 1.0);

    const env = pool.ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.35, now + 0.15);
    env.gain.setValueAtTime(0.35, now + 0.5);
    env.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

    const env2 = pool.ctx.createGain();
    env2.gain.setValueAtTime(0, now);
    env2.gain.linearRampToValueAtTime(0.12, now + 0.2);
    env2.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    osc.connect(env);
    osc2.connect(env2);
    env.connect(pool.masterGain);
    env2.connect(pool.masterGain);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + 1.6);
    osc2.stop(now + 1.3);
  }, [getPool]);

  // ── Cool-down shimmer ─────────────────────────────────────────────────
  // Gentle descending shimmer when cooling begins
  const playCooldown = useCallback(() => {
    const pool = getPool();
    if (!pool) return;

    const now = pool.ctx.currentTime;

    for (let i = 0; i < 4; i++) {
      const osc = pool.ctx.createOscillator();
      osc.type = "sine";
      const freq = 800 - i * 120;
      const start = now + i * 0.15;
      osc.frequency.setValueAtTime(freq, start);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.5, start + 0.6);

      const env = pool.ctx.createGain();
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(0.08, start + 0.03);
      env.gain.exponentialRampToValueAtTime(0.001, start + 0.7);

      osc.connect(env);
      env.connect(pool.masterGain);
      osc.start(start);
      osc.stop(start + 0.8);
    }
  }, [getPool]);

  return {
    ensureResumed,
    playActivation,
    playPulseTravel,
    playBrainPulse,
    playCooldown,
  };
}
