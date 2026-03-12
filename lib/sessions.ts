import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  parts: MessagePart[];
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

interface SessionStore {
  sessions: Session[];
}

const SESSIONS_FILE = path.join(process.cwd(), ".cortex-sessions.json");

function readStore(): SessionStore {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) {
      return { sessions: [] };
    }
    const raw = fs.readFileSync(SESSIONS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "sessions" in parsed &&
      Array.isArray((parsed as SessionStore).sessions)
    ) {
      return parsed as SessionStore;
    }
    return { sessions: [] };
  } catch {
    return { sessions: [] };
  }
}

function writeStore(store: SessionStore): void {
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2), "utf-8");
}

export function getSessions(): Session[] {
  const store = readStore();
  return [...store.sessions].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function getSession(id: string): Session | null {
  const store = readStore();
  return store.sessions.find((s) => s.id === id) ?? null;
}

export function createSession(): Session {
  const now = new Date().toISOString();
  const session: Session = {
    id: crypto.randomUUID(),
    title: "New Session",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  const store = readStore();
  store.sessions.push(session);
  writeStore(store);
  return session;
}

export function saveSession(session: Session): void {
  const store = readStore();
  const idx = store.sessions.findIndex((s) => s.id === session.id);
  if (idx === -1) {
    store.sessions.push(session);
  } else {
    store.sessions[idx] = session;
  }
  writeStore(store);
}

export function deleteSession(id: string): void {
  const store = readStore();
  store.sessions = store.sessions.filter((s) => s.id !== id);
  writeStore(store);
}
