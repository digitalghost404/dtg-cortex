import { NextResponse } from "next/server";
import { startWatcher, stopWatcher, isWatching } from "@/lib/watcher";

export async function GET() {
  return NextResponse.json({ watching: isWatching() });
}

export async function POST() {
  try {
    startWatcher();
    return NextResponse.json({ watching: true }, { status: 200 });
  } catch (err) {
    console.error("[watch POST]", err);
    return NextResponse.json({ error: "Failed to start watcher" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    await stopWatcher();
    return NextResponse.json({ watching: false }, { status: 200 });
  } catch (err) {
    console.error("[watch DELETE]", err);
    return NextResponse.json({ error: "Failed to stop watcher" }, { status: 500 });
  }
}
