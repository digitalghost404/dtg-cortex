// ---------------------------------------------------------------------------
// Dossier — Types + KV CRUD (follows lib/briefing.ts pattern)
// ---------------------------------------------------------------------------

import { getJSON, setJSON, zadd, zrange, zrem, deleteKey } from "./kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultFinding {
  noteName: string;
  notePath: string;
  score: number;
  excerpt: string;
}

export interface WebFinding {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface DossierSynthesis {
  vaultSummary: string;
  webSummary: string;
  agreements: string[];
  gaps: string[];
  recommendations: string[];
}

export interface Dossier {
  id: string;
  topic: string;
  createdAt: string;
  savedToVault: boolean;
  suggestedTags: string[];
  vaultFindings: VaultFinding[];
  webFindings: WebFinding[];
  synthesis: DossierSynthesis;
}

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

const INDEX_KEY = "dossier:index";

function dossierKey(id: string): string {
  return `dossier:${id}`;
}

export async function getDossier(id: string): Promise<Dossier | null> {
  return getJSON<Dossier>(dossierKey(id));
}

export async function saveDossier(dossier: Dossier): Promise<void> {
  await setJSON(dossierKey(dossier.id), dossier);
  await zadd(INDEX_KEY, new Date(dossier.createdAt).getTime(), dossier.id);
}

export async function listDossierIds(): Promise<string[]> {
  const ids = await zrange(INDEX_KEY, 0, -1);
  return ids.reverse(); // newest first
}

export async function deleteDossier(id: string): Promise<void> {
  await deleteKey(dossierKey(id));
  await zrem(INDEX_KEY, id);
}

export async function markSavedToVault(id: string): Promise<void> {
  const dossier = await getDossier(id);
  if (dossier) {
    dossier.savedToVault = true;
    await setJSON(dossierKey(id), dossier);
  }
}
