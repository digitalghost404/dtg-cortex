import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  getAuthConfig,
  verifyPassword,
  verifyTotpWithReplay,
  signJWT,
  checkRateLimit,
  LOGIN_RATE_LIMIT,
  COOKIE_NAME,
} from "@/lib/auth";

export async function POST(req: Request) {
  // C-2: Rate limiting by IP
  const hdrs = await headers();
  const ip = hdrs.get("x-real-ip") || hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!(await checkRateLimit(`login:${ip}`, LOGIN_RATE_LIMIT))) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429 }
    );
  }

  const config = await getAuthConfig();
  if (!config?.setupComplete) {
    return NextResponse.json({ error: "Setup not complete" }, { status: 400 });
  }

  let body: { password?: string; totpToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { password, totpToken } = body;

  if (!password || !totpToken) {
    return NextResponse.json({ error: "Password and TOTP code required" }, { status: 400 });
  }

  // M-1: Reject passwords over bcrypt's 72-byte limit early
  if (new TextEncoder().encode(password).length > 72) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Verify password first — avoids burning the one-time TOTP token on a wrong password
  const passwordValid = await verifyPassword(password, config.passwordHash);
  if (!passwordValid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Password valid — now verify TOTP (atomic replay check)
  const totpValid = await verifyTotpWithReplay(totpToken, config.totpSecret);
  if (!totpValid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await signJWT({ role: "owner" });

  const res = NextResponse.json({ success: true });
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,                // L-1: always secure — require HTTPS in production
    sameSite: "strict",          // M-3: strict same-site policy
    path: "/",
    maxAge: 60 * 60 * 24,       // H-2: 24h to match JWT expiry
  });

  return res;
}
