import * as kv from "./kv";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VaultNote {
  name: string;
  path: string;
  content: string;
  rawContent: string;
  tags: string[];
  outgoing: string[];
  folder: string;
  words: number;
  modifiedAt: string;
  size: number;
}

export interface VaultMeta {
  totalNotes: number;
  totalWords: number;
  lastSyncAt: string;
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

const isServerless = !!process.env.KV_REST_API_URL;
const VAULT_PATH = process.env.VAULT_PATH;

// ---------------------------------------------------------------------------
// Secrets folder protection
// ---------------------------------------------------------------------------

/**
 * Returns true if the given path is inside the secrets/ folder.
 * Works with both relative vault paths ("secrets/foo.md") and full paths.
 */
export function isSecretPath(notePath: string): boolean {
  const normalized = notePath.replace(/\\/g, "/");
  return (
    normalized === "secrets" ||
    normalized.startsWith("secrets/") ||
    normalized.includes("/secrets/")
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function normaliseTag(raw: unknown): string {
  const s = String(raw).trim();
  return s.startsWith("#") ? s : `#${s}`;
}

function extractTags(data: Record<string, unknown>): string[] {
  const raw = data.tags ?? data.tag ?? data.Topics ?? data.topics ?? null;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normaliseTag);
  if (typeof raw === "string") {
    return raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normaliseTag);
  }
  return [];
}

function wikilinkTarget(raw: string): string {
  return raw.split(/[|#]/)[0].trim();
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

// ---------------------------------------------------------------------------
// Filesystem mode: read directly from disk
// ---------------------------------------------------------------------------

function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...collectMarkdownFiles(full));
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        results.push(full);
      }
    }
  } catch {
    // silently skip unreadable dirs
  }
  return results;
}

function readNoteFromDisk(fullPath: string, vaultPath: string): VaultNote {
  const raw = fs.readFileSync(fullPath, "utf8");
  const { data, content } = matter(raw);
  const name = path.basename(fullPath, ".md");
  const relativePath = path.relative(vaultPath, fullPath);
  const folder = path.dirname(relativePath) === "." ? "(root)" : path.dirname(relativePath);
  const stat = fs.statSync(fullPath);

  const outgoing: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, "g");
  while ((match = re.exec(content)) !== null) {
    outgoing.push(wikilinkTarget(match[1]));
  }

  return {
    name,
    path: relativePath,
    content,
    rawContent: raw,
    tags: extractTags(data as Record<string, unknown>),
    outgoing,
    folder,
    words: countWords(content),
    modifiedAt: stat.mtime.toISOString(),
    size: stat.size,
  };
}

function getAllNotesFromDisk(vaultPath: string): VaultNote[] {
  const files = collectMarkdownFiles(vaultPath);
  return files.map((f) => readNoteFromDisk(f, vaultPath));
}

// ---------------------------------------------------------------------------
// Redis mode: read from Upstash Redis
// ---------------------------------------------------------------------------

function safeParseArray(value: unknown): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function getNoteFromRedis(notePath: string): Promise<VaultNote | null> {
  const data = await kv.hgetall<Record<string, unknown>>(`vault:note:${notePath}`);
  if (!data) return null;
  return {
    name: String(data.name ?? ""),
    path: notePath,
    content: String(data.content ?? ""),
    rawContent: String(data.rawContent ?? ""),
    tags: safeParseArray(data.tags),
    outgoing: safeParseArray(data.outgoing),
    folder: String(data.folder ?? ""),
    words: Number(data.words) || 0,
    modifiedAt: String(data.modifiedAt ?? ""),
    size: Number(data.size) || 0,
  };
}

async function getAllNotesFromRedis(): Promise<VaultNote[]> {
  const paths = await kv.smembers("vault:notes:index");
  if (paths.length === 0) return [];

  const notes: VaultNote[] = [];
  // Batch in groups to avoid overwhelming Redis
  const BATCH = 50;
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((p) => getNoteFromRedis(p)));
    for (const note of results) {
      if (note) notes.push(note);
    }
  }
  return notes;
}

async function getVaultMetaFromRedis(): Promise<VaultMeta | null> {
  const data = await kv.hgetall<Record<string, string>>("vault:meta");
  if (!data) return null;
  return {
    totalNotes: Number(data.totalNotes) || 0,
    totalWords: Number(data.totalWords) || 0,
    lastSyncAt: data.lastSyncAt ?? "",
  };
}

// ---------------------------------------------------------------------------
// Public API (dual-mode)
// ---------------------------------------------------------------------------

export async function getAllNotes(): Promise<VaultNote[]> {
  if (isServerless) {
    return getAllNotesFromRedis();
  }
  if (!VAULT_PATH || !fs.existsSync(VAULT_PATH)) return [];
  return getAllNotesFromDisk(VAULT_PATH);
}

export async function getNote(notePath: string): Promise<VaultNote | null> {
  if (isServerless) {
    return getNoteFromRedis(notePath);
  }
  if (!VAULT_PATH) return null;
  const fullPath = path.resolve(VAULT_PATH, notePath);
  if (!fullPath.startsWith(path.resolve(VAULT_PATH))) return null;
  try {
    return readNoteFromDisk(fullPath, VAULT_PATH);
  } catch {
    return null;
  }
}

export async function getVaultMeta(): Promise<VaultMeta | null> {
  if (isServerless) {
    return getVaultMetaFromRedis();
  }
  if (!VAULT_PATH || !fs.existsSync(VAULT_PATH)) return null;
  const notes = getAllNotesFromDisk(VAULT_PATH);
  return {
    totalNotes: notes.length,
    totalWords: notes.reduce((s, n) => s + n.words, 0),
    lastSyncAt: new Date().toISOString(),
  };
}

export function getVaultPath(): string | undefined {
  return VAULT_PATH;
}

export function isServerlessMode(): boolean {
  return isServerless;
}
