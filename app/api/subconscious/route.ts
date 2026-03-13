import { NextResponse } from "next/server";
import { computeDiff, updateLastVisit } from "@/lib/subconscious";

export async function GET() {
  try {
    const diff = await computeDiff();
    if (!diff) {
      return NextResponse.json({ active: false });
    }
    return NextResponse.json({ active: true, ...diff });
  } catch (err) {
    console.error("[subconscious]", err);
    return NextResponse.json({ active: false });
  }
}

export async function POST() {
  try {
    await updateLastVisit();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[subconscious] update lastVisit failed:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
