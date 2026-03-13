import { NextResponse } from "next/server";
import { fetchAllVectors, indexHasItems } from "@/lib/vector";
import { getAllNotes } from "@/lib/vault";
import { computeDecayScores } from "@/lib/decay";
import { getSynapticWeights } from "@/lib/synaptic-weights";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NotePoint {
  id: string;
  name: string;
  path: string;
  x: number;
  y: number;
  cluster: number;
  connections: number;
  decayScore?: number;
}

interface ClusterInfo {
  id: number;
  label: string;
  color: string;
  count: number;
}

interface ClustersResponse {
  points: NotePoint[];
  clusters: ClusterInfo[];
}

// ---------------------------------------------------------------------------
// Color palette — 8 distinct hues in the dark sci-fi aesthetic
// ---------------------------------------------------------------------------

const CLUSTER_COLORS = [
  "#22d3ee", // cyan-bright
  "#a78bfa", // violet
  "#34d399", // emerald
  "#fb923c", // orange
  "#f472b6", // pink
  "#facc15", // yellow
  "#38bdf8", // sky-blue
  "#f87171", // red
];

// ---------------------------------------------------------------------------
// t-SNE implementation (from scratch, no external library)
// ---------------------------------------------------------------------------

function gaussianRandom(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function dotProduct(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function squaredDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

function computeConditionalP(
  vectors: number[][],
  perplexity: number
): number[][] {
  const n = vectors.length;
  const targetEntropy = Math.log(perplexity);
  const P: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    let betaMin = -Infinity;
    let betaMax = Infinity;
    let beta = 1.0;

    const dists: number[] = [];
    for (let j = 0; j < n; j++) {
      dists[j] = j === i ? 0 : squaredDistance(vectors[i], vectors[j]);
    }

    for (let iter = 0; iter < 50; iter++) {
      let sumExp = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const val = Math.exp(-beta * dists[j]);
        P[i][j] = val;
        sumExp += val;
      }

      let entropy = 0;
      for (let j = 0; j < n; j++) {
        if (j === i || sumExp === 0) continue;
        const pij = P[i][j] / sumExp;
        if (pij > 1e-15) entropy -= pij * Math.log(pij);
      }

      const diff = entropy - targetEntropy;
      if (Math.abs(diff) < 1e-5) break;

      if (diff > 0) {
        betaMin = beta;
        beta = betaMax === Infinity ? beta * 2 : (beta + betaMax) / 2;
      } else {
        betaMax = beta;
        beta = betaMin === -Infinity ? beta / 2 : (beta + betaMin) / 2;
      }
    }

    const rowSum = P[i].reduce((s, v) => s + v, 0);
    if (rowSum > 0) {
      for (let j = 0; j < n; j++) P[i][j] /= rowSum;
    }
  }

  return P;
}

function symmetrizeP(P: number[][], n: number): number[][] {
  const Psym: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const total = n * n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      Psym[i][j] = Math.max((P[i][j] + P[j][i]) / (2 * total), 1e-12);
    }
  }
  return Psym;
}

