import { NextResponse } from "next/server";
import { detectDrift } from "@/lib/drift";

export async function GET() {
  try {
    const drift = await detectDrift();
    return NextResponse.json(drift);
  } catch (err) {
    console.error("[drift]", err);
    return NextResponse.json(
      { emerging: [], fading: [], stable: [] },
      { status: 500 }
    );
  }
}
