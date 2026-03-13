// ---------------------------------------------------------------------------
// Dossier Generator — vault search + web search + Haiku synthesis
// ---------------------------------------------------------------------------

import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import { queryIndex } from "./indexer";
import { webSearch } from "./websearch";
import {
  type Dossier,
  type VaultFinding,
  type WebFinding,
  saveDossier,
} from "./dossier";

function generateId(): string {
  return `dos_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Zod schema for Haiku output
// ---------------------------------------------------------------------------

const dossierSynthesisSchema = z.object({
  vaultSummary: z.string().describe("Summary of what the user's vault says about this topic"),
  webSummary: z.string().describe("Summary of what the web says about this topic"),
  agreements: z.array(z.string()).describe("Points where vault and web agree"),
  gaps: z.array(z.string()).describe("Knowledge gaps — what's missing from the vault"),
  recommendations: z.array(z.string()).describe("Suggested next steps or areas to explore"),
  suggestedTags: z.array(z.string()).max(5).describe("Recommended tags for this dossier, without # prefix"),
});

// ---------------------------------------------------------------------------
// Generate dossier
// ---------------------------------------------------------------------------

export async function generateDossier(topic: string): Promise<Dossier> {
  // 1. Search vault
  let vaultFindings: VaultFinding[] = [];
  try {
    const results = await queryIndex(topic, 8);
    vaultFindings = results.map((r) => ({
      noteName: r.name,
      notePath: r.path,
      score: r.score,
      excerpt: r.text.slice(0, 300),
    }));
  } catch {
    // Index might not exist — proceed with empty vault findings
  }

  // 2. Search web
  let webFindings: WebFinding[] = [];
  try {
    const results = await webSearch(topic, 5);
    webFindings = results.map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 300),
      source: extractDomain(r.url),
    }));
  } catch {
    // Web search may be unavailable
  }

  // 3. Haiku synthesis
  const vaultContext = vaultFindings.length > 0
    ? vaultFindings.map((v) => `[${v.noteName}] (score: ${v.score.toFixed(2)}): ${v.excerpt}`).join("\n\n")
    : "No relevant vault notes found.";

  const webContext = webFindings.length > 0
    ? webFindings.map((w) => `[${w.title}] (${w.source}): ${w.snippet}`).join("\n\n")
    : "No web results found.";

  const prompt = `Generate an intelligence dossier on the topic: "${topic}"

## Vault Knowledge
${vaultContext}

## Web Intelligence
${webContext}

Analyze both sources. Summarize what the vault says, what the web says, where they agree, what gaps exist in the vault, and recommend next steps. Also suggest up to 5 tags (without # prefix) that would be appropriate for categorizing this dossier.`;

  const { object } = await generateObject({
    model: anthropic("claude-haiku-4-5-20251001"),
    schema: dossierSynthesisSchema,
    prompt,
  });

  const dossier: Dossier = {
    id: generateId(),
    topic,
    createdAt: new Date().toISOString(),
    savedToVault: false,
    suggestedTags: object.suggestedTags,
    vaultFindings,
    webFindings,
    synthesis: {
      vaultSummary: object.vaultSummary,
      webSummary: object.webSummary,
      agreements: object.agreements,
      gaps: object.gaps,
      recommendations: object.recommendations,
    },
  };

  await saveDossier(dossier);
  return dossier;
}
