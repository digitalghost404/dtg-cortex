import { NextRequest, NextResponse } from "next/server";
import { buildIndex, indexExists } from "@/lib/indexer";
import { verifyJWT, COOKIE_NAME } from "@/lib/auth";
import { setNX, deleteKey } from "@/lib/kv";

const REINDEX_LOCK_KEY = "index:lock";
const REINDEX_LOCK_TTL = 300; // seconds

export async function POST(req: NextRequest) {
  // Defense-in-depth: verify the session JWT from the cookie.
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token || !(await verifyJWT(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Acquire a distributed lock so only one reindex can run at a time.
  const acquired = await setNX(REINDEX_LOCK_KEY, "1", REINDEX_LOCK_TTL);
  if (!acquired) {
    return NextResponse.json({ error: "Reindex already in progress" }, { status: 409 });
  }

  try {
    await buildIndex();
    // Invalidate cached clusters since index changed
    await deleteKey("cache:clusters").catch(() => {});
    return NextResponse.json({ success: true, message: "Vault indexed successfully." });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  } finally {
    // Always release the lock, even if buildIndex() threw.
    await deleteKey(REINDEX_LOCK_KEY).catch((err) =>
      console.error("[reindex] Failed to release lock, will expire in", REINDEX_LOCK_TTL, "s:", err)
    );
  }
}

export async function GET() {
  const indexed = await indexExists();
  return NextResponse.json({ indexed });
}
