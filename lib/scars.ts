// ---------------------------------------------------------------------------
// Scar Tissue — tombstones for deleted notes
// ---------------------------------------------------------------------------

import { getJSON, setJSON, deleteKey, zadd, zrange, zrem } from "./kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScarTombstone {
  path: string;
  name: string;
  folder: string;
  tags: string[];
  connectedNotes: string[];
  deletedAt: string;
}

const SCARS_SET_KEY = "cortex:scars";
const SCAR_TTL_DAYS = 30;

function scarKey(path: string): string {
  return `scar:${path}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function saveScar(data: {
  path: string;
  name: string;
  folder: string;
  tags: string[];
  connectedNotes: string[];
}): Promise<void> {
  const tombstone: ScarTombstone = {
    ...data,
    deletedAt: new Date().toISOString(),
  };

  await setJSON(scarKey(data.path), tombstone);
  await zadd(SCARS_SET_KEY, Date.now(), data.path);
}

export async function getScars(): Promise<ScarTombstone[]> {
  const paths = await zrange(SCARS_SET_KEY, 0, -1);
  const scars: ScarTombstone[] = [];

  const cutoff = Date.now() - SCAR_TTL_DAYS * 24 * 60 * 60 * 1000;

  for (const p of paths) {
    const scar = await getJSON<ScarTombstone>(scarKey(p));
    if (!scar) {
      await zrem(SCARS_SET_KEY, p);
      continue;
    }

    const deletedTime = new Date(scar.deletedAt).getTime();
    if (deletedTime < cutoff) {
      // Expired — prune
      await deleteKey(scarKey(p));
      await zrem(SCARS_SET_KEY, p);
      continue;
    }

    scars.push(scar);
  }

  // Sort newest first
  scars.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());
  return scars;
}

export async function pruneScars(keepDays = 30): Promise<number> {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const paths = await zrange(SCARS_SET_KEY, 0, -1);
  let pruned = 0;

  for (const p of paths) {
    const scar = await getJSON<ScarTombstone>(scarKey(p));
    if (!scar || new Date(scar.deletedAt).getTime() < cutoff) {
      await deleteKey(scarKey(p));
      await zrem(SCARS_SET_KEY, p);
      pruned++;
    }
  }

  return pruned;
}
