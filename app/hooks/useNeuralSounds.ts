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

  // ── Neural Discharge — neuron activation ────────────────────────────
  // Static crackle transient layered with a downward sine sweep.
  // Sounds like an actual neuron firing — electrical impulse with
  // organic weight. The crackle provides attack, the sweep gives body.
  const playActivation = useCallback(
    (score: number, sequenceIndex: number) => {
      const pool = getPool();
      if (!pool) return;

      const now = pool.ctx.currentTime;
      if (now - lastActivationTimeRef.current < 0.1) return;
      lastActivationTimeRef.current = now;

      const delay = sequenceIndex * 0.15;
      const t0 = now + delay;

      // Layer 1: Static crackle — short noise burst through resonant filter
      const crackleLen = Math.floor(pool.ctx.sampleRate * 0.06);
      const crackleBuf = pool.ctx.createBuffer(1, crackleLen, pool.ctx.sampleRate);
      const crackleData = crackleBuf.getChannelData(0);
      for (let i = 0; i < crackleLen; i++) {
        // Sharp exponential decay with some randomized spikes
        const decay = Math.exp(-i / (crackleLen * 0.12));
        const spike = Math.random() > 0.92 ? 2.5 : 1; // occasional sharp pops
        crackleData[i] = (Math.random() * 2 - 1) * decay * spike;
      }
      const crackle = pool.ctx.createBufferSource();
      crackle.buffer = crackleBuf;

      // Resonant highpass gives the crackle an electrical edge
      const crackleFilter = pool.ctx.createBiquadFilter();
      crackleFilter.type = "highpass";
      crackleFilter.frequency.value = 800 + sequenceIndex * 200;
      crackleFilter.Q.value = 2.5;

      const crackleEnv = pool.ctx.createGain();
      crackleEnv.gain.setValueAtTime(0.4 * score, t0);
      crackleEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);

      crackle.connect(crackleFilter);
      crackleFilter.connect(crackleEnv);
      crackleEnv.connect(pool.masterGain);

      // Layer 2: Downward sine sweep — the "discharge" body
      // Starts at a frequency influenced by score, sweeps down fast
      const sweepFreq = 500 + score * 200 + (sequenceIndex % 4) * 50;
      const sweep = pool.ctx.createOscillator();
      sweep.type = "sine";
      sweep.frequency.setValueAtTime(sweepFreq, t0);
      sweep.frequency.exponentialRampToValueAtTime(80, t0 + 0.2);
      sweep.frequency.exponentialRampToValueAtTime(40, t0 + 0.35);

      const sweepEnv = pool.ctx.createGain();
      sweepEnv.gain.setValueAtTime(0, t0);
      sweepEnv.gain.linearRampToValueAtTime(0.2 * score, t0 + 0.008);
      sweepEnv.gain.exponentialRampToValueAtTime(0.04, t0 + 0.12);
      sweepEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.4);

      sweep.connect(sweepEnv);
      sweepEnv.connect(pool.masterGain);

      // Layer 3: Sub-frequency thud — weight under the discharge
      const thud = pool.ctx.createOscillator();
      thud.type = "sine";
      thud.frequency.setValueAtTime(90, t0);
      thud.frequency.exponentialRampToValueAtTime(45, t0 + 0.08);

      const thudEnv = pool.ctx.createGain();
      thudEnv.gain.setValueAtTime(0, t0);
      thudEnv.gain.linearRampToValueAtTime(0.15 * score, t0 + 0.005);
      thudEnv.gain.exponentialRampToValueAtTime(0.001, t0 + 0.18);

      thud.connect(thudEnv);
      thudEnv.connect(pool.masterGain);

      crackle.start(t0);
      sweep.start(t0);
      thud.start(t0);
      crackle.stop(t0 + 0.1);
      sweep.stop(t0 + 0.45);
      thud.stop(t0 + 0.2);
    },
    [getPool]
  );

  // ── Nerve Fiber Arc — pulse particle travel ───────────────────────────
  // Energy arcing along a nerve fiber. Core noise whoosh with a resonant
  // filter sweep (electrical/organic), sub-bass rumble, and a low crackle
  // texture. No clean shimmer — raw and physical.
  const playPulseTravel = useCallback(() => {
    const pool = getPool();
    if (!pool) return;

    const now = pool.ctx.currentTime;
    if (now - lastPulseTimeRef.current < 0.4) return;
    lastPulseTimeRef.current = now;

    const duration = 0.5;

    // Layer 1: Noise whoosh through resonant bandpass sweep
    const noiseLen = Math.floor(pool.ctx.sampleRate * duration);
    const noiseBuf = pool.ctx.createBuffer(1, noiseLen, pool.ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      const t = i / noiseLen;
      const shape = Math.sin(t * Math.PI) * (1 - t * 0.4);
      noiseData[i] = (Math.random() * 2 - 1) * shape;
    }
    const noise = pool.ctx.createBufferSource();
    noise.buffer = noiseBuf;

    // Resonant sweep — tighter Q, mid-range, more electrical
    const noiseFilter = pool.ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.setValueAtTime(200, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(1800, now + duration * 0.6);
    noiseFilter.frequency.exponentialRampToValueAtTime(600, now + duration);
    noiseFilter.Q.setValueAtTime(3, now);
    noiseFilter.Q.linearRampToValueAtTime(6, now + duration * 0.5);
    noiseFilter.Q.linearRampToValueAtTime(2, now + duration);

    const noiseEnv = pool.ctx.createGain();
    noiseEnv.gain.setValueAtTime(0, now);
    noiseEnv.gain.linearRampToValueAtTime(0.2, now + 0.04);
    noiseEnv.gain.setValueAtTime(0.18, now + duration * 0.45);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseEnv);
    noiseEnv.connect(pool.masterGain);

    // Layer 2: Sub-bass rumble — low sine sweep for physical weight
    const rumble = pool.ctx.createOscillator();
    rumble.type = "sine";
    rumble.frequency.setValueAtTime(60, now);
    rumble.frequency.linearRampToValueAtTime(100, now + duration * 0.4);
    rumble.frequency.linearRampToValueAtTime(50, now + duration);

    const rumbleEnv = pool.ctx.createGain();
    rumbleEnv.gain.setValueAtTime(0, now);
    rumbleEnv.gain.linearRampToValueAtTime(0.15, now + 0.03);
    rumbleEnv.gain.linearRampToValueAtTime(0.12, now + duration * 0.5);
    rumbleEnv.gain.exponentialRampToValueAtTime(0.001, now + duration);

    rumble.connect(rumbleEnv);
    rumbleEnv.connect(pool.masterGain);

    // Layer 3: Low crackle texture — noise through highpass, quiet
    const crackleLen = Math.floor(pool.ctx.sampleRate * duration * 0.7);
    const crackleBuf = pool.ctx.createBuffer(1, crackleLen, pool.ctx.sampleRate);
    const crackleData = crackleBuf.getChannelData(0);
    for (let i = 0; i < crackleLen; i++) {
      const t = i / crackleLen;
      // Sparse pops
      crackleData[i] = Math.random() > 0.95
        ? (Math.random() * 2 - 1) * (1 - t)
        : (Math.random() * 2 - 1) * 0.1 * (1 - t);
    }
    const crackle = pool.ctx.createBufferSource();
    crackle.buffer = crackleBuf;

    const crackleFilter = pool.ctx.createBiquadFilter();
    crackleFilter.type = "highpass";
    crackleFilter.frequency.value = 1200;
    crackleFilter.Q.value = 1;

    const crackleEnv = pool.ctx.createGain();
    crackleEnv.gain.setValueAtTime(0.1, now);
    crackleEnv.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.7);

    crackle.connect(crackleFilter);
    crackleFilter.connect(crackleEnv);
    crackleEnv.connect(pool.masterGain);

    // Layer 4: Sub-impact at tail end — arrival thud
    const impactTime = now + duration * 0.7;
    const impact = pool.ctx.createOscillator();
    impact.type = "sine";
    impact.frequency.setValueAtTime(70, impactTime);
    impact.frequency.exponentialRampToValueAtTime(35, impactTime + 0.1);

    const impactEnv = pool.ctx.createGain();
    impactEnv.gain.setValueAtTime(0, impactTime);
    impactEnv.gain.linearRampToValueAtTime(0.2, impactTime + 0.008);
    impactEnv.gain.exponentialRampToValueAtTime(0.001, impactTime + 0.14);

    impact.connect(impactEnv);
    impactEnv.connect(pool.masterGain);

    noise.start(now);
    rumble.start(now);
    crackle.start(now);
    impact.start(impactTime);

    noise.stop(now + duration + 0.05);
    rumble.stop(now + duration + 0.05);
    crackle.stop(now + duration * 0.7 + 0.05);
    impact.stop(impactTime + 0.18);
  }, [getPool]);

  // ── Brain pulse — activation phase ────────────────────────────────────
  // Deep sub-bass throb when activation phase begins
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

  // ── Neural Fade-Out — cooldown ────────────────────────────────────────
  // Electrical activity dissipating into silence. Descending filtered
  // noise (highpass sweep closing down) layered with a fading low drone
  // tail. Organic, not melodic — the brain quieting down.
  const playCooldown = useCallback(() => {
    const pool = getPool();
    if (!pool) return;

    const now = pool.ctx.currentTime;
    const duration = 1.2;

    // Layer 1: Descending noise — highpass filter sweeps down, closing off
    const noiseLen = Math.floor(pool.ctx.sampleRate * duration);
    const noiseBuf = pool.ctx.createBuffer(1, noiseLen, pool.ctx.sampleRate);
    const noiseData = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      const t = i / noiseLen;
      // Decaying amplitude with occasional small pops
      const decay = Math.pow(1 - t, 1.5);
      const pop = Math.random() > 0.97 ? 1.8 : 1;
      noiseData[i] = (Math.random() * 2 - 1) * decay * pop;
    }
    const noise = pool.ctx.createBufferSource();
    noise.buffer = noiseBuf;

    // Highpass sweep: starts open (200Hz), closes down to muffle (2000Hz)
    const noiseFilter = pool.ctx.createBiquadFilter();
    noiseFilter.type = "highpass";
    noiseFilter.frequency.setValueAtTime(200, now);
    noiseFilter.frequency.exponentialRampToValueAtTime(2000, now + duration * 0.7);
    noiseFilter.frequency.exponentialRampToValueAtTime(4000, now + duration);
    noiseFilter.Q.value = 1.5;

    // Second lowpass to keep it from getting too harsh
    const lpFilter = pool.ctx.createBiquadFilter();
    lpFilter.type = "lowpass";
    lpFilter.frequency.setValueAtTime(3000, now);
    lpFilter.frequency.exponentialRampToValueAtTime(800, now + duration);
    lpFilter.Q.value = 0.7;

    const noiseEnv = pool.ctx.createGain();
    noiseEnv.gain.setValueAtTime(0.18, now);
    noiseEnv.gain.linearRampToValueAtTime(0.12, now + duration * 0.3);
    noiseEnv.gain.exponentialRampToValueAtTime(0.001, now + duration);

    noise.connect(noiseFilter);
    noiseFilter.connect(lpFilter);
    lpFilter.connect(noiseEnv);
    noiseEnv.connect(pool.masterGain);

    // Layer 2: Fading drone tail — low sine that decays out
    const droneTail = pool.ctx.createOscillator();
    droneTail.type = "sine";
    droneTail.frequency.setValueAtTime(70, now);
    droneTail.frequency.linearRampToValueAtTime(50, now + duration);

    const droneTail2 = pool.ctx.createOscillator();
    droneTail2.type = "sine";
    droneTail2.frequency.setValueAtTime(72, now); // slight detune
    droneTail2.frequency.linearRampToValueAtTime(48, now + duration);

    const droneEnv = pool.ctx.createGain();
    droneEnv.gain.setValueAtTime(0.15, now);
    droneEnv.gain.exponentialRampToValueAtTime(0.001, now + duration);

    const droneEnv2 = pool.ctx.createGain();
    droneEnv2.gain.setValueAtTime(0.08, now);
    droneEnv2.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.8);

    droneTail.connect(droneEnv);
    droneTail2.connect(droneEnv2);
    droneEnv.connect(pool.masterGain);
    droneEnv2.connect(pool.masterGain);

    // Layer 3: Final sparse crackle — last few electrical pops
    const crackleLen = Math.floor(pool.ctx.sampleRate * duration * 0.5);
    const crackleBuf = pool.ctx.createBuffer(1, crackleLen, pool.ctx.sampleRate);
    const crackleData = crackleBuf.getChannelData(0);
    for (let i = 0; i < crackleLen; i++) {
      const t = i / crackleLen;
      // Very sparse — only occasional pops that fade out
      crackleData[i] = Math.random() > 0.985
        ? (Math.random() * 2 - 1) * Math.pow(1 - t, 2)
        : 0;
    }
    const crackle = pool.ctx.createBufferSource();
    crackle.buffer = crackleBuf;

    const crackleFilter2 = pool.ctx.createBiquadFilter();
    crackleFilter2.type = "bandpass";
    crackleFilter2.frequency.value = 1500;
    crackleFilter2.Q.value = 2;

    const crackleEnv = pool.ctx.createGain();
    crackleEnv.gain.setValueAtTime(0.15, now + 0.1);
    crackleEnv.gain.exponentialRampToValueAtTime(0.001, now + duration * 0.5);

    crackle.connect(crackleFilter2);
    crackleFilter2.connect(crackleEnv);
    crackleEnv.connect(pool.masterGain);

    noise.start(now);
    droneTail.start(now);
    droneTail2.start(now);
    crackle.start(now + 0.1);

    noise.stop(now + duration + 0.05);
    droneTail.stop(now + duration + 0.05);
    droneTail2.stop(now + duration + 0.05);
    crackle.stop(now + duration * 0.5 + 0.1);
  }, [getPool]);

  // Dream mode: lower master gain and detune oscillators
  const setDreamMode = useCallback((dreaming: boolean) => {
    const pool = poolRef.current;
    if (!pool) return;
    const now = pool.ctx.currentTime;
    const targetGain = dreaming ? 0.06 : 0.15;
    pool.masterGain.gain.cancelScheduledValues(now);
    pool.masterGain.gain.setValueAtTime(pool.masterGain.gain.value, now);
    pool.masterGain.gain.linearRampToValueAtTime(targetGain, now + 0.5);

    // Detune active drone oscillators for eerie drift
    if (droneRef.current) {
      const detune = dreaming ? -200 : 0;
      droneRef.current.osc1.detune.setValueAtTime(detune, now);
      droneRef.current.osc2.detune.setValueAtTime(detune, now);
      droneRef.current.shimmer.detune.setValueAtTime(detune, now);
    }
  }, []);

  return {
    ensureResumed,
    startHeartbeat,
    stopHeartbeat,
    playActivation,
    playPulseTravel,
    playBrainPulse,
    playCooldown,
    setDreamMode,
  };
}
