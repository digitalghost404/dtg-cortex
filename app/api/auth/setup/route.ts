import { NextResponse } from "next/server";
import { headers } from "next/headers";
import {
  getAuthConfig,
  saveAuthConfig,
  isSetupComplete,
  hashPassword,
  validatePassword,
  generateTotpSecret,
  verifyTotp,
  getTotpUri,
  checkRateLimit,
  SETUP_RATE_LIMIT,
} from "@/lib/auth";

// GET — return setup state (+ QR code if not yet set up)
export async function GET() {
  const complete = await isSetupComplete();

  if (complete) {
    return NextResponse.json({ setupComplete: true });
  }

  // Rate limit GET to prevent enumeration
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`setup-get:${ip}`, SETUP_RATE_LIMIT)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Generate a fresh TOTP secret for enrollment
  const config = await getAuthConfig();
  const totpSecret = config?.totpSecret || generateTotpSecret();

  // Persist the secret so the same QR is shown on refresh
  if (!config?.totpSecret) {
    await saveAuthConfig({
      passwordHash: "",
      totpSecret,
      setupComplete: false,
    });
  }

  const uri = getTotpUri(totpSecret);

  // Return the otpauth URI + secret — client generates the QR code
  // (server-side QR libs require native canvas which fails on Vercel)
  return NextResponse.json({
    setupComplete: false,
    totpUri: uri,
    totpSecret,
  });
}

// POST — complete setup: hash password, verify TOTP, mark complete
export async function POST(req: Request) {
  const complete = await isSetupComplete();
  if (complete) {
    return NextResponse.json({ error: "Setup already complete" }, { status: 400 });
  }

  // Rate limit POST
  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!checkRateLimit(`setup-post:${ip}`, SETUP_RATE_LIMIT)) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  let body: { password?: string; totpToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { password, totpToken } = body;

  if (!password || typeof password !== "string") {
    return NextResponse.json({ error: "Password required" }, { status: 400 });
  }

  // M-1: Strong password validation
  const passwordError = validatePassword(password);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  if (!totpToken || typeof totpToken !== "string") {
    return NextResponse.json({ error: "TOTP code required" }, { status: 400 });
  }

  const config = await getAuthConfig();
  if (!config?.totpSecret) {
    return NextResponse.json({ error: "Visit setup page first" }, { status: 400 });
  }

  // Verify the TOTP token to prove the user has enrolled their authenticator
  if (!verifyTotp(totpToken, config.totpSecret)) {
    return NextResponse.json({ error: "Invalid TOTP code" }, { status: 400 });
  }

  const passwordHash = await hashPassword(password);

  await saveAuthConfig({
    passwordHash,
    totpSecret: config.totpSecret,
    setupComplete: true,
  });

  return NextResponse.json({ success: true });
}
