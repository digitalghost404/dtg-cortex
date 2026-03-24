import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "cortex-token";
const REVOKE_CHECK_COOKIE = "cortex-rc";
const REVOKE_CHECK_INTERVAL_SEC = 300; // 5 minutes

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return new TextEncoder().encode(secret);
}

// ---------------------------------------------------------------------------
// Redis revocation check (Edge-compatible via Upstash REST)
// ---------------------------------------------------------------------------

async function isTokenRevoked(jti: string): Promise<boolean> {
  const redisUrl = process.env.KV_REST_API_URL;
  const redisToken = process.env.KV_REST_API_TOKEN;
  if (!redisUrl || !redisToken) return false; // No Redis = local dev, skip revocation

  try {
    const res = await fetch(`${redisUrl}/exists/revoked:${encodeURIComponent(jti)}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { result: number };
    return data.result === 1;
  } catch {
    // If Redis is unreachable, fail closed (deny access)
    return true;
  }
}

async function isAuthenticated(
  req: NextRequest
): Promise<{ authed: boolean; didRevocationCheck: boolean }> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return { authed: false, didRevocationCheck: false };
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "cortex",
      audience: "cortex-owner",
    });

    // Skip revocation check if we verified recently (cached via cookie)
    const recentlyChecked = !!req.cookies.get(REVOKE_CHECK_COOKIE)?.value;
    if (!recentlyChecked && payload.jti && (await isTokenRevoked(payload.jti))) {
      return { authed: false, didRevocationCheck: true };
    }

    return { authed: !!payload, didRevocationCheck: !recentlyChecked };
  } catch {
    return { authed: false, didRevocationCheck: false };
  }
}

// ---------------------------------------------------------------------------
// Route classification
// ---------------------------------------------------------------------------

// Pages that guests can view (read-only, zero API cost, no private content)
const PUBLIC_PAGES = ["/", "/vault", "/tags", "/discover", "/share"];

// API routes that guests can call (metadata only, no private note content)
const PUBLIC_API_EXACT = [
  "/api/vault",
  "/api/vault-dna",
  "/api/chat/guest",
  "/api/tags",
  "/api/random-note",
  "/api/note",
];

// Auth routes — always accessible
const AUTH_PREFIXES = ["/login", "/setup", "/api/auth"];

// Precise static asset extension list (M-4)
const STATIC_ASSET_RE = /\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|css|js|map|json|txt|xml|webmanifest)$/i;

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function isPublicApi(pathname: string): boolean {
  if (PUBLIC_API_EXACT.includes(pathname)) return true;
  // Public share endpoint: GET /api/share/{token}
  if (/^\/api\/share\/[^/]+$/.test(pathname)) return true;
  return false;
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

// ---------------------------------------------------------------------------
// Security headers (H-4)
// ---------------------------------------------------------------------------

function addSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  return res;
}

// ---------------------------------------------------------------------------
// CSRF origin check (M-3)
// ---------------------------------------------------------------------------

function isOriginAllowed(req: NextRequest): boolean {
  const method = req.method;
  // Only check mutating methods
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = req.headers.get("origin");
  const host = req.headers.get("host");

  // Requests without Origin header are allowed — SameSite=Strict cookie
  // attribute is the primary CSRF defense. The Origin check is defense-in-depth.
  if (!origin) return true;

  try {
    const originHost = new URL(origin).host;
    return originHost === host;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip Next.js internals and static assets
  if (
    pathname.startsWith("/_next/static") ||
    pathname.startsWith("/_next/image") ||
    pathname === "/favicon.ico" ||
    STATIC_ASSET_RE.test(pathname)
  ) {
    return NextResponse.next();
  }

  // CSRF origin check on all mutating requests (M-3)
  if (!isOriginAllowed(req)) {
    return addSecurityHeaders(
      NextResponse.json({ error: "Forbidden" }, { status: 403 })
    );
  }

  // Cron-secret bypass for automated jobs
  const CRON_API_PATHS = ["/api/sync"];
  if (CRON_API_PATHS.includes(pathname) && req.method === "POST") {
    const cronSecret = req.headers.get("x-cron-secret");
    const expected = process.env.CRON_SECRET;
    if (cronSecret && expected && cronSecret === expected) {
      return addSecurityHeaders(NextResponse.next());
    }
  }

  // Auth routes are always accessible
  if (isAuthRoute(pathname)) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Public pages and APIs are accessible to everyone
  if (isPublicPage(pathname) || isPublicApi(pathname)) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Everything else requires authentication
  const { authed, didRevocationCheck } = await isAuthenticated(req);

  if (!authed) {
    // API routes return 401
    if (pathname.startsWith("/api/")) {
      return addSecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 })
      );
    }

    // Pages redirect to /login
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    return addSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  const res = addSecurityHeaders(NextResponse.next());

  // Cache successful revocation check so we skip Redis for the next 5 minutes
  if (didRevocationCheck) {
    res.cookies.set(REVOKE_CHECK_COOKIE, "1", {
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: REVOKE_CHECK_INTERVAL_SEC,
      path: "/",
    });
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
