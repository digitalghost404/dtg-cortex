import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getBriefing, getLatestBriefing, listBriefingDates } from "@/lib/briefing";
import { generateBriefing } from "@/lib/briefing-generator";

export const maxDuration = 60;

/**
 * GET /api/briefing — fetch briefing data.
 *   ?date=YYYY-MM-DD  → specific date
 *   ?list=true        → array of available dates
 *   (no params)       → today's briefing, fallback to latest
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  if (searchParams.get("list") === "true") {
    const dates = await listBriefingDates();
    return NextResponse.json({ dates });
  }

  const date = searchParams.get("date");
  if (date) {
    const briefing = await getBriefing(date);
    if (!briefing) {
      return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
    }
    return NextResponse.json(briefing);
  }

  // Default: today, fallback to latest.
  // Auto-generate only if: (a) no briefings exist at all (first seed), or
  // (b) today's briefing is missing AND it's past 7 AM EST.
  const today = new Date().toISOString().slice(0, 10);
  let briefing = await getBriefing(today);
  if (!briefing) {
    const existing = await listBriefingDates();
    const isFirstEver = existing.length === 0;
    const nowEST = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const isPast7am = nowEST.getHours() >= 7;

    if (isFirstEver || isPast7am) {
      try {
        briefing = await generateBriefing();
      } catch (err) {
        console.error("[api/briefing] Auto-generation failed:", err);
      }
    }
  }
  if (!briefing) {
    briefing = await getLatestBriefing();
    if (briefing && briefing.date !== today) {
      return NextResponse.json({ ...briefing, stale: true });
    }
  }
  if (!briefing) {
    return NextResponse.json({ error: "No briefings available" }, { status: 404 });
  }
  return NextResponse.json(briefing);
}

/**
 * POST /api/briefing — generate today's briefing.
 * Auth: JWT cookie (via middleware) OR x-cron-secret header.
 */
export async function POST(req: NextRequest) {
  // Defense-in-depth: validate cron secret if provided
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    if (!expectedSecret || cronSecret !== expectedSecret) {
      return NextResponse.json({ error: "Invalid cron secret" }, { status: 401 });
    }
  }

  try {
    const briefing = await generateBriefing();
    if (!briefing) {
      return NextResponse.json({ error: "Generation failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, date: briefing.date });
  } catch (err) {
    console.error("[api/briefing] Generation failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 }
    );
  }
}
