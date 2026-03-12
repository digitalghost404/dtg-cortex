import crypto from "crypto";
import * as kv from "./kv";

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

const SESSIONS_INDEX_KEY = "sessions:index";

function sessionKey(id: string): string {
  return `session:${id}`;
}

export async function getSessions(): Promise<Session[]> {
  // Get all session IDs sorted by updatedAt (highest score = most recent)
  const ids = await kv.zrange(SESSIONS_INDEX_KEY, 0, -1);
  if (ids.length === 0) return [];

  // Fetch all sessions
  const sessions = await kv.mget<Session>(...ids.map(sessionKey));

  return sessions
    .filter((s): s is Session => s !== null)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getSession(id: string): Promise<Session | null> {
  return kv.getJSON<Session>(sessionKey(id));
}

export async function createSession(): Promise<Session> {
  const now = new Date().toISOString();
  const session: Session = {
    id: crypto.randomUUID(),
    title: "New Session",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await kv.setJSON(sessionKey(session.id), session);
  await kv.zadd(SESSIONS_INDEX_KEY, new Date(now).getTime(), session.id);
  return session;
}

export async function saveSession(session: Session): Promise<void> {
  await kv.setJSON(sessionKey(session.id), session);
  await kv.zadd(SESSIONS_INDEX_KEY, new Date(session.updatedAt).getTime(), session.id);
}

export async function deleteSession(id: string): Promise<void> {
  await kv.deleteKey(sessionKey(id));
  await kv.zrem(SESSIONS_INDEX_KEY, id);
}
