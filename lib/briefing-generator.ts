import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { webSearch, WebSearchResult } from "./websearch";
import {
  TOPICS,
  Briefing,
  BriefingSection,
  BriefingStory,
  BriefingTopic,
  getBriefing,
  saveBriefing,
  pruneBriefings,
} from "./briefing";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Search one topic
// ---------------------------------------------------------------------------

async function searchTopic(
  topic: BriefingTopic
): Promise<{ topic: BriefingTopic; results: WebSearchResult[] }> {
  try {
    const results = await webSearch(topic.query, 5);
    return { topic, results };
  } catch (err) {
    console.error(`[briefing] Search failed for "${topic.label}":`, err);
    return { topic, results: [] };
  }
}

// ---------------------------------------------------------------------------
// Build prompt for Haiku
// ---------------------------------------------------------------------------

function buildPrompt(
  topicResults: Array<{ topic: BriefingTopic; results: WebSearchResult[] }>
): string {
  let prompt = `You are a news analyst. Analyze today's news search results grouped by topic and provide a structured briefing.\n\n`;

  for (const { topic, results } of topicResults) {
    prompt += `## ${topic.label} (topicId: "${topic.id}")\n`;
    if (results.length === 0) {
      prompt += `No search results available for this topic.\n\n`;
    } else {
      for (const r of results) {
        prompt += `- **${r.title}** (${extractDomain(r.url)})\n  ${r.content.slice(0, 300)}\n`;
      }
      prompt += `\n`;
    }
  }

  prompt += `For each topic, write a 2-3 sentence analysis synthesizing the key developments. Use the exact topicId shown in parentheses for each section. Then write a 2-3 sentence overall summary connecting themes across all topics.`;

  return prompt;
}

// ---------------------------------------------------------------------------
// Zod schema for Haiku output
// ---------------------------------------------------------------------------

const briefingSectionSchema = z.object({
  topicId: z.enum(["ai-ml", "tech", "cloud-devops", "science-space"]),
  analysis: z.string(),
});

const briefingOutputSchema = z.object({
  sections: z.array(briefingSectionSchema),
  summary: z.string(),
});

// ---------------------------------------------------------------------------
// Generate briefing
// ---------------------------------------------------------------------------

export async function generateBriefing(): Promise<Briefing | null> {
  const date = todayDate();

  // Skip if already exists
  const existing = await getBriefing(date);
  if (existing) {
    console.log(`[briefing] Briefing for ${date} already exists, skipping.`);
    return existing;
  }

  // Search all topics in parallel
  const searchResults = await Promise.allSettled(
    TOPICS.map((t) => searchTopic(t))
  );

  const topicResults = searchResults.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { topic: TOPICS[i], results: [] as WebSearchResult[] }
  );

  // Call Haiku for analysis
  const prompt = buildPrompt(topicResults);

  let analysisMap: Record<string, string> = {};
  let summary = "";

  try {
    const { object } = await generateObject({
      model: anthropic("claude-haiku-4-5-20251001"),
      schema: briefingOutputSchema,
      prompt,
    });

    for (const s of object.sections) {
      analysisMap[s.topicId] = s.analysis;
    }
    summary = object.summary;
  } catch (err) {
    console.error("[briefing] Haiku generation failed:", err);
    return null;
  }

  // Assemble briefing
  const sections: BriefingSection[] = topicResults.map(({ topic, results }) => {
    const stories: BriefingStory[] = results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 200),
      source: extractDomain(r.url),
    }));

    return {
      topic,
      stories,
      analysis:
        analysisMap[topic.id] ||
        (results.length === 0
          ? "No results available for this topic today."
          : "Analysis unavailable."),
    };
  });

  const briefing: Briefing = {
    date,
    generatedAt: new Date().toISOString(),
    sections,
    summary,
  };

  await saveBriefing(briefing);
  await pruneBriefings(30);

  console.log(`[briefing] Generated briefing for ${date}`);
  return briefing;
}
