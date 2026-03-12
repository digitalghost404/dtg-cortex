"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "@/app/components/AuthProvider";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import type { GraphData, GraphNode, GraphEdge } from "@/app/api/graph/route";
import type { WatcherEvent } from "@/lib/watcher-events";

// ---------------------------------------------------------------------------
// Extended simulation types
// ---------------------------------------------------------------------------

interface SimNode extends SimulationNodeDatum, GraphNode {
  // d3 fills in x, y, vx, vy at runtime — declared via SimulationNodeDatum
  connectionCount: number;
}

type SimLink = SimulationLinkDatum<SimNode> & GraphEdge;

// ---------------------------------------------------------------------------
// Pulse types
// ---------------------------------------------------------------------------

interface PulseState {
  startTime: number;
  type: WatcherEvent["type"];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CYAN_BRIGHT = "#22d3ee";
const CYAN_MID = "#0e7490";
const CYAN_DIM = "#0a3a4a";
const EDGE_COLOR = "rgba(34,211,238,0.15)";
const EDGE_HOVER = "rgba(34,211,238,0.55)";
const BG_VOID = "#020408";

const PULSE_DURATION_MS = 2000;

function nodeRadius(connectionCount: number): number {
  // 5px base + logarithmic growth, capped at 22px
  return Math.min(22, 5 + Math.log2(connectionCount + 1) * 3.5);
}

function nodeGlowAlpha(connectionCount: number, maxConnections: number): number {
  if (maxConnections === 0) return 0.25;
  return 0.2 + 0.8 * Math.sqrt(connectionCount / maxConnections);
}

/** Simple union-find for cluster counting */
function countClusters(nodes: SimNode[], edges: SimLink[]): number {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
    return parent.get(x)!;
  };
  const union = (a: string, b: string) => {
    parent.set(find(a), find(b));
  };
  for (const n of nodes) parent.set(n.id, n.id);
  for (const e of edges) {
    const s = typeof e.source === "string" ? e.source : (e.source as SimNode).id;
    const t = typeof e.target === "string" ? e.target : (e.target as SimNode).id;
    union(s, t);
  }
  const roots = new Set<string>();
  for (const n of nodes) roots.add(find(n.id));
  return roots.size;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function GraphPage() {
  const { isAuthenticated, logout } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Graph data
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Simulation nodes/links (mutable, not re-created each render)
  const simNodesRef = useRef<SimNode[]>([]);
  const simLinksRef = useRef<SimLink[]>([]);

  // Canvas transform (pan/zoom)
  const transformRef = useRef({ x: 0, y: 0, scale: 1 });

  // Interaction state
  const hoveredNodeRef = useRef<SimNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [stats, setStats] = useState({ nodes: 0, edges: 0, clusters: 0 });

  // Drag state
  const dragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    node: SimNode | null;
  }>({ isDragging: false, startX: 0, startY: 0, node: null });

  // Animation frame
  const rafRef = useRef<number | null>(null);

  // Simulation ref (so we can restart on data change)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const simulationRef = useRef<ReturnType<typeof forceSimulation<SimNode>> | null>(null);

  // ---------------------------------------------------------------------------
  // Live pulse / SSE state
  // ---------------------------------------------------------------------------

  // Map: node id (lowercase) → active pulse
  const pulsesRef = useRef<Map<string, PulseState>>(new Map());

  // SSE connection status
  type SseStatus = "connected" | "disconnected" | "connecting";
  const [sseStatus, setSseStatus] = useState<SseStatus>("disconnected");
  const sseStatusRef = useRef<SseStatus>("disconnected");

  // Whether the server watcher is active
  const [watcherActive, setWatcherActive] = useState(false);
  const watcherActiveRef = useRef(false);

  // EventSource ref so we can close it on demand
  const sseRef = useRef<EventSource | null>(null);

  // ---------------------------------------------------------------------------
  // SSE helpers
  // ---------------------------------------------------------------------------

