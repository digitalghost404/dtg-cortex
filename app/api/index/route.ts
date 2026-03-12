import { NextResponse } from "next/server";
import { buildIndex, indexExists } from "@/lib/indexer";

export async function POST() {
  try {
    await buildIndex();
    return NextResponse.json({ success: true, message: "Vault indexed successfully." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ indexed: indexExists() });
}
