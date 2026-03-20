import { NextResponse } from "next/server";
import crypto from "crypto";
import * as kv from "@/lib/kv";
import { isSecretPath } from "@/lib/vault";

interface ShareData {
  notePath: string;
  createdAt: string;
  expiresAt: string;
}

function generateToken(): string {
  return crypto.randomBytes(24).toString("base64url"); // 32 chars, 192-bit entropy
}

/**
 * POST /api/share — create a share link (auth required)
 */
export async function POST(req: Request) {
  const { notePath, expiresIn = 72 } = (await req.json()) as {
    notePath: string;
    expiresIn?: number; // hours
  };

  if (!notePath) {
    return NextResponse.json({ error: "notePath is required" }, { status: 400 });
  }

  if (isSecretPath(notePath)) {
    return NextResponse.json({ error: "Secret notes cannot be shared" }, { status: 403 });
  }

  const MAX_EXPIRY_HOURS = 168;
  const safeExpiresIn = (typeof expiresIn === "number" && expiresIn > 0)
    ? Math.min(expiresIn, MAX_EXPIRY_HOURS)
    : 72;

  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + safeExpiresIn * 60 * 60 * 1000);
  const ttlSec = safeExpiresIn * 60 * 60;

  const shareData: ShareData = {
    notePath,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  // Store share data with TTL
  await kv.setWithTTL(`share:${token}`, JSON.stringify(shareData), ttlSec);

  // Add to active shares index
  await kv.sadd("share:index", token);

  const url = `/share/${token}`;

  return NextResponse.json({
    token,
    url,
    expiresAt: expiresAt.toISOString(),
  });
}

/**
 * GET /api/share — list all active shares (auth required)
 */
export async function GET() {
  const tokens = await kv.smembers("share:index");
  const shares: Array<ShareData & { token: string }> = [];

  for (const token of tokens) {
    const exists = await kv.exists(`share:${token}`);
    if (!exists) {
      // Expired — clean up index
      await kv.srem("share:index", token);
      continue;
    }

    const raw = await kv.getJSON<string>(`share:${token}`);
    if (!raw) continue;

    try {
      const data: ShareData = typeof raw === "string" ? JSON.parse(raw) : raw;
      shares.push({ ...data, token });
    } catch {
      // Corrupted entry
      continue;
    }
  }

  return NextResponse.json({ shares });
}

/**
 * DELETE /api/share — revoke a share (auth required)
 */
export async function DELETE(req: Request) {
  const { token } = (await req.json()) as { token: string };

  if (!token) {
    return NextResponse.json({ error: "token is required" }, { status: 400 });
  }

  await kv.deleteKey(`share:${token}`);
  await kv.srem("share:index", token);

  return NextResponse.json({ revoked: true });
}