  const disconnectSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    sseStatusRef.current = "disconnected";
    setSseStatus("disconnected");
  }, []);

  const connectSSE = useCallback(() => {
    if (sseRef.current) return; // already open
    sseStatusRef.current = "connecting";
    setSseStatus("connecting");

    const es = new EventSource("/api/watcher-events");
    sseRef.current = es;

    es.onopen = () => {
      sseStatusRef.current = "connected";
      setSseStatus("connected");
    };

    es.onmessage = (ev: MessageEvent<string>) => {
      try {
        const event = JSON.parse(ev.data) as WatcherEvent;
        const nodeId = event.name.toLowerCase();
        pulsesRef.current.set(nodeId, {
          startTime: performance.now(),
          type: event.type,
        });
      } catch {
        // Malformed message — ignore
      }
    };

    es.onerror = () => {
      es.close();
      sseRef.current = null;
      sseStatusRef.current = "disconnected";
      setSseStatus("disconnected");
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Watcher toggle (from graph page)
  // ---------------------------------------------------------------------------

  const toggleWatcher = useCallback(async () => {
    try {
      if (watcherActiveRef.current) {
        await fetch("/api/watch", { method: "DELETE" });
        watcherActiveRef.current = false;
        setWatcherActive(false);
        disconnectSSE();
      } else {
        const res = await fetch("/api/watch", { method: "POST" });
        if (res.ok) {
          watcherActiveRef.current = true;
          setWatcherActive(true);
          connectSSE();
        }
      }
    } catch {
      // Ignore transient errors
    }
  }, [connectSSE, disconnectSSE]);

  // ---------------------------------------------------------------------------
  // On mount: check watcher status and connect SSE if active
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;

    fetch("/api/watch")
      .then((r) => r.json())
      .then((data: { watching: boolean }) => {
        if (cancelled) return;
        watcherActiveRef.current = data.watching;
        setWatcherActive(data.watching);
        if (data.watching) {
          connectSSE();
        }
      })
      .catch(() => {
        // Best-effort — ignore failures
      });

    return () => {
      cancelled = true;
      disconnectSSE();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Fetch data
  // ---------------------------------------------------------------------------

  useEffect(() => {
    setLoading(true);
    fetch("/api/graph")
      .then((r) => r.json())
      .then((data: GraphData) => {
        setGraphData(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load graph");
        setLoading(false);
      });
  }, []);

  // ---------------------------------------------------------------------------
  // Build simulation when data arrives
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!graphData) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.width;
    const H = canvas.height;

    // Build connection count map
    const connCount = new Map<string, number>();
    for (const node of graphData.nodes) connCount.set(node.id, 0);
    for (const edge of graphData.edges) {
      connCount.set(edge.source, (connCount.get(edge.source) ?? 0) + 1);
      connCount.set(edge.target, (connCount.get(edge.target) ?? 0) + 1);
    }

    // Build SimNode array — spread existing positions if available (warm restart)
    const existingPosMap = new Map<string, { x: number; y: number }>();
    for (const sn of simNodesRef.current) {
      if (sn.x !== undefined && sn.y !== undefined) {
        existingPosMap.set(sn.id, { x: sn.x, y: sn.y });
      }
    }

    const simNodes: SimNode[] = graphData.nodes.map((n) => {
      const existing = existingPosMap.get(n.id);
      return {
        ...n,
        connectionCount: connCount.get(n.id) ?? 0,
        x: existing?.x ?? W / 2 + (Math.random() - 0.5) * 200,
        y: existing?.y ?? H / 2 + (Math.random() - 0.5) * 200,
      };
    });

    const nodeById = new Map<string, SimNode>(simNodes.map((n) => [n.id, n]));

    const simLinks: SimLink[] = graphData.edges
      .map((e) => ({
        ...e,
        source: nodeById.get(e.source) ?? e.source,
        target: nodeById.get(e.target) ?? e.target,
      }))
      .filter((e) => typeof e.source !== "string" && typeof e.target !== "string") as SimLink[];

    simNodesRef.current = simNodes;
    simLinksRef.current = simLinks;

    // Stats
    const clusters = countClusters(simNodes, simLinks);
    setStats({ nodes: simNodes.length, edges: simLinks.length, clusters });

    // Stop any existing simulation
    if (simulationRef.current) simulationRef.current.stop();

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(80)
          .strength(0.4)
      )
      .force("charge", forceManyBody<SimNode>().strength(-200).distanceMax(400))
      .force("center", forceCenter(W / 2, H / 2).strength(0.08))
      .force(
        "collide",
        forceCollide<SimNode>().radius((d) => nodeRadius(d.connectionCount) + 4).strength(0.7)
      )
      .alphaDecay(0.022)
      .velocityDecay(0.4);

    simulationRef.current = sim;

    // Kick off the render loop
    startRenderLoop();

    return () => {
      sim.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData]);

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

      // Re-center the simulation
      if (simulationRef.current) {
        simulationRef.current
          .force("center", forceCenter(rect.width / 2, rect.height / 2).strength(0.08))
          .alpha(0.3)
          .restart();
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

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
      const nodes = simNodesRef.current;
      const links = simLinksRef.current;
      const hovered = hoveredNodeRef.current;
      const sq = searchQuery;
      const now = performance.now();

      // Expire pulses older than PULSE_DURATION_MS
      for (const [id, pulse] of pulsesRef.current) {
        if (now - pulse.startTime > PULSE_DURATION_MS) {
          pulsesRef.current.delete(id);
        }
      }

      // Find max connections for glow scaling
      const maxConn = nodes.reduce((m, n) => Math.max(m, n.connectionCount), 0);

      // Build neighbour set for hovered node
      const hovNeighbours = new Set<string>();
      let hovLinks: SimLink[] = [];
      if (hovered) {
        hovLinks = links.filter((l) => {
          const s = (l.source as SimNode).id;
          const t = (l.target as SimNode).id;
          return s === hovered.id || t === hovered.id;
        });
        for (const l of hovLinks) {
          hovNeighbours.add((l.source as SimNode).id);
          hovNeighbours.add((l.target as SimNode).id);
        }
      }

      // Clear
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();

      // Fill background
      ctx.save();
      ctx.fillStyle = BG_VOID;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();

      // Apply pan/zoom transform
      ctx.save();
      ctx.translate(tx, ty);
      ctx.scale(scale, scale);

      // ── Draw edges ──────────────────────────────────────────────────────
      for (const link of links) {
        const s = link.source as SimNode;
        const t = link.target as SimNode;
        if (s.x === undefined || s.y === undefined || t.x === undefined || t.y === undefined) continue;

        const isHovEdge = hovered && hovLinks.includes(link);
        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.strokeStyle = isHovEdge ? EDGE_HOVER : EDGE_COLOR;
        ctx.lineWidth = isHovEdge ? 1.5 : 0.75;
        ctx.globalAlpha = hovered && !isHovEdge ? 0.3 : 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // ── Draw nodes ──────────────────────────────────────────────────────
      for (const node of nodes) {
        if (node.x === undefined || node.y === undefined) continue;

        const r = nodeRadius(node.connectionCount);
        const glowAlpha = nodeGlowAlpha(node.connectionCount, maxConn);
        const isHov = hovered?.id === node.id;
        const isNeighbour = hovNeighbours.has(node.id);
        const isDimmed = hovered !== null && !isHov && !isNeighbour;
        const isSearchMatch = sq.length >= 1 && node.name.toLowerCase().includes(sq.toLowerCase());

        // ── Pulse rings (drawn behind the node) ────────────────────────
        const pulse = pulsesRef.current.get(node.id);
        if (pulse) {
          const elapsed = now - pulse.startTime;
          const progress = Math.min(elapsed / PULSE_DURATION_MS, 1);

          // Colour: cyan for add/change, red for unlink
          const isUnlink = pulse.type === "unlink";
          const ringR = isUnlink ? 255 : 34;
          const ringG = isUnlink ? 80 : 211;
          const ringB = isUnlink ? 80 : 238;

          // Draw 3 concentric rings at staggered progress offsets
          const ringOffsets = [0, 0.25, 0.5];
          for (const offset of ringOffsets) {
            const p = Math.min((progress + offset) % 1, 1);
            const expandedR = r + 6 + p * 40;
            const alpha = (1 - p) * 0.6 * (1 - progress * 0.5);

            if (alpha <= 0) continue;

            ctx.beginPath();
            ctx.arc(node.x, node.y, expandedR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(${ringR},${ringG},${ringB},${alpha})`;
            ctx.lineWidth = 1.5 * (1 - p);
            ctx.globalAlpha = 1;
            ctx.stroke();
          }

          // Brief glow burst on the node itself (fades after first 30% of animation)
          const burstAlpha = Math.max(0, 1 - progress / 0.3) * 0.7;
          if (burstAlpha > 0) {
            const burstGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r + 20);
            burstGrad.addColorStop(0, `rgba(${ringR},${ringG},${ringB},${burstAlpha})`);
            burstGrad.addColorStop(1, "rgba(0,0,0,0)");
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 20, 0, Math.PI * 2);
            ctx.fillStyle = burstGrad;
            ctx.globalAlpha = 1;
            ctx.fill();
          }
        }

        ctx.globalAlpha = isDimmed ? 0.25 : 1;

        // Outer glow ring
        if (isHov || isSearchMatch) {
          const grad = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r + 14);
          grad.addColorStop(0, isSearchMatch ? "rgba(251,191,36,0.5)" : `rgba(34,211,238,0.5)`);
          grad.addColorStop(1, "rgba(0,0,0,0)");
          ctx.beginPath();
          ctx.arc(node.x, node.y, r + 14, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Ambient glow
        const glowGrad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r + 8);
        glowGrad.addColorStop(0, `rgba(34,211,238,${glowAlpha * 0.6})`);
        glowGrad.addColorStop(1, "rgba(0,0,0,0)");
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
        ctx.fillStyle = glowGrad;
        ctx.fill();

        // Node circle fill — brighten when pulsing
        const fillGrad = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, 0, node.x, node.y, r);
        if (isHov) {
          fillGrad.addColorStop(0, "#a5f3fc");
          fillGrad.addColorStop(1, CYAN_BRIGHT);
        } else if (isSearchMatch) {
          fillGrad.addColorStop(0, "#fde68a");
          fillGrad.addColorStop(1, "#f59e0b");
        } else if (pulse) {
          // Pulse brightens the node: lerp toward white/cyan
          const pulseProgress = Math.min((now - pulse.startTime) / PULSE_DURATION_MS, 1);
          const brightness = Math.max(0, 1 - pulseProgress / 0.4);
          if (pulse.type === "unlink") {
            fillGrad.addColorStop(0, `rgba(255,${Math.round(80 + brightness * 170)},${Math.round(80 + brightness * 170)},1)`);
            fillGrad.addColorStop(1, `rgba(${Math.round(100 + brightness * 50)},20,20,1)`);
          } else {
            fillGrad.addColorStop(0, `rgba(${Math.round(165 + brightness * 90)},${Math.round(243 + brightness * 12)},252,1)`);
            fillGrad.addColorStop(1, CYAN_BRIGHT);
          }
        } else if (node.connectionCount > 5) {
          fillGrad.addColorStop(0, CYAN_BRIGHT);
          fillGrad.addColorStop(1, CYAN_MID);
        } else if (node.connectionCount > 0) {
          fillGrad.addColorStop(0, CYAN_MID);
          fillGrad.addColorStop(1, CYAN_DIM);
        } else {
          fillGrad.addColorStop(0, "#1a3a48");
          fillGrad.addColorStop(1, "#0a1620");
        }
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fillStyle = fillGrad;
        ctx.fill();

        // Stroke ring
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = isHov
          ? "#a5f3fc"
          : isSearchMatch
          ? "#fbbf24"
          : node.connectionCount > 2
          ? `rgba(34,211,238,${0.4 + glowAlpha * 0.4})`
          : "rgba(34,211,238,0.2)";
        ctx.lineWidth = isHov ? 2 : 1;
        ctx.stroke();

        // Label for hovered or well-connected nodes
        if (isHov || (node.connectionCount >= 4 && scale > 0.7)) {
          ctx.globalAlpha = isDimmed ? 0.2 : 1;
          ctx.font = `${Math.max(10, 11 / scale)}px "Geist Mono", monospace`;
          ctx.fillStyle = isHov ? "#e0f7fa" : "rgba(34,211,238,0.75)";
          ctx.textAlign = "center";
          ctx.fillText(node.name, node.x, node.y + r + 13 / scale);
        }

        ctx.globalAlpha = 1;
      }

      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
  }, [searchQuery]);

  // Restart render loop when searchQuery changes (so the draw closure captures new value)
  useEffect(() => {
    startRenderLoop();
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [startRenderLoop]);

  // ---------------------------------------------------------------------------
  // Hit testing
  // ---------------------------------------------------------------------------

  const hitTest = useCallback((canvasX: number, canvasY: number): SimNode | null => {
    const { x: tx, y: ty, scale } = transformRef.current;
    const wx = (canvasX - tx) / scale;
    const wy = (canvasY - ty) / scale;
    let closest: SimNode | null = null;
    let closestDist = Infinity;
    for (const node of simNodesRef.current) {
      if (node.x === undefined || node.y === undefined) continue;
      const dx = node.x - wx;
      const dy = node.y - wy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = nodeRadius(node.connectionCount) + 4;
      if (dist < r && dist < closestDist) {
        closest = node;
        closestDist = dist;
      }
    }
    return closest;
  }, []);

  // ---------------------------------------------------------------------------
  // Mouse events
  // ---------------------------------------------------------------------------

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const drag = dragRef.current;

      if (drag.isDragging && drag.node) {
        // Drag a node
        const { x: tx, y: ty, scale } = transformRef.current;
        const wx = (cx - tx) / scale;
        const wy = (cy - ty) / scale;
        drag.node.x = wx;
        drag.node.y = wy;
        drag.node.fx = wx;
        drag.node.fy = wy;
        if (simulationRef.current) simulationRef.current.alpha(0.3).restart();
        return;
      }

      if (drag.isDragging) {
        // Pan the canvas
        const dx = cx - drag.startX;
        const dy = cy - drag.startY;
        transformRef.current.x += dx;
        transformRef.current.y += dy;
        drag.startX = cx;
        drag.startY = cy;
        return;
      }

      // Hover detection
      const hit = hitTest(cx, cy);
      if (hit !== hoveredNodeRef.current) {
        hoveredNodeRef.current = hit;
        (e.target as HTMLCanvasElement).style.cursor = hit ? "pointer" : "grab";
        if (hit) {
          setTooltip({ x: e.clientX, y: e.clientY, name: hit.name });
        } else {
          setTooltip(null);
        }
      } else if (hit) {
        setTooltip({ x: e.clientX, y: e.clientY, name: hit.name });
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
      dragRef.current = { isDragging: true, startX: cx, startY: cy, node: hit };
      (e.target as HTMLCanvasElement).style.cursor = hit ? "grabbing" : "grabbing";
    },
    [hitTest]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (drag.isDragging) {
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const dx = cx - drag.startX;
        const dy = cy - drag.startY;
        const moved = Math.sqrt(dx * dx + dy * dy);

        if (moved < 4) {
          // Treat as click
          const hit = hitTest(cx, cy);
          if (hit) {
            setSelectedNode((prev) => (prev?.id === hit.id ? null : hit));
          } else {
            setSelectedNode(null);
          }
        }

        // Release pinned node
        if (drag.node) {
          drag.node.fx = null;
          drag.node.fy = null;
        }
      }
      dragRef.current = { isDragging: false, startX: 0, startY: 0, node: null };
      (e.target as HTMLCanvasElement).style.cursor = hoveredNodeRef.current ? "pointer" : "grab";
    },
    [hitTest]
  );

  const handleMouseLeave = useCallback(() => {
    hoveredNodeRef.current = null;
    setTooltip(null);
    const drag = dragRef.current;
    if (drag.node) {
      drag.node.fx = null;
      drag.node.fy = null;
    }
    dragRef.current = { isDragging: false, startX: 0, startY: 0, node: null };
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const { x: tx, y: ty, scale } = transformRef.current;
    const newScale = Math.max(0.1, Math.min(8, scale * factor));
    // Zoom toward cursor
    transformRef.current = {
      x: cx - (cx - tx) * (newScale / scale),
      y: cy - (cy - ty) * (newScale / scale),
      scale: newScale,
    };
  }, []);

  // Touch events for mobile
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
        dragRef.current = { isDragging: true, startX: touch.clientX, startY: touch.clientY, node: hit };
        if (hit) {
          // Pin the node so it follows the finger
          hit.fx = hit.x;
          hit.fy = hit.y;
        }
      } else if (e.touches.length === 2) {
        const dx = e.touches[1].clientX - e.touches[0].clientX;
        const dy = e.touches[1].clientY - e.touches[0].clientY;
        lastTouchRef.current = { x: 0, y: 0, dist: Math.sqrt(dx * dx + dy * dy) };
        // Release any dragged node when a second finger appears
        const drag = dragRef.current;
        if (drag.node) {
          drag.node.fx = null;
          drag.node.fy = null;
        }
        dragRef.current = { isDragging: false, startX: 0, startY: 0, node: null };
      }
    },
    [hitTest]
  );

  const handleTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const drag = dragRef.current;

      if (drag.node) {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const cx = touch.clientX - rect.left;
        const cy = touch.clientY - rect.top;
        const { x: tx, y: ty, scale } = transformRef.current;
        const wx = (cx - tx) / scale;
        const wy = (cy - ty) / scale;
        drag.node.x = wx;
        drag.node.y = wy;
        drag.node.fx = wx;
        drag.node.fy = wy;
        if (simulationRef.current) simulationRef.current.alpha(0.3).restart();
      } else {
        const dx = touch.clientX - drag.startX;
        const dy = touch.clientY - drag.startY;
        transformRef.current.x += dx;
        transformRef.current.y += dy;
      }
      drag.startX = touch.clientX;
      drag.startY = touch.clientY;
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
      const newScale = Math.max(0.1, Math.min(8, scale * factor));
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

      if (drag.isDragging && drag.node) {
        // Check if this was a tap (finger didn't move much) — treat as select
        const dx = drag.startX - lastTouchRef.current.x;
        const dy = drag.startY - lastTouchRef.current.y;
        // Note: startX/Y was updated each move, so compare against original touch start
        // We track the original start separately in lastTouchRef.current.x/y (set in handleTouchStart)
        // Compute total movement from the initial touch position
        const changedTouch = e.changedTouches[0];
        const totalDx = changedTouch ? changedTouch.clientX - lastTouchRef.current.x : dx;
        const totalDy = changedTouch ? changedTouch.clientY - lastTouchRef.current.y : dy;
        const moved = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

        if (moved < 8 && drag.node) {
          // Tap on a node — select it
          setSelectedNode((prev) => (prev?.id === drag.node!.id ? null : drag.node));
        }

        // Unpin the dragged node
        drag.node.fx = null;
        drag.node.fy = null;
      } else if (drag.isDragging) {
        // Tap on empty canvas — deselect
        const changedTouch = e.changedTouches[0];
        if (changedTouch) {
          const totalDx = changedTouch.clientX - lastTouchRef.current.x;
          const totalDy = changedTouch.clientY - lastTouchRef.current.y;
          const moved = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
          if (moved < 8) {
            setSelectedNode(null);
          }
        }
      }

      dragRef.current = { isDragging: false, startX: 0, startY: 0, node: null };
    },
    []
  );

  // Register touchmove with { passive: false } so preventDefault() works on mobile
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => canvas.removeEventListener("touchmove", handleTouchMove);
  }, [handleTouchMove]);

  // ---------------------------------------------------------------------------
  // Connection count for selected node
  // ---------------------------------------------------------------------------

  const selectedConnections = selectedNode
    ? simLinksRef.current.filter((l) => {
        const s = (l.source as SimNode).id;
        const t = (l.target as SimNode).id;
        return s === selectedNode.id || t === selectedNode.id;
      }).length
    : 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

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
      {/* ── Header ────────────────────────────────────────────────────────── */}
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
            GRAPH
          </h1>

          {/* Watcher toggle + SSE status — hide on mobile */}
          <div className="hidden sm:flex" style={{ alignItems: "center", gap: "0.5rem" }}>
            <button
              onClick={toggleWatcher}
              className="btn-secondary"
              style={{
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.55rem",
                letterSpacing: "0.1em",
                padding: "3px 8px",
                borderRadius: "2px",
                cursor: "pointer",
              }}
              aria-label={watcherActive ? "Stop file watcher" : "Start file watcher"}
            >
              {watcherActive ? "STOP WATCHER" : "START WATCHER"}
            </button>

            {/* LIVE / OFFLINE indicator */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.55rem",
                letterSpacing: "0.12em",
                color:
                  sseStatus === "connected"
                    ? "#4ade80"
                    : sseStatus === "connecting"
                    ? "#fbbf24"
                    : "var(--text-faint)",
              }}
              aria-live="polite"
              aria-label={`Watcher status: ${sseStatus}`}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  display: "inline-block",
                  background:
                    sseStatus === "connected"
                      ? "#4ade80"
                      : sseStatus === "connecting"
                      ? "#fbbf24"
                      : "#6b7280",
                  boxShadow:
                    sseStatus === "connected"
                      ? "0 0 6px #4ade80"
                      : sseStatus === "connecting"
                      ? "0 0 6px #fbbf24"
                      : "none",
                }}
              />
              {sseStatus === "connected"
                ? "LIVE"
                : sseStatus === "connecting"
                ? "CONNECTING"
                : "OFFLINE"}
            </div>
          </div>
        </div>

        {/* Right — nav + search */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "flex-end" }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="FILTER..."
            className="graph-search"
            aria-label="Filter nodes by name"
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

      {/* ── Canvas container ──────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: "relative", overflow: "hidden", minHeight: 0 }}
      >
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
              MAPPING KNOWLEDGE GRAPH...
            </span>
          </div>
        )}

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
                GRAPH ERROR
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
          aria-label="Knowledge graph canvas"
          role="img"
        />

        {/* Info panel for selected node */}
        {selectedNode && (
          <aside className="graph-info-panel" role="complementary" aria-label="Node details">
            <div className="graph-info-panel__header">
              <span className="graph-info-panel__label">NODE DETAIL</span>
              <button
                onClick={() => setSelectedNode(null)}
                className="graph-info-panel__close"
                aria-label="Close node detail"
              >
                ×
              </button>
            </div>
            <div className="graph-info-panel__body">
              <p className="graph-info-panel__name">{selectedNode.name}</p>
              <div className="graph-info-panel__rows">
                <div className="graph-info-panel__row">
                  <span className="graph-info-panel__key">FOLDER</span>
                  <span className="graph-info-panel__val">{selectedNode.folder}</span>
                </div>
                <div className="graph-info-panel__row">
                  <span className="graph-info-panel__key">WORDS</span>
                  <span className="graph-info-panel__val">{selectedNode.wordCount.toLocaleString()}</span>
                </div>
                <div className="graph-info-panel__row">
                  <span className="graph-info-panel__key">LINKS</span>
                  <span className="graph-info-panel__val">{selectedConnections}</span>
                </div>
                <div className="graph-info-panel__row">
                  <span className="graph-info-panel__key">ID</span>
                  <span className="graph-info-panel__val graph-info-panel__val--faint">
                    {selectedNode.id}
                  </span>
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* ── Stats bar ─────────────────────────────────────────────────────── */}
      <footer className="graph-stats-bar" role="contentinfo" aria-label="Graph statistics">
        <div className="graph-stats-bar__item">
          <span className="graph-stats-bar__key">NODES</span>
          <span className="graph-stats-bar__val">{stats.nodes}</span>
        </div>
        <span className="graph-stats-bar__divider" aria-hidden="true">&#9472;</span>
        <div className="graph-stats-bar__item">
          <span className="graph-stats-bar__key">EDGES</span>
          <span className="graph-stats-bar__val">{stats.edges}</span>
        </div>
        <span className="graph-stats-bar__divider" aria-hidden="true">&#9472;</span>
        <div className="graph-stats-bar__item">
          <span className="graph-stats-bar__key">CLUSTERS</span>
          <span className="graph-stats-bar__val">{stats.clusters}</span>
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
            SCROLL TO ZOOM &nbsp;&#9632;&nbsp; DRAG TO PAN &nbsp;&#9632;&nbsp; CLICK NODE FOR DETAIL
          </span>
        </div>
      </footer>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="graph-tooltip"
          style={{ left: tooltip.x + 14, top: tooltip.y - 8 }}
          aria-hidden="true"
        >
          {tooltip.name}
        </div>
      )}
    </div>
  );
}
