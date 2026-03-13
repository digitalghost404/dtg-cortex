import { NextResponse } from "next/server";
import { findEcho } from "@/lib/echo";

export async function POST(request: Request) {
  try {
    const { query } = (await request.json()) as { query?: string };
    if (!query || query.trim().length === 0) {
      return NextResponse.json({ echo: null });
    }

    const echo = await findEcho(query);
    return NextResponse.json({ echo });
  } catch (err) {
    console.error("[echo]", err);
    return NextResponse.json({ echo: null });
  }
}
