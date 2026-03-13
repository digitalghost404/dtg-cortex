import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runSync } from "@/lib/sync";

export const maxDuration = 300; // 5 minutes

/**
 * POST /api/sync — triggers a vault sync.
 * Auth: JWT cookie OR x-cron-secret header matching CRON_SECRET env var.
 */
export async function POST(req: NextRequest) {
  // Auth check: either valid JWT (handled by middleware) or cron secret
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  // If the request got past middleware, the user is authenticated via JWT.
  // But for cron requests, we also accept the cron secret header.
  if (cronSecret) {
    if (!expectedSecret || cronSecret !== expectedSecret) {
      return NextResponse.json({ error: "Invalid cron secret" }, { status: 401 });
    }
  }

  try {
    const result = await runSync();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/sync] Sync failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
