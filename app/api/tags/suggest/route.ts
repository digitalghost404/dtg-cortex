import { NextResponse } from "next/server";
import { queryVectors } from "@/lib/vector";

// Voyage AI embed (same as lib/indexer.ts)
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY!;

async function embedText(input: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: [input], model: "voyage-3" }),
  });
  if (!res.ok) {
    throw new Error(`Voyage AI error: ${res.status}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

export async function POST(req: Request) {
  try {
    const { content, existingTags = [] } = (await req.json()) as {
      content: string;
      existingTags?: string[];
    };

    if (!content || content.trim().length < 20) {
      return NextResponse.json({ tags: [] });
    }

    // Truncate to ~500 words for embedding
    const truncated = content.split(/\s+/).slice(0, 500).join(" ");

    // Embed content and find similar chunks
    const vector = await embedText(truncated);
    const results = await queryVectors(vector, 10);

    // Collect tags from similar chunks, rank by frequency
    const tagFreq = new Map<string, number>();
    for (const r of results) {
      if (r.metadata.tags) {
        for (const tag of r.metadata.tags) {
          const normalised = tag.startsWith("#") ? tag : `#${tag}`;
          if (!existingTags.includes(normalised)) {
            tagFreq.set(normalised, (tagFreq.get(normalised) ?? 0) + 1);
          }
        }
      }
    }

    // Sort by frequency, return top 5 (respecting max 5 total)
    const maxSuggestions = Math.max(0, 5 - existingTags.length);
    const tags = Array.from(tagFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxSuggestions)
      .map(([tag]) => tag);

    return NextResponse.json({ tags });
  } catch (err) {
    console.error("[tags/suggest] Error:", err);
    return NextResponse.json({ tags: [] });
  }
}
