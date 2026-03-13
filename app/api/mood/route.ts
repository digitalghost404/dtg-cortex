import { NextResponse } from "next/server";
import { computeMood, detectMoodTransition } from "@/lib/mood";

export async function GET() {
  try {
    const state = await computeMood();
    const transition = await detectMoodTransition(state);
    return NextResponse.json({
      ...state,
      transition: transition ?? null,
    });
  } catch (err) {
    console.error("[mood]", err);
    return NextResponse.json(
      { mood: "DORMANT", intensity: 0.5, transition: null },
      { status: 500 }
    );
  }
}
