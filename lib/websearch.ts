import { tavily, type TavilyClient } from "@tavily/core";

let _client: TavilyClient | null = null;
function getClient(): TavilyClient {
  if (!_client) {
    _client = tavily({ apiKey: process.env.TAVILY_API_KEY! });
  }
  return _client;
}

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
  const response = await getClient().search(query, {
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
