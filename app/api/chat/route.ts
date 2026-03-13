import { anthropic } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  UIMessage,
} from "ai";
import { queryIndex } from "@/lib/indexer";
import { getSession, saveSession } from "@/lib/sessions";
import type { Message } from "@/lib/sessions";
import { webSearch, WebSearchResult } from "@/lib/websearch";
import { saveLineageEntry } from "@/lib/lineage";
import { loadPersonality, personalityToPrompt } from "@/lib/personality";
import { getMemoryContext, addMemory } from "@/lib/memory";
import { getCircadianPhase } from "@/lib/circadian";

export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Memory extraction — heuristic regex, no LLM call
// ---------------------------------------------------------------------------

async function extractMemories(userText: string, sessionId: string): Promise<void> {
  const patterns = [
    { regex: /(?:i prefer|i like|i want you to)\s+(.+?)(?:\.|$)/i, type: "preference" as const },
    { regex: /(?:i(?:'m| am) (?:a|an))\s+(.+?)(?:\.|$)/i, type: "fact" as const },
    { regex: /(?:i work (?:on|at|in|with))\s+(.+?)(?:\.|$)/i, type: "fact" as const },
    { regex: /(?:remember that|don't forget|keep in mind)\s+(.+?)(?:\.|$)/i, type: "fact" as const },
    { regex: /(?:i(?:'m| am) interested in|i care about)\s+(.+?)(?:\.|$)/i, type: "interest" as const },
  ];

  for (const { regex, type } of patterns) {
    const match = userText.match(regex);
    if (match && match[1]) {
      await addMemory({
        type,
        content: match[1].trim(),
        source: sessionId,
      });
    }
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as { messages: UIMessage[]; sessionId?: string };
  const { messages, sessionId } = body;

  const rawUserMessage =
    [...messages]
      .reverse()
      .find((m) => m.role === "user")
      ?.parts.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ") ?? "";

  // Detect explicit /web prefix
  const isExplicitWeb = rawUserMessage.trimStart().startsWith("/web");
  const userQuery = isExplicitWeb
    ? rawUserMessage.trimStart().replace(/^\/web\s*/i, "").trim()
    : rawUserMessage;

  // Detect debate mode: "Challenge my understanding of X", etc.
  const isDebateMode = /^challenge\s+(my\s+)?(understanding|knowledge|thinking|ideas|notes)\s+(of|about|on|regarding)\s+/i.test(userQuery);

  let contextBlock = "";
  let sources: Array<{ name: string; path: string; score: number }> = [];
  let webResults: WebSearchResult[] = [];

  // --- Vault RAG ---
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

  // --- Web search ---
  const shouldSearchWeb = isExplicitWeb || sources.length === 0 || isDebateMode;
  if (shouldSearchWeb) {
    try {
      webResults = await webSearch(userQuery, 5);
    } catch (err) {
      console.error("[chat web search]", err);
    }
  }

  // Append web results to the context block
  if (webResults.length > 0) {
    const webBlock =
      "Web search results:\n\n" +
      webResults
        .map((r) => `## ${r.title} (${r.url})\n${r.content}`)
        .join("\n\n---\n\n");

    contextBlock = contextBlock
      ? `${contextBlock}\n\n${webBlock}`
      : webBlock;
  }

  // --- Personality ---
  const personality = await loadPersonality();
  const personalityPrompt = personalityToPrompt(personality);

  // --- Memory context ---
  const memoryContext = await getMemoryContext();
  const memorySection = memoryContext ? `\n\n${memoryContext}` : "";

  // --- Circadian personality modifier ---
  const circadian = getCircadianPhase(new Date().getHours());
  const circadianSection = `\n\n[Circadian: ${circadian.phase}] ${circadian.personalityModifier}`;

  // --- System prompt ---
  const hasVault = sources.length > 0;
  const hasWeb = webResults.length > 0;

  let systemPrompt: string;
  if (isDebateMode && hasVault) {
    systemPrompt = `You are Cortex in DEBATE MODE — an intellectual sparring partner. The user has asked you to challenge their understanding based on their vault notes below. Your job is NOT to agree or summarize. Instead:

1. **STRENGTHS**: Briefly acknowledge what's well-covered (2-3 sentences max)
2. **GAPS**: Identify important aspects of this topic that are completely missing from their notes
3. **WEAK POINTS**: Find claims that lack evidence, reasoning that doesn't hold up, or oversimplifications
4. **CONTRADICTIONS**: If different notes say conflicting things, call it out specifically
5. **BLIND SPOTS**: What perspectives or counterarguments are they not considering?
6. **QUESTIONS TO EXPLORE**: End with 3-5 specific, thought-provoking questions they should investigate

Be direct and specific. Reference notes by name. Don't be mean, but don't be soft either — the user wants to be challenged.

${contextBlock}

${personalityPrompt}${memorySection}${circadianSection}`;
  } else if (hasVault && hasWeb) {
    systemPrompt = `You are Cortex, an intelligent assistant with access to the user's personal Obsidian knowledge vault AND live web search results. Use the retrieved context below to answer questions accurately. When referencing a vault note mention its name; when referencing a web source cite its URL. If the context doesn't contain enough information, say so honestly.\n\n${contextBlock}\n\n${personalityPrompt}${memorySection}${circadianSection}`;
  } else if (hasVault) {
    systemPrompt = `You are Cortex, an intelligent assistant with access to the user's personal Obsidian knowledge vault. Use the retrieved context below to answer questions accurately. When referencing a note, mention its name. If the context doesn't contain enough information to answer, say so honestly.\n\n${contextBlock}\n\n${personalityPrompt}${memorySection}${circadianSection}`;
  } else if (hasWeb) {
    systemPrompt = `You are Cortex, an intelligent assistant. The vault index returned no results, so you are answering using live web search results below. Cite sources by their URL where relevant. If the context doesn't contain enough information, say so honestly.\n\n${contextBlock}\n\n${personalityPrompt}${memorySection}${circadianSection}`;
  } else {
    systemPrompt = `You are Cortex, an intelligent assistant connected to the user's personal Obsidian knowledge vault. The vault index hasn't been built yet, so you're operating without note context. Let the user know they should index their vault via the button in the top-right corner.\n\n${personalityPrompt}${memorySection}${circadianSection}`;
  }

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

      // Write source-url chunks for web results
      for (let i = 0; i < webResults.length; i++) {
        writer.write({
          type: "source-url",
          sourceId: `web|${i}|${webResults[i].score.toFixed(4)}`,
          url: webResults[i].url,
          title: webResults[i].title,
        });
      }

      const result = streamText({
        model: anthropic("claude-sonnet-4-6"),
        system: systemPrompt,
        messages: await convertToModelMessages(messages),
        onFinish: async ({ response }) => {
          if (!sessionId) return;
          try {
            const session = await getSession(sessionId);
            if (!session) return;

            const updatedMessages: Message[] = messages.map((m) => ({
              id: m.id,
              role: m.role as "user" | "assistant",
              parts: m.parts as Message["parts"],
            }));

            const assistantModelMsg = response.messages.at(-1);
            if (assistantModelMsg) {
              const rawContent = assistantModelMsg.content;
              const textContent =
                typeof rawContent === "string"
                  ? rawContent
                  : (rawContent as Array<{ type: string; text?: string }>)
                      .filter((c) => c.type === "text")
                      .map((c) => c.text ?? "")
                      .join("");

              const assistantUIMsg: Message = {
                id: crypto.randomUUID(),
                role: "assistant",
                parts: [
                  // Vault source-url parts
                  ...sources.map((src, i) => ({
                    type: "source-url" as const,
                    sourceId: `${i}|${src.score.toFixed(4)}`,
                    url: src.path,
                    title: src.name,
                  })),
                  // Web source-url parts
                  ...webResults.map((r, i) => ({
                    type: "source-url" as const,
                    sourceId: `web|${i}|${r.score.toFixed(4)}`,
                    url: r.url,
                    title: r.title,
                  })),
                  { type: "text", text: textContent },
                ],
              };
              updatedMessages.push(assistantUIMsg);
            }

            session.messages = updatedMessages;
            session.updatedAt = new Date().toISOString();

            if (session.title === "New Session") {
              const firstUser = updatedMessages.find((m) => m.role === "user");
              if (firstUser) {
                const text = firstUser.parts
                  .filter((p) => p.type === "text")
                  .map((p) => p.text ?? "")
                  .join(" ")
                  .trim();
                if (text.length > 0) {
                  session.title = text.slice(0, 40) + (text.length > 40 ? "..." : "");
                }
              }
            }

            await saveSession(session);

            // Extract memories from user message
            try {
              await extractMemories(userQuery, sessionId ?? "unknown");
            } catch (memErr) {
              console.error("[chat onFinish memory extract]", memErr);
            }

            // Save lineage entry
            try {
              await saveLineageEntry({
                id: crypto.randomUUID(),
                timestamp: new Date().toISOString(),
                sessionId: sessionId ?? "",
                query: userQuery,
                sourceNotes: sources.map((s) => ({
                  name: s.name,
                  path: s.path,
                  score: s.score,
                })),
                webSources:
                  webResults.length > 0
                    ? webResults.map((r) => ({ title: r.title, url: r.url }))
                    : undefined,
              });
            } catch (lineageErr) {
              console.error("[chat onFinish lineage save]", lineageErr);
            }
          } catch (err) {
            console.error("[chat onFinish session save]", err);
          }
        },
      });

      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
