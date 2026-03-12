import { tavily } from "@tavily/core";

const client = tavily({ apiKey: process.env.TAVILY_API_KEY! });

export interface WebSearchResult {
  title: string;
  url: string;
  content: string; // snippet
  score: number;
}

export async function webSearch(
  query: string,
  maxResults = 5,
): Promise<WebSearchResult[]> {
  const response = await client.search(query, {
    maxResults,
    searchDepth: "basic",
    includeAnswer: false,
  });
  return response.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
    score: r.score,
  }));
}
