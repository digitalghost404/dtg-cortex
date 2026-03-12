import { webSearch, WebSearchResult } from "@/lib/websearch";

export async function POST(req: Request): Promise<Response> {
  let query: string;

  try {
    const body = (await req.json()) as { query?: unknown };
    if (typeof body.query !== "string" || body.query.trim() === "") {
      return Response.json(
        { error: "Request body must include a non-empty 'query' string." },
        { status: 400 },
      );
    }
    query = body.query.trim();
  } catch {
    return Response.json(
      { error: "Invalid JSON in request body." },
      { status: 400 },
    );
  }

  let results: WebSearchResult[];
  try {
    results = await webSearch(query);
  } catch (err) {
    console.error("[websearch route]", err);
    return Response.json(
      { error: "Web search failed. Check that TAVILY_API_KEY is set and valid." },
      { status: 502 },
    );
  }

  return Response.json({ results });
}
