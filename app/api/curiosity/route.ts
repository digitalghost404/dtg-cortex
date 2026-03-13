import { NextResponse } from "next/server";
import { getCuriosityQuestions } from "@/lib/curiosity";

export async function GET() {
  try {
    const questions = await getCuriosityQuestions();
    return NextResponse.json({ questions });
  } catch (err) {
    console.error("[curiosity]", err);
    return NextResponse.json({ questions: [] }, { status: 500 });
  }
}
