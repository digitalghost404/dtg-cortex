import { NextRequest, NextResponse } from "next/server";
import { queryIndex } from "@/lib/indexer";

export async function POST(req: NextRequest) {
  let body: { query?: unknown; topK?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const topK =
    typeof body.topK === "number" && body.topK > 0 && body.topK <= 20
      ? body.topK
      : 6;

  try {
    const raw = await queryIndex(query, topK);

    const results = raw.map((r) => ({
      name: r.name,
      path: r.path,
      score: r.score,
      preview: r.text.slice(0, 200),
    }));

    return NextResponse.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
