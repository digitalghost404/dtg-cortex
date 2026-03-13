import { useEffect, useRef, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Dream State — autonomous camera drift when user idles on Neural Pulse
// ---------------------------------------------------------------------------

const IDLE_TIMEOUT = 30_000; // 30 seconds before dreaming
const CLUSTER_CYCLE_INTERVAL = 8_000; // 8 seconds between cluster focus changes
const WAKE_TRANSITION_MS = 500; // smooth camera return on wake

export interface DreamState {
  isDreaming: boolean;
  /** Camera offset for dream drift */
  driftX: number;
  driftY: number;
  /** Zoom oscillation for dream effect */
  driftZoom: number;
  /** Currently focused cluster ID during dream */
  focusClusterId: number | null;
}

export function useNeuralDream(clusterIds: number[]) {
  const [isDreaming, setIsDreaming] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dreamStartRef = useRef(0);
  const clusterCycleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const focusClusterRef = useRef<number | null>(null);
  const [focusClusterId, setFocusClusterId] = useState<number | null>(null);
  const clusterIndexRef = useRef(0);
  const preDreamRef = useRef({ x: 0, y: 0, scale: 1 });

  // Reset idle timer on any user input
  const resetIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    if (isDreaming) {
      // Wake up
      setIsDreaming(false);
      setFocusClusterId(null);
      if (clusterCycleRef.current) {
        clearInterval(clusterCycleRef.current);
        clusterCycleRef.current = null;
      }
    }

    idleTimerRef.current = setTimeout(() => {
      // Enter dream state
      dreamStartRef.current = performance.now();
      clusterIndexRef.current = 0;
      setIsDreaming(true);

      // Start cycling through clusters
      if (clusterIds.length > 0) {
        setFocusClusterId(clusterIds[0]);
        focusClusterRef.current = clusterIds[0];
        clusterCycleRef.current = setInterval(() => {
          clusterIndexRef.current =
            (clusterIndexRef.current + 1) % clusterIds.length;
          const nextCluster = clusterIds[clusterIndexRef.current];
          setFocusClusterId(nextCluster);
          focusClusterRef.current = nextCluster;
        }, CLUSTER_CYCLE_INTERVAL);
      }
    }, IDLE_TIMEOUT);
  }, [isDreaming, clusterIds]);

  // Register event listeners for wake detection
  useEffect(() => {
    const events = ["mousemove", "mousedown", "keydown", "touchstart", "wheel"];
    const handler = () => resetIdle();

    for (const evt of events) {
      window.addEventListener(evt, handler, { passive: true });
    }

    // Start initial idle timer
    resetIdle();

    return () => {
      for (const evt of events) {
        window.removeEventListener(evt, handler);
      }
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      if (clusterCycleRef.current) clearInterval(clusterCycleRef.current);
    };
  }, [resetIdle]);

  // Compute dream drift values (called from render loop)
  const getDreamDrift = useCallback(
    (now: number): { driftX: number; driftY: number; driftZoom: number } => {
      if (!isDreaming) return { driftX: 0, driftY: 0, driftZoom: 1 };

      const elapsed = (now - dreamStartRef.current) / 1000;

      // Slow sinusoidal pan
      const driftX = Math.sin(elapsed * 0.15) * 40;
      const driftY = Math.cos(elapsed * 0.1) * 30;

      // Slow zoom oscillation between 0.95 and 1.05
      const driftZoom = 1 + Math.sin(elapsed * 0.08) * 0.05;

      return { driftX, driftY, driftZoom };
    },
    [isDreaming]
  );

  return {
    isDreaming,
    focusClusterId,
    getDreamDrift,
  };
}
