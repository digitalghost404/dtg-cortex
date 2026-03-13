import { NextResponse } from "next/server";
import { computeMood } from "@/lib/mood";

export async function GET() {
  try {
    const state = await computeMood();
    return NextResponse.json(state);
  } catch (err) {
    console.error("[mood]", err);
    return NextResponse.json(
      { mood: "DORMANT", intensity: 0.5 },
      { status: 500 }
    );
  }
}
