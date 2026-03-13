import { NextResponse } from "next/server";
import { getJournalEntries, generateJournalEntry } from "@/lib/journal";

export async function GET() {
  try {
    const entries = await getJournalEntries(14);
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("[journal]", err);
    return NextResponse.json({ entries: [] }, { status: 500 });
  }
}

export async function POST() {
  try {
    const entry = await generateJournalEntry();
    return NextResponse.json(entry);
  } catch (err) {
    console.error("[journal POST]", err);
    return NextResponse.json({ error: "Failed to generate journal entry" }, { status: 500 });
  }
}
