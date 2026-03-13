import { NextResponse } from "next/server";
import { getScars } from "@/lib/scars";

export async function GET() {
  try {
    const scars = await getScars();
    return NextResponse.json({ scars });
  } catch (err) {
    console.error("[scars]", err);
    return NextResponse.json({ scars: [] });
  }
}
