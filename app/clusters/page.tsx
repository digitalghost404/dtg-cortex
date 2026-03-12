"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/app/components/AuthProvider";

// ---------------------------------------------------------------------------
// Types (mirror the API response shape)
// ---------------------------------------------------------------------------

interface NotePoint {
  id: string;
  name: string;
  path: string;
  x: number;           // normalised [-1, 1]
  y: number;           // normalised [-1, 1]
  cluster: number;
  connections: number;
}

interface ClusterInfo {
  id: number;
  label: string;
  color: string;
  count: number;
}

interface ClustersData {
  points: NotePoint[];
  clusters: ClusterInfo[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BG_VOID = "#020408";

function nodeRadius(connections: number): number {
  return Math.min(18, 4 + Math.log2(connections + 1) * 3);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ClustersPage() {
  const { isAuthenticated, logout } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Data
  const [data, setData] = useState<ClustersData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Interaction
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });
  const hoveredPointRef = useRef<NotePoint | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<NotePoint | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; color: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Drag state
  const dragRef = useRef<{ isDragging: boolean; startX: number; startY: number }>({
    isDragging: false,
    startX: 0,
    startY: 0,
  });

  // Animation frame
  const rafRef = useRef<number | null>(null);

  // Keep latest data in ref so render loop stays current without re-binding
  const dataRef = useRef<ClustersData | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setLoading(true);
    fetch("/api/clusters")
      .then((r) => r.json())
      .then((d: ClustersData) => {
        dataRef.current = d;
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load clusters");
        setLoading(false);
      });
  }, []);

  // ---------------------------------------------------------------------------
  // Map note coords [-1,1] to canvas world space. Called each frame.
  // ---------------------------------------------------------------------------

  const toWorld = useCallback(
    (pt: NotePoint, canvasW: number, canvasH: number): { cx: number; cy: number } => {
      const padding = 80;
      const cx = padding + ((pt.x + 1) / 2) * (canvasW - padding * 2);
      const cy = padding + ((pt.y + 1) / 2) * (canvasH - padding * 2);
      return { cx, cy };
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Render loop
  // ---------------------------------------------------------------------------

  const startRenderLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      const { x: tx, y: ty, scale } = transformRef.current;
      const currentData = dataRef.current;
      const hovered = hoveredPointRef.current;
      const sq = searchQuery;

      // Clear
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Background
      ctx.fillStyle = BG_VOID;
      ctx.fillRect(0, 0, W, H);

      if (!currentData || currentData.points.length === 0) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      const { points, clusters } = currentData;

      // Build cluster color lookup
      const clusterColorMap = new Map<number, string>();
      for (const c of clusters) clusterColorMap.set(c.id, c.color);

      // Apply pan/zoom
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);

      // ── Compute world positions ──────────────────────────────────────────
      const worldPos = points.map((pt) => toWorld(pt, W, H));

      // ── Cluster centroids for labels ─────────────────────────────────────
      const centroidMap = new Map<number, { sx: number; sy: number; count: number }>();
      for (let i = 0; i < points.length; i++) {
        const cid = points[i].cluster;
        if (!centroidMap.has(cid)) centroidMap.set(cid, { sx: 0, sy: 0, count: 0 });
        const c = centroidMap.get(cid)!;
        c.sx += worldPos[i].cx;
        c.sy += worldPos[i].cy;
        c.count++;
      }

      // ── Draw cluster halo regions (subtle background blobs) ──────────────
      for (const [cid, cen] of centroidMap.entries()) {
        const color = clusterColorMap.get(cid) ?? "#22d3ee";
        const cx = cen.sx / cen.count;
        const cy = cen.sy / cen.count;

        // Find max radius from centroid
        let maxDist = 0;
        for (let i = 0; i < points.length; i++) {
          if (points[i].cluster !== cid) continue;
          const dx = worldPos[i].cx - cx;
          const dy = worldPos[i].cy - cy;
          maxDist = Math.max(maxDist, Math.sqrt(dx * dx + dy * dy));
        }
        const haloRadius = maxDist + 40;

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloRadius);
        // Parse hex to RGB for alpha
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        grad.addColorStop(0, `rgba(${r},${g},${b},0.04)`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
      }

      // ── Draw cluster label text at centroid ──────────────────────────────
      for (const cluster of clusters) {
        const cen = centroidMap.get(cluster.id);
        if (!cen) continue;
        const cx = cen.sx / cen.count;
        const cy = cen.sy / cen.count;

        ctx.save();
        ctx.font = `${Math.max(9, 10 / scale)}px "Geist Mono", monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = 0.45;

        // Measure and draw a subtle backing rect
        const textW = ctx.measureText(cluster.label).width;
        const textH = 14 / scale;
        ctx.fillStyle = BG_VOID;
        ctx.fillRect(cx - textW / 2 - 4, cy - textH / 2 - 2, textW + 8, textH + 4);

        ctx.globalAlpha = 0.55;
        ctx.fillStyle = cluster.color;
        ctx.fillText(cluster.label, cx, cy);
        ctx.restore();
      }

      // ── Draw nodes ───────────────────────────────────────────────────────
      const hoveredCluster = hovered?.cluster ?? -1;

      for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        const { cx, cy } = worldPos[i];
        const r = nodeRadius(pt.connections);
        const color = clusterColorMap.get(pt.cluster) ?? "#22d3ee";
        const isHov = hovered?.id === pt.id;
        const isClusterMate = hoveredCluster >= 0 && pt.cluster === hoveredCluster && !isHov;
        const isDimmed = hoveredCluster >= 0 && pt.cluster !== hoveredCluster && !isHov;
        const isSearchMatch =
          sq.length >= 1 && pt.name.toLowerCase().includes(sq.toLowerCase());

        // Parse color
        const rC = parseInt(color.slice(1, 3), 16);
        const gC = parseInt(color.slice(3, 5), 16);
        const bC = parseInt(color.slice(5, 7), 16);

        ctx.globalAlpha = isDimmed ? 0.18 : 1;

        // Search highlight ring
        if (isSearchMatch) {
          const searchGrad = ctx.createRadialGradient(cx, cy, r, cx, cy, r + 16);
          searchGrad.addColorStop(0, "rgba(251,191,36,0.55)");
          searchGrad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.beginPath();
          ctx.arc(cx, cy, r + 16, 0, Math.PI * 2);
          ctx.fillStyle = searchGrad;
          ctx.fill();
        }

        // Hovered cluster highlight
        if (isHov || isClusterMate) {
          const hGrad = ctx.createRadialGradient(cx, cy, r, cx, cy, r + 12);
          hGrad.addColorStop(0, `rgba(${rC},${gC},${bC},0.45)`);
          hGrad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.beginPath();
          ctx.arc(cx, cy, r + 12, 0, Math.PI * 2);
          ctx.fillStyle = hGrad;
          ctx.fill();
        }

        // Ambient glow
        const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r + 6);
        glowGrad.addColorStop(0, `rgba(${rC},${gC},${bC},0.35)`);
        glowGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
        ctx.fillStyle = glowGrad;
        ctx.fill();

        // Node fill
        const fillGrad = ctx.createRadialGradient(
          cx - r * 0.3,
          cy - r * 0.3,
          0,
          cx,
          cy,
          r
        );
        if (isSearchMatch) {
          fillGrad.addColorStop(0, "#fde68a");
          fillGrad.addColorStop(1, "#f59e0b");
        } else if (isHov) {
          fillGrad.addColorStop(0, "#ffffff");
          fillGrad.addColorStop(1, color);
        } else {
          fillGrad.addColorStop(0, `rgba(${rC},${gC},${bC},0.9)`);
          fillGrad.addColorStop(1, `rgba(${Math.round(rC * 0.4)},${Math.round(gC * 0.4)},${Math.round(bC * 0.4)},0.8)`);
        }
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = fillGrad;
        ctx.fill();

        // Stroke
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.strokeStyle = isHov
          ? "#ffffff"
          : isSearchMatch
          ? "#fbbf24"
          : `rgba(${rC},${gC},${bC},0.6)`;
        ctx.lineWidth = isHov ? 2 : 1;
        ctx.stroke();

        // Label for hovered nodes or at high zoom
        if (isHov || (scale > 1.5 && !isDimmed)) {
          ctx.font = `${Math.max(9, 10 / scale)}px "Geist Mono", monospace`;
          ctx.fillStyle = isHov ? "#ffffff" : `rgba(${rC},${gC},${bC},0.8)`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(pt.name, cx, cy + r + 4 / scale);
        }

        ctx.globalAlpha = 1;
      }

      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
  }, [searchQuery, toWorld]);

  // Restart render loop when searchQuery changes
  useEffect(() => {
    startRenderLoop();
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [startRenderLoop]);

  // Also start render loop when data arrives
  useEffect(() => {
    if (data) {
      dataRef.current = data;
      startRenderLoop();
    }
  }, [data, startRenderLoop]);

  // ---------------------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ---------------------------------------------------------------------------
  // Hit testing
  // ---------------------------------------------------------------------------

  const hitTest = useCallback(
    (canvasX: number, canvasY: number): NotePoint | null => {
      const canvas = canvasRef.current;
      if (!canvas || !dataRef.current) return null;
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      const { x: tx, y: ty, scale } = transformRef.current;
      const wx = (canvasX - tx) / scale;
      const wy = (canvasY - ty) / scale;

      let closest: NotePoint | null = null;
      let closestDist = Infinity;

      for (const pt of dataRef.current.points) {
        const { cx, cy } = (() => {
          const padding = 80;
          return {
            cx: padding + ((pt.x + 1) / 2) * (W - padding * 2),
            cy: padding + ((pt.y + 1) / 2) * (H - padding * 2),
          };
        })();
        const dx = cx - wx;
        const dy = cy - wy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const r = nodeRadius(pt.connections) + 5;
        if (dist < r && dist < closestDist) {
          closest = pt;
          closestDist = dist;
        }
      }
      return closest;
    },
    []
  );

  // ---------------------------------------------------------------------------
  // Mouse events
  // ---------------------------------------------------------------------------

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const drag = dragRef.current;

      if (drag.isDragging) {
        const dx = cx - drag.startX;
        const dy = cy - drag.startY;
        transformRef.current.x += dx;
        transformRef.current.y += dy;
        drag.startX = cx;
        drag.startY = cy;
        return;
      }

      const hit = hitTest(cx, cy);
      if (hit !== hoveredPointRef.current) {
        hoveredPointRef.current = hit;
        (e.target as HTMLCanvasElement).style.cursor = hit ? "pointer" : "grab";
        if (hit) {
          const clusterColor =
            dataRef.current?.clusters.find((c) => c.id === hit.cluster)?.color ?? "#22d3ee";
          setTooltip({ x: e.clientX, y: e.clientY, name: hit.name, color: clusterColor });
        } else {
          setTooltip(null);
        }
      } else if (hit) {
        const clusterColor =
          dataRef.current?.clusters.find((c) => c.id === hit.cluster)?.color ?? "#22d3ee";
        setTooltip({ x: e.clientX, y: e.clientY, name: hit.name, color: clusterColor });
      }
    },
    [hitTest]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const hit = hitTest(cx, cy);
      dragRef.current = { isDragging: !hit, startX: cx, startY: cy };
      if (!hit) {
        (e.target as HTMLCanvasElement).style.cursor = "grabbing";
      }
    },
    [hitTest]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag.isDragging) {
        // Was a click, not a pan drag
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const hit = hitTest(cx, cy);
        if (hit) {
          setSelectedPoint((prev) => (prev?.id === hit.id ? null : hit));
        } else {
          setSelectedPoint(null);
        }
      }
      dragRef.current = { isDragging: false, startX: 0, startY: 0 };
      (e.target as HTMLCanvasElement).style.cursor = hoveredPointRef.current ? "pointer" : "grab";
    },
    [hitTest]
  );

  const handleMouseLeave = useCallback(() => {
    hoveredPointRef.current = null;
    setTooltip(null);
    dragRef.current = { isDragging: false, startX: 0, startY: 0 };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const { x: tx, y: ty, scale } = transformRef.current;
    const newScale = Math.max(0.1, Math.min(10, scale * factor));
    transformRef.current = {
      x: cx - (cx - tx) * (newScale / scale),
      y: cy - (cy - ty) * (newScale / scale),
      scale: newScale,
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Touch events for mobile
  // ---------------------------------------------------------------------------

  const lastTouchRef = useRef<{ x: number; y: number; dist: number }>({ x: 0, y: 0, dist: 0 });

  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length === 1) {
        const touch = e.touches[0];
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const cx = touch.clientX - rect.left;
        const cy = touch.clientY - rect.top;
        const hit = hitTest(cx, cy);
        lastTouchRef.current = { x: touch.clientX, y: touch.clientY, dist: 0 };
        dragRef.current = { isDragging: !hit, startX: touch.clientX, startY: touch.clientY };
        if (hit) {
          // Immediately show as selected on touch-start for visual feedback
          hoveredPointRef.current = hit;
        }
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        lastTouchRef.current = { x: 0, y: 0, dist: Math.sqrt(dx * dx + dy * dy) };
        dragRef.current = { isDragging: false, startX: 0, startY: 0 };
      }
    },
    [hitTest]
  );

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const drag = dragRef.current;
      if (drag.isDragging) {
        const dx = touch.clientX - drag.startX;
        const dy = touch.clientY - drag.startY;
        transformRef.current.x += dx;
        transformRef.current.y += dy;
        drag.startX = touch.clientX;
        drag.startY = touch.clientY;
      }
    } else if (e.touches.length === 2) {
      const dx = e.touches[1].clientX - e.touches[0].clientX;
      const dy = e.touches[1].clientY - e.touches[0].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const factor = dist / (lastTouchRef.current.dist || dist);
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = midX - rect.left;
      const cy = midY - rect.top;
      const { x: tx, y: ty, scale } = transformRef.current;
      const newScale = Math.max(0.1, Math.min(10, scale * factor));
      transformRef.current = {
        x: cx - (cx - tx) * (newScale / scale),
        y: cy - (cy - ty) * (newScale / scale),
        scale: newScale,
      };
      lastTouchRef.current.dist = dist;
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      const changedTouch = e.changedTouches[0];

      if (!drag.isDragging && changedTouch) {
        // Was initiated on a node (isDragging=false means we hit a node in touchstart)
        // Treat as a tap — select the node
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const cx = changedTouch.clientX - rect.left;
        const cy = changedTouch.clientY - rect.top;
        const hit = hitTest(cx, cy);
        if (hit) {
          setSelectedPoint((prev) => (prev?.id === hit.id ? null : hit));
        } else {
          setSelectedPoint(null);
        }
      } else if (drag.isDragging && changedTouch) {
        // Was a pan — check if it moved; if not, treat as tap on empty canvas
        const totalDx = changedTouch.clientX - lastTouchRef.current.x;
        const totalDy = changedTouch.clientY - lastTouchRef.current.y;
        const moved = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
        if (moved < 8) {
          setSelectedPoint(null);
        }
      }

      hoveredPointRef.current = null;
      dragRef.current = { isDragging: false, startX: 0, startY: 0 };
    },
    [hitTest]
  );

  // Register touchmove with { passive: false } so preventDefault() works on mobile
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => canvas.removeEventListener("touchmove", handleTouchMove);
  }, [handleTouchMove]);

  // ---------------------------------------------------------------------------
  // Derived state for selected point panel
  // ---------------------------------------------------------------------------

  const selectedCluster = selectedPoint
    ? data?.clusters.find((c) => c.id === selectedPoint.cluster)
    : null;

  const nearbyPoints = selectedPoint
    ? (data?.points ?? [])
        .filter((p) => p.id !== selectedPoint.id && p.cluster === selectedPoint.cluster)
        .slice(0, 5)
    : [];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const totalNotes = data?.points.length ?? 0;
  const totalClusters = data?.clusters.length ?? 0;

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
      {/* ── Header ─────────────────────────────────────────────────────────── */}
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
        {/* Left */}
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
            CLUSTERS
          </h1>
        </div>

        {/* Right — nav + search */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "flex-end" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="FILTER..."
            className="graph-search"
            aria-label="Filter notes by name"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="btn-secondary"
              style={{ fontSize: "0.6rem", padding: "3px 8px", borderRadius: "2px" }}
              aria-label="Clear search"
            >
              CLR
            </button>
          )}
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

      {/* ── Canvas container ────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}
      >
        {/* Loading state */}
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
              COMPUTING SEMANTIC CLUSTERS...
            </span>
          </div>
        )}

        {/* Error state */}
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
            <div
              className="vault-panel"
              style={{ borderLeftColor: "#f87171", maxWidth: 400, margin: "1rem" }}
            >
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
                CLUSTER ERROR
              </p>
              <p
                style={{
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.7rem",
                  color: "#f87171",
                }}
              >
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          style={{ display: "block", cursor: "grab", touchAction: "none" }}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          aria-label="Topic clusters scatter plot"
          role="img"
        />

        {/* Cluster legend */}
        {data && data.clusters.length > 0 && (
          <aside className="cluster-legend" aria-label="Cluster legend">
            <p className="cluster-legend__title">CLUSTERS</p>
            {data.clusters.map((c) => (
              <div key={c.id} className="cluster-legend__item">
                <span
                  className="cluster-legend__dot"
                  style={{ background: c.color, boxShadow: `0 0 6px ${c.color}` }}
                />
                <span className="cluster-legend__label">{c.label}</span>
                <span className="cluster-legend__count">{c.count}</span>
              </div>
            ))}
          </aside>
        )}

        {/* Selected note info panel */}
        {selectedPoint && (
          <aside className="cluster-info-panel" role="complementary" aria-label="Note details">
            <div className="graph-info-panel__header">
              <span className="graph-info-panel__label">NOTE DETAIL</span>
              <button
                onClick={() => setSelectedPoint(null)}
                className="graph-info-panel__close"
                aria-label="Close note detail"
              >
                ×
              </button>
            </div>
            <div className="graph-info-panel__body">
              <p className="graph-info-panel__name">{selectedPoint.name}</p>
              <div className="graph-info-panel__rows">
                <div className="graph-info-panel__row">
                  <span className="graph-info-panel__key">PATH</span>
                  <span className="graph-info-panel__val graph-info-panel__val--faint">
                    {selectedPoint.path}
                  </span>
                </div>
                <div className="graph-info-panel__row">
                  <span className="graph-info-panel__key">CLUSTER</span>
                  <span
                    className="graph-info-panel__val"
                    style={{ color: selectedCluster?.color ?? "var(--cyan-bright)" }}
                  >
                    {selectedCluster?.label ?? `#${selectedPoint.cluster}`}
                  </span>
                </div>
                <div className="graph-info-panel__row">
                  <span className="graph-info-panel__key">CHUNKS</span>
                  <span className="graph-info-panel__val">{selectedPoint.connections}</span>
                </div>
              </div>

              {nearbyPoints.length > 0 && (
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
                    {nearbyPoints.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSelectedPoint(p)}
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
                        &#9656; {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <footer className="cluster-stats-bar" role="contentinfo" aria-label="Cluster statistics">
        <div className="graph-stats-bar__item">
          <span className="graph-stats-bar__key">NOTES</span>
          <span className="graph-stats-bar__val">{totalNotes}</span>
        </div>
        <span className="graph-stats-bar__divider" aria-hidden="true">&#9472;</span>
        <div className="graph-stats-bar__item">
          <span className="graph-stats-bar__key">CLUSTERS</span>
          <span className="graph-stats-bar__val">{totalClusters}</span>
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
            SCROLL TO ZOOM &nbsp;&#9632;&nbsp; DRAG TO PAN &nbsp;&#9632;&nbsp; CLICK NOTE FOR DETAIL
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