function runTSNE(vectors: number[][], perplexity = 30): Array<[number, number]> {
  const n = vectors.length;

  if (n <= 1) {
    return vectors.map(() => [Math.random() * 2 - 1, Math.random() * 2 - 1]);
  }

  if (n === 2) {
    return [
      [-0.5, 0],
      [0.5, 0],
    ];
  }

  const effectivePerplexity = Math.min(perplexity, Math.floor((n - 1) / 3));
  const Pcond = computeConditionalP(vectors, effectivePerplexity);
  const P = symmetrizeP(Pcond, n);

  const Y: Array<[number, number]> = Array.from({ length: n }, () => [
    gaussianRandom() * 0.0001,
    gaussianRandom() * 0.0001,
  ]);

  const gains: Array<[number, number]> = Array.from({ length: n }, () => [1, 1]);
  const iY: Array<[number, number]> = Array.from({ length: n }, () => [0, 0]);

  const ITERATIONS = 200;
  const EARLY_EXAGGERATION = 4;
  const EARLY_EXAGGERATION_ITER = 50;
  const LEARNING_RATE = Math.max(200, n / 12);
  const MOMENTUM_EARLY = 0.5;
  const MOMENTUM_LATE = 0.8;
  const MIN_GAIN = 0.01;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const exaggeration = iter < EARLY_EXAGGERATION_ITER ? EARLY_EXAGGERATION : 1;
    const momentum = iter < EARLY_EXAGGERATION_ITER ? MOMENTUM_EARLY : MOMENTUM_LATE;

    const num: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    let sumQ = 0;

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = Y[i][0] - Y[j][0];
        const dy = Y[i][1] - Y[j][1];
        const val = 1 / (1 + dx * dx + dy * dy);
        num[i][j] = val;
        num[j][i] = val;
        sumQ += 2 * val;
      }
    }
    sumQ = Math.max(sumQ, 1e-12);

    const dY: Array<[number, number]> = Array.from({ length: n }, () => [0, 0]);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const pij = P[i][j] * exaggeration;
        const qij = num[i][j] / sumQ;
        const factor = 4 * (pij - qij) * num[i][j];
        dY[i][0] += factor * (Y[i][0] - Y[j][0]);
        dY[i][1] += factor * (Y[i][1] - Y[j][1]);
      }
    }

    for (let i = 0; i < n; i++) {
      for (let d = 0; d < 2; d++) {
        const grad = dY[i][d];
        const prevGain = gains[i][d];
        const prevVel = iY[i][d];

        const newGain = Math.max(
          MIN_GAIN,
          Math.sign(grad) === Math.sign(prevVel) ? prevGain * 0.8 : prevGain + 0.2
        );
        gains[i][d] = newGain;

        const newVel = momentum * prevVel - LEARNING_RATE * newGain * grad;
        iY[i][d] = newVel;
        Y[i][d] += newVel;
      }
    }

    if (iter % 10 === 0) {
      const meanX = Y.reduce((s, p) => s + p[0], 0) / n;
      const meanY = Y.reduce((s, p) => s + p[1], 0) / n;
      for (let i = 0; i < n; i++) {
        Y[i][0] -= meanX;
        Y[i][1] -= meanY;
      }
    }
  }

  return Y;
}

// ---------------------------------------------------------------------------
// k-means clustering
// ---------------------------------------------------------------------------

function kMeans(
  points: Array<[number, number]>,
  k: number,
  maxIter = 100
): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (k >= n) return points.map((_, i) => i % k);

  const centroids: Array<[number, number]> = [];
  const usedIndices = new Set<number>();

  const firstIdx = Math.floor(Math.random() * n);
  centroids.push([points[firstIdx][0], points[firstIdx][1]]);
  usedIndices.add(firstIdx);

  for (let c = 1; c < k; c++) {
    let maxDist = -1;
    let bestIdx = 0;
    for (let i = 0; i < n; i++) {
      if (usedIndices.has(i)) continue;
      let minDistToCentroid = Infinity;
      for (const centroid of centroids) {
        const dx = points[i][0] - centroid[0];
        const dy = points[i][1] - centroid[1];
        minDistToCentroid = Math.min(minDistToCentroid, dx * dx + dy * dy);
      }
      if (minDistToCentroid > maxDist) {
        maxDist = minDistToCentroid;
        bestIdx = i;
      }
    }
    centroids.push([points[bestIdx][0], points[bestIdx][1]]);
    usedIndices.add(bestIdx);
  }

  let assignments = new Array(n).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    const newAssignments = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      let best = 0;
      for (let c = 0; c < k; c++) {
        const dx = points[i][0] - centroids[c][0];
        const dy = points[i][1] - centroids[c][1];
        const dist = dx * dx + dy * dy;
        if (dist < minDist) {
          minDist = dist;
          best = c;
        }
      }
      newAssignments[i] = best;
    }

    let changed = false;
    for (let i = 0; i < n; i++) {
      if (newAssignments[i] !== assignments[i]) {
        changed = true;
        break;
      }
    }
    assignments = newAssignments;
    if (!changed) break;

    for (let c = 0; c < k; c++) {
      const members = assignments
        .map((a, idx) => (a === c ? idx : -1))
        .filter((idx) => idx >= 0);
      if (members.length === 0) continue;
      centroids[c][0] = members.reduce((s, idx) => s + points[idx][0], 0) / members.length;
      centroids[c][1] = members.reduce((s, idx) => s + points[idx][1], 0) / members.length;
    }
  }

  return assignments;
}

