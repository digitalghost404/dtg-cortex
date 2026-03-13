import { useRef, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// Procedural sound effects via Web Audio API
// All sounds are synthesized — no audio files needed.
// ---------------------------------------------------------------------------

interface AudioPool {
  ctx: AudioContext;
  masterGain: GainNode;
}

// Persistent nodes for the pulsating brain drone
interface BrainDrone {
  // Core oscillators
  osc1: OscillatorNode;
  osc2: OscillatorNode;
  // High shimmer
  shimmer: OscillatorNode;
  // LFO for amplitude modulation (the pulsation)
  lfo: OscillatorNode;
  lfoGain: GainNode;
  // Master envelope for drone
  droneGain: GainNode;
  // Extra nodes to stop on cleanup
  extras: (OscillatorNode | GainNode)[];
}

export function useNeuralSounds() {
  const poolRef = useRef<AudioPool | null>(null);
  const lastPulseTimeRef = useRef(0);
  const lastActivationTimeRef = useRef(0);
  const droneRef = useRef<BrainDrone | null>(null);
  const droneActiveRef = useRef(false);

  const getPool = useCallback((): AudioPool | null => {
    if (poolRef.current) return poolRef.current;
    try {
      const ctx = new AudioContext();
      const masterGain = ctx.createGain();
      masterGain.gain.value = 0.15;
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

  // ── Pulsating Brain Drone ─────────────────────────────────────────────
  // Continuous low-frequency pulsating hum with amplitude modulation.
  // Inspired by Blake's 7 pulsating brain SFX — eerie, rhythmic,
  // throbbing electronic drone. Synced to the 7s breathing cycle via
  // an LFO at ~0.143 Hz (1/7s).
  //
  // Architecture:
  //   osc1 (sine 65Hz) ──┐
  //   osc2 (sine 67Hz) ──┼──► droneGain ──► masterGain
  //   shimmer (sine 520Hz, quiet) ──┘
  //                          ▲
  //   lfo (sine 0.143Hz) ──► lfoGain (modulates droneGain.gain)

  const startHeartbeat = useCallback(() => {
    if (droneActiveRef.current) return;
    const pool = getPool();
    if (!pool) return;
    if (pool.ctx.state === "suspended") return;

    droneActiveRef.current = true;
    const ctx = pool.ctx;
    const now = ctx.currentTime;

    // ── Core drone: two slightly detuned sine oscillators ──────────
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = 65; // low E-ish

    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = 67.5; // slight detune → beating/thickness

    // Individual gains to mix
    const osc1Gain = ctx.createGain();
    osc1Gain.gain.value = 0.5;
    const osc2Gain = ctx.createGain();
    osc2Gain.gain.value = 0.35;

    // ── High shimmer — adds an eerie overtone ──────────────────────
    const shimmer = ctx.createOscillator();
    shimmer.type = "sine";
    shimmer.frequency.value = 520; // ~8th harmonic, quiet

    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.04;

    // ── Second shimmer for warble — slightly detuned ───────────────
    const shimmer2 = ctx.createOscillator();
    shimmer2.type = "sine";
    shimmer2.frequency.value = 525;

    const shimmer2Gain = ctx.createGain();
    shimmer2Gain.gain.value = 0.025;

    // ── Drone master gain (target of LFO modulation) ───────────────
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.6; // base level, LFO modulates around this

    // ── LFO: amplitude modulation for the pulsating throb ──────────
    // 0.143 Hz = one full cycle per 7 seconds (synced to breathing)
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 1 / 7; // synced to BREATHING_CYCLE

    // LFO modulation depth — swings gain ±0.4 around the 0.6 base
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.4;

    // ── Second LFO: subtle faster wobble for texture ───────────────
    const lfo2 = ctx.createOscillator();
    lfo2.type = "sine";
    lfo2.frequency.value = 0.37; // slightly faster wobble

    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.value = 0.08;

    // ── Wiring ─────────────────────────────────────────────────────
    osc1.connect(osc1Gain);
    osc2.connect(osc2Gain);
    shimmer.connect(shimmerGain);
    shimmer2.connect(shimmer2Gain);

    osc1Gain.connect(droneGain);
    osc2Gain.connect(droneGain);
    shimmerGain.connect(droneGain);
    shimmer2Gain.connect(droneGain);

    // LFO → droneGain.gain (amplitude modulation)
    lfo.connect(lfoGain);
    lfoGain.connect(droneGain.gain);
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(droneGain.gain);

    droneGain.connect(pool.masterGain);

    // Fade in over 1.5s for smooth entry
    droneGain.gain.setValueAtTime(0, now);
    droneGain.gain.linearRampToValueAtTime(0.6, now + 1.5);

    // Start all
    osc1.start(now);
    osc2.start(now);
    shimmer.start(now);
    shimmer2.start(now);
    lfo.start(now);
    lfo2.start(now);

    droneRef.current = {
      osc1, osc2, shimmer, lfo, lfoGain, droneGain,
      extras: [osc1Gain, osc2Gain, shimmerGain, shimmer2Gain, lfo2, lfo2Gain],
    };
  }, [getPool]);

  const stopHeartbeat = useCallback(() => {
    if (!droneActiveRef.current || !droneRef.current) return;
    const pool = poolRef.current;
    if (!pool) return;

    const drone = droneRef.current;
    const now = pool.ctx.currentTime;

    // Fade out over 0.8s then stop
    drone.droneGain.gain.cancelScheduledValues(now);
    drone.droneGain.gain.setValueAtTime(drone.droneGain.gain.value, now);
    drone.droneGain.gain.linearRampToValueAtTime(0, now + 0.8);

    const stopTime = now + 0.85;
    drone.osc1.stop(stopTime);
    drone.osc2.stop(stopTime);
    drone.shimmer.stop(stopTime);
    drone.lfo.stop(stopTime);

    // Stop extra oscillators
    for (const node of drone.extras) {
      if ("stop" in node && typeof node.stop === "function") {
        (node as OscillatorNode).stop(stopTime);
      }
    }

    droneRef.current = null;
    droneActiveRef.current = false;
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (droneRef.current) {
        try {
          droneRef.current.osc1.stop();
          droneRef.current.osc2.stop();
          droneRef.current.shimmer.stop();
          droneRef.current.lfo.stop();
        } catch {
          // already stopped
        }
        droneRef.current = null;
        droneActiveRef.current = false;
      }
    };
  }, []);

  // ── Neuron activation sound ───────────────────────────────────────────
  const playActivation = useCallback(
    (score: number, sequenceIndex: number) => {
      const pool = getPool();
      if (!pool) return;

      const now = pool.ctx.currentTime;
      if (now - lastActivationTimeRef.current < 0.1) return;
      lastActivationTimeRef.current = now;

      const delay = sequenceIndex * 0.15;
      const baseFreq = 400 + score * 300 + (sequenceIndex % 5) * 60;

      const osc = pool.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(baseFreq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + delay + 0.08);
      osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.8, now + delay + 0.4);

      const osc2 = pool.ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(baseFreq * 2.01, now + delay);
      osc2.frequency.exponentialRampToValueAtTime(baseFreq * 1.5, now + delay + 0.3);

      const env = pool.ctx.createGain();
      env.gain.setValueAtTime(0, now + delay);
      env.gain.linearRampToValueAtTime(0.3 * score, now + delay + 0.02);
      env.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.5);

      const env2 = pool.ctx.createGain();
      env2.gain.setValueAtTime(0, now + delay);
      env2.gain.linearRampToValueAtTime(0.1 * score, now + delay + 0.01);
      env2.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3);

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

  // ── Cinematic pulse whoosh ────────────────────────────────────────────
  // Dramatic rising sweep with layered noise, resonant tonal rise, and
  // a soft sub-impact on arrival — inspired by cinematic transition SFX.
  const playPulseTravel = useCallback(() => {
    const pool = getPool();
    if (!pool) return;

    const now = pool.ctx.currentTime;
    if (now - lastPulseTimeRef.current < 0.4) return;
    lastPulseTimeRef.current = now;

    const duration = 0.55;

    // Layer 1: Swept noise whoosh
    const noiseLen = Math.floor(pool.ctx.sampleRate * duration);
    const noiseBuf = pool.ctx.createBuffer(1, noiseLen, pool.ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      const t = i / noiseLen;
      const shape = Math.sin(t * Math.PI) * (1 - t * 0.3);
      noiseData[i] = (Math.random() * 2 - 1) * shape;
    }
    const noise = pool.ctx.createBufferSource();
    noise.buffer = noiseBuf;

    const noiseFilter = pool.ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(300, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(3500, now + duration * 0.7);
    noiseFilter.frequency.exponentialRampToValueAtTime(1200, now + duration);
    noiseFilter.Q.setValueAtTime(1.5, now);
    noiseFilter.Q.linearRampToValueAtTime(4, now + duration * 0.6);
    noiseFilter.Q.linearRampToValueAtTime(1, now + duration);

    const noiseEnv = pool.ctx.createGain();
    noiseEnv.gain.setValueAtTime(0, now);
    noiseEnv.gain.linearRampToValueAtTime(0.22, now + 0.06);
    noiseEnv.gain.setValueAtTime(0.22, now + duration * 0.5);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseEnv);
    noiseEnv.connect(pool.masterGain);

    // Layer 2: Tonal rise
    const riseOsc = pool.ctx.createOscillator();
    riseOsc.type = "sine";
    riseOsc.frequency.setValueAtTime(120, now);
    riseOsc.frequency.exponentialRampToValueAtTime(800, now + duration * 0.75);
    riseOsc.frequency.exponentialRampToValueAtTime(400, now + duration);

    const riseEnv = pool.ctx.createGain();
    riseEnv.gain.setValueAtTime(0, now);
    riseEnv.gain.linearRampToValueAtTime(0.08, now + 0.05);
    riseEnv.gain.linearRampToValueAtTime(0.12, now + duration * 0.6);
    riseEnv.gain.exponentialRampToValueAtTime(0.001, now + duration);

    riseOsc.connect(riseEnv);
    riseEnv.connect(pool.masterGain);

    // Layer 3: Sub-impact on arrival
    const impactTime = now + duration * 0.72;
    const impactOsc = pool.ctx.createOscillator();
    impactOsc.type = "sine";
    impactOsc.frequency.setValueAtTime(80, impactTime);
    impactOsc.frequency.exponentialRampToValueAtTime(40, impactTime + 0.1);

    const impactEnv = pool.ctx.createGain();
    impactEnv.gain.setValueAtTime(0, impactTime);
    impactEnv.gain.linearRampToValueAtTime(0.25, impactTime + 0.01);
    impactEnv.gain.exponentialRampToValueAtTime(0.001, impactTime + 0.15);

    impactOsc.connect(impactEnv);
    impactEnv.connect(pool.masterGain);

    // Layer 4: High shimmer
    const shimmerOsc = pool.ctx.createOscillator();
    shimmerOsc.type = "sine";
    shimmerOsc.frequency.setValueAtTime(2200, now + 0.05);
    shimmerOsc.frequency.exponentialRampToValueAtTime(4500, now + duration * 0.6);
    shimmerOsc.frequency.exponentialRampToValueAtTime(1800, now + duration);

    const shimmerEnv = pool.ctx.createGain();
    shimmerEnv.gain.setValueAtTime(0, now);
    shimmerEnv.gain.linearRampToValueAtTime(0.03, now + duration * 0.2);
    shimmerEnv.gain.linearRampToValueAtTime(0.05, now + duration * 0.55);
    shimmerEnv.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.9);

    shimmerOsc.connect(shimmerEnv);
    shimmerEnv.connect(pool.masterGain);

    noise.start(now);
    riseOsc.start(now);
    impactOsc.start(impactTime);
    shimmerOsc.start(now);

    noise.stop(now + duration + 0.05);
    riseOsc.stop(now + duration + 0.05);
    impactOsc.stop(impactTime + 0.2);
    shimmerOsc.stop(now + duration + 0.05);
  }, [getPool]);

  // ── Brain pulse — activation phase ────────────────────────────────────
  const playBrainPulse = useCallback(() => {
    const pool = getPool();
    if (!pool) return;

    const now = pool.ctx.currentTime;

    const osc = pool.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(45, now);
    osc.frequency.linearRampToValueAtTime(55, now + 0.5);
    osc.frequency.linearRampToValueAtTime(40, now + 1.2);

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
    startHeartbeat,
    stopHeartbeat,
    playActivation,
    playPulseTravel,
    playBrainPulse,
    playCooldown,
  };
}
