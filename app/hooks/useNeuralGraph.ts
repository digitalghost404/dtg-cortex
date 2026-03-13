import { useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NeuronNode {
  id: string;
  name: string;
  path: string;
  x: number; // normalized [-1,1] from t-SNE
  y: number;
  cluster: number;
  connections: number;
  color: string;
  colorR: number;
  colorG: number;
  colorB: number;
}

export interface NeuralEdge {
  source: number; // index into neurons[]
  target: number;
  weight: number; // 0-1, higher = stronger visual
}

interface NotePoint {
  id: string;
  name: string;
  path: string;
  x: number;
  y: number;
  cluster: number;
  connections: number;
}

interface ClusterInfo {
  id: number;
  label: string;
  color: string;
  count: number;
}

export interface ClustersData {
  points: NotePoint[];
  clusters: ClusterInfo[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const INTRA_CLUSTER_DIST = 0.35; // max euclidean distance for intra-cluster edges
const CROSS_CLUSTER_NEIGHBORS = 2; // bridges per neuron to other clusters

function euclidean(a: NeuronNode, b: NeuronNode): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function useNeuralGraph(data: ClustersData | null) {
  return useMemo(() => {
    if (!data || data.points.length === 0) {
      return {
        neurons: [] as NeuronNode[],
        edges: [] as NeuralEdge[],
        neuronsByPath: new Map<string, number>(),
        clusterColors: new Map<number, string>(),
      };
    }

    const clusterColors = new Map<number, string>();
    for (const c of data.clusters) clusterColors.set(c.id, c.color);

    // Build neurons
    const neurons: NeuronNode[] = data.points.map((pt) => {
      const color = clusterColors.get(pt.cluster) ?? "#22d3ee";
      return {
        id: pt.id,
        name: pt.name,
        path: pt.path,
        x: pt.x,
        y: pt.y,
        cluster: pt.cluster,
        connections: pt.connections,
        color,
        colorR: parseInt(color.slice(1, 3), 16),
        colorG: parseInt(color.slice(3, 5), 16),
        colorB: parseInt(color.slice(5, 7), 16),
      };
    });

    // Path → index lookup
    const neuronsByPath = new Map<string, number>();
    for (let i = 0; i < neurons.length; i++) {
      neuronsByPath.set(neurons[i].path, i);
    }

    const edges: NeuralEdge[] = [];
    const edgeSet = new Set<string>();

    const addEdge = (a: number, b: number, weight: number) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (edgeSet.has(key)) return;
      edgeSet.add(key);
      edges.push({ source: a, target: b, weight });
    };

    // Group by cluster for intra-cluster edges
    const clusterMembers = new Map<number, number[]>();
    for (let i = 0; i < neurons.length; i++) {
      const cid = neurons[i].cluster;
      if (!clusterMembers.has(cid)) clusterMembers.set(cid, []);
      clusterMembers.get(cid)!.push(i);
    }

    // Intra-cluster: connect pairs within distance threshold
    for (const members of clusterMembers.values()) {
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const dist = euclidean(neurons[members[i]], neurons[members[j]]);
          if (dist < INTRA_CLUSTER_DIST) {
            // Weight inversely proportional to distance
            const weight = 1 - dist / INTRA_CLUSTER_DIST;
            addEdge(members[i], members[j], weight * 0.8);
          }
        }
      }
    }

    // Cross-cluster bridges: each neuron connects to nearest in other clusters
    for (let i = 0; i < neurons.length; i++) {
      const candidates: { idx: number; dist: number }[] = [];
      for (let j = 0; j < neurons.length; j++) {
        if (neurons[j].cluster === neurons[i].cluster) continue;
        candidates.push({ idx: j, dist: euclidean(neurons[i], neurons[j]) });
      }
      candidates.sort((a, b) => a.dist - b.dist);
      const count = Math.min(CROSS_CLUSTER_NEIGHBORS, candidates.length);
      for (let k = 0; k < count; k++) {
        const maxDist = 1.5; // don't bridge super far
        if (candidates[k].dist < maxDist) {
          addEdge(i, candidates[k].idx, 0.15);
        }
      }
    }

    return { neurons, edges, neuronsByPath, clusterColors };
  }, [data]);
}
