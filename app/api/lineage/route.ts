import { NextResponse } from "next/server";
import { getLineageStats } from "@/lib/lineage";

export async function GET() {
  try {
    const stats = getLineageStats();
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[lineage GET]", err);
    return NextResponse.json(
      { error: "Failed to load lineage data" },
      { status: 500 }
    );
  }
}
