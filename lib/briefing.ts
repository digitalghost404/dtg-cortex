import { getJSON, setJSON, zadd, zrange, zrem, deleteKey } from "./kv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BriefingTopic {
  id: string;
  label: string;
  query: string;
}

export interface BriefingStory {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface BriefingSection {
  topic: BriefingTopic;
  stories: BriefingStory[];
  analysis: string;
}

export interface Briefing {
  date: string;
  generatedAt: string;
  sections: BriefingSection[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Hardcoded topics
// ---------------------------------------------------------------------------

export const TOPICS: BriefingTopic[] = [
  { id: "ai-ml", label: "AI & Machine Learning", query: "AI machine learning LLM news today" },
  { id: "tech", label: "Tech Industry", query: "tech industry news startups funding launches today" },
  { id: "cloud-devops", label: "Cloud & DevOps", query: "cloud devops kubernetes infrastructure news today" },
  { id: "science-space", label: "Science & Space", query: "science space NASA SpaceX biotech news today" },
];

// ---------------------------------------------------------------------------
// KV helpers
// ---------------------------------------------------------------------------

const DATES_KEY = "briefing:dates";

function briefingKey(date: string): string {
  return `briefing:${date}`;
}

export async function getBriefing(date: string): Promise<Briefing | null> {
  return getJSON<Briefing>(briefingKey(date));
}

export async function saveBriefing(briefing: Briefing): Promise<void> {
  await setJSON(briefingKey(briefing.date), briefing);
  await zadd(DATES_KEY, new Date(briefing.date).getTime(), briefing.date);
}

export async function listBriefingDates(): Promise<string[]> {
  // zrange returns ascending; reverse for newest-first
  const dates = await zrange(DATES_KEY, 0, -1);
  return dates.reverse();
}

export async function getLatestBriefing(): Promise<Briefing | null> {
  const dates = await listBriefingDates();
  if (dates.length === 0) return null;
  return getBriefing(dates[0]);
}

export async function pruneBriefings(keepDays = 30): Promise<void> {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const dates = await zrange(DATES_KEY, 0, -1);
  for (const date of dates) {
    if (new Date(date).getTime() < cutoff) {
      await deleteKey(briefingKey(date));
      await zrem(DATES_KEY, date);
    }
  }
}
