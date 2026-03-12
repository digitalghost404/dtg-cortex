import { NextResponse } from "next/server";
import { isServerlessMode } from "@/lib/vault";

// In serverless mode, the watcher is disabled — no persistent filesystem
const serverless = isServerlessMode();

export async function GET() {
  if (serverless) {
    return NextResponse.json({ watching: false, mode: "serverless" });
  }
  // Dynamic import to avoid loading chokidar in serverless
  const { isWatching } = await import("@/lib/watcher");
  return NextResponse.json({ watching: isWatching() });
}

export async function POST() {
  if (serverless) {
    return NextResponse.json(
      { error: "File watcher is not available in serverless mode" },
      { status: 400 }
    );
  }
  try {
    const { startWatcher } = await import("@/lib/watcher");
    startWatcher();
    return NextResponse.json({ watching: true }, { status: 200 });
  } catch (err) {
    console.error("[watch POST]", err);
    return NextResponse.json({ error: "Failed to start watcher" }, { status: 500 });
  }
}

export async function DELETE() {
  if (serverless) {
    return NextResponse.json({ watching: false, mode: "serverless" }, { status: 200 });
  }
  try {
    const { stopWatcher } = await import("@/lib/watcher");
    await stopWatcher();
    return NextResponse.json({ watching: false }, { status: 200 });
  } catch (err) {
    console.error("[watch DELETE]", err);
    return NextResponse.json({ error: "Failed to stop watcher" }, { status: 500 });
  }
}