// ---------------------------------------------------------------------------
// Auto-label clusters from note names
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "is", "it", "as", "be", "was", "are",
  "that", "this", "my", "i", "we", "you", "he", "she", "they", "its",
  "how", "what", "when", "where", "why", "not", "no", "so", "if",
]);

function autoLabel(noteNames: string[]): string {
  const freq = new Map<string, number>();
  for (const name of noteNames) {
    const words = name
      .toLowerCase()
      .replace(/[-_]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
    for (const w of words) {
      freq.set(w, (freq.get(w) ?? 0) + 1);
    }
  }
  const top = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([w]) => w.toUpperCase());
  return top.length > 0 ? top.join(" / ") : "MISC";
}

// ---------------------------------------------------------------------------
// GET /api/clusters
// ---------------------------------------------------------------------------

export async function GET(): Promise<NextResponse<ClustersResponse | { error: string }>> {
  try {
    const hasItems = await indexHasItems();
    if (!hasItems) {
      return NextResponse.json({ error: "Index not built yet. Run /api/index first." }, { status: 503 });
    }

    const items = await fetchAllVectors();

    if (items.length === 0) {
      return NextResponse.json({ points: [], clusters: [] });
    }

    // Group chunks by note path
    const noteMap = new Map<
      string,
      { name: string; path: string; vectors: number[][]; chunkCount: number }
    >();

    for (const item of items) {
      const notePath = item.metadata.path;
      const noteName = item.metadata.name;
      const vector = item.vector;

      if (!noteMap.has(notePath)) {
        noteMap.set(notePath, { name: noteName, path: notePath, vectors: [], chunkCount: 0 });
      }
      const entry = noteMap.get(notePath)!;
      entry.vectors.push(vector);
      entry.chunkCount++;
    }

    // Average chunk vectors into a single representative vector per note
    const notes = [...noteMap.values()];
    const avgVectors: number[][] = notes.map((note) => {
      const dim = note.vectors[0].length;
      const avg = new Array(dim).fill(0);
      for (const vec of note.vectors) {
        for (let d = 0; d < dim; d++) avg[d] += vec[d];
      }
      const len = note.vectors.length;
      for (let d = 0; d < dim; d++) avg[d] /= len;
      return avg;
    });

    // Normalize vectors to unit length
    const unitVectors = avgVectors.map((vec) => {
      const mag = Math.sqrt(dotProduct(vec, vec));
      if (mag === 0) return vec;
      return vec.map((v) => v / mag);
    });

    const coords2D = runTSNE(unitVectors, 30);

    const n = notes.length;
    const k = Math.max(1, Math.min(8, Math.floor(n / 3)));
    const clusterAssignments = kMeans(coords2D, k);

    const xs = coords2D.map((p) => p[0]);
    const ys = coords2D.map((p) => p[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const rangeX = Math.max(maxX - minX, 1e-9);
    const rangeY = Math.max(maxY - minY, 1e-9);

    // Compute decay scores from vault notes
    const vaultNotes = await getAllNotes();
    const decayScores = computeDecayScores(vaultNotes);

    const points: NotePoint[] = notes.map((note, i) => ({
      id: note.path,
      name: note.name,
      path: note.path,
      x: ((coords2D[i][0] - minX) / rangeX) * 2 - 1,
      y: ((coords2D[i][1] - minY) / rangeY) * 2 - 1,
      cluster: clusterAssignments[i] ?? 0,
      connections: note.chunkCount,
      decayScore: decayScores.get(note.path) ?? 0,
    }));

    const clusterGroups = new Map<number, string[]>();
    for (let i = 0; i < points.length; i++) {
      const cid = points[i].cluster;
      if (!clusterGroups.has(cid)) clusterGroups.set(cid, []);
      clusterGroups.get(cid)!.push(points[i].name);
    }

    const clusters: ClusterInfo[] = [];
    for (const [cid, names] of clusterGroups.entries()) {
      clusters.push({
        id: cid,
        label: autoLabel(names),
        color: CLUSTER_COLORS[cid % CLUSTER_COLORS.length],
        count: names.length,
      });
    }
    clusters.sort((a, b) => a.id - b.id);

    // Compute synaptic weights for edge rendering
    const synapticWeights = await getSynapticWeights().catch(() => ({}));

    return NextResponse.json({ points, clusters, synapticWeights });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
