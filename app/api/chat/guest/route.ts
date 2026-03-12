import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  UIMessage,
} from "ai";
import { queryIndex } from "@/lib/indexer";
import * as kv from "@/lib/kv";

export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Daily date key helper
// ---------------------------------------------------------------------------

function todayKey(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `guest:messages:${yyyy}-${mm}-${dd}`;
}

const DAILY_CAP = 100;
const HOURLY_LIMIT = 10;
const MAX_INPUT_CHARS = 500;
const MAX_OUTPUT_TOKENS = 500;

export async function POST(req: Request) {
  // ---------------------------------------------------------------------------
  // IP-based rate limit: 10 messages per hour
  // ---------------------------------------------------------------------------
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "unknown";
  const ipKey = `guest:ratelimit:${ip}`;

  const allowed = await kv.rateLimit(ipKey, HOURLY_LIMIT, 3600);
  if (!allowed) {
    return Response.json(
      { error: "Rate limit exceeded. Guest access is limited to 10 messages per hour." },
      { status: 429 }
    );
  }

  // ---------------------------------------------------------------------------
  // Daily global cap: 100 messages across all guests
  // ---------------------------------------------------------------------------
  const dailyKey = todayKey();
  const dailyAllowed = await kv.rateLimit(dailyKey, DAILY_CAP, 86400);
  if (!dailyAllowed) {
    return Response.json(
      { error: "Daily guest message limit reached. Please try again tomorrow or log in." },
      { status: 429 }
    );
  }

  // ---------------------------------------------------------------------------
  // Parse body
  // ---------------------------------------------------------------------------
  let messages: UIMessage[];
  try {
    const body = (await req.json()) as { messages: UIMessage[] };
    messages = body.messages;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  // ---------------------------------------------------------------------------
  // Input length guard (last user message)
  // ---------------------------------------------------------------------------
  const rawUserMessage =
    [...messages]
      .reverse()
      .find((m) => m.role === "user")
      ?.parts.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ") ?? "";

  if (rawUserMessage.length > MAX_INPUT_CHARS) {
    return Response.json(
      { error: `Guest messages are limited to ${MAX_INPUT_CHARS} characters.` },
      { status: 400 }
    );
  }

  const userQuery = rawUserMessage.trim();

  // ---------------------------------------------------------------------------
  // Vault RAG (no web search for guests)
  // ---------------------------------------------------------------------------
  let contextBlock = "";
  let sources: Array<{ name: string; path: string; score: number }> = [];

  try {
    const chunks = await queryIndex(userQuery, 6);
    if (chunks.length > 0) {
      contextBlock =
        "Relevant notes from the vault:\n\n" +
        chunks
          .map((c) => `## ${c.name} (${c.path})\n${c.text}`)
          .join("\n\n---\n\n");

      sources = chunks.map((c) => ({ name: c.name, path: c.path, score: c.score }));
    }
  } catch {
    // Index not built yet — answer without vault context
  }

  // ---------------------------------------------------------------------------
  // System prompt — simplified, no personality/memory
  // ---------------------------------------------------------------------------
  const systemPrompt = contextBlock
    ? `You are Cortex, an AI assistant that answers questions based on the user's knowledge vault. Be concise. You are in guest mode with limited capabilities.\n\n${contextBlock}`
    : "You are Cortex, an AI assistant that answers questions based on the user's knowledge vault. Be concise. You are in guest mode with limited capabilities. The vault index is not available right now.";

  // ---------------------------------------------------------------------------
  // Stream response
  // ---------------------------------------------------------------------------
  const stream = createUIMessageStream({
    async execute({ writer }) {
      // Write source-url chunks for vault notes
      for (let i = 0; i < sources.length; i++) {
        writer.write({
          type: "source-url",
          sourceId: `${i}|${sources[i].score.toFixed(4)}`,
          url: sources[i].path,
          title: sources[i].name,
        });
      }

      const result = streamText({
        model: anthropic("claude-haiku-4-5-20251001"),
        system: systemPrompt,
        messages: await convertToModelMessages(messages),
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });

      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
