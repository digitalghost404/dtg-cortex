import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const COOKIE_NAME = "cortex-token";

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is not set");
  return new TextEncoder().encode(secret);
}

async function isAuthenticated(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      issuer: "cortex",
      audience: "cortex-owner",
    });
    // Note: jti revocation check can't hit fs in Edge middleware,
    // but the route-level verifyJWT() does check it as defense-in-depth
    return !!payload;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Route classification
// ---------------------------------------------------------------------------

// Pages that guests can view (read-only, zero API cost)
const PUBLIC_PAGES = ["/graph", "/vault", "/clusters", "/ambient"];

// API routes that guests can call (read-only data, no LLM/embedding calls)
// C-4 fix: exact paths only — no broad prefixes that match mutating sub-routes
const PUBLIC_API_EXACT = [
  "/api/index/status",
  "/api/graph",
  "/api/clusters",
  "/api/vault",
  "/api/vault-dna",
  "/api/ambient",
  "/api/note",
  "/api/search",
  "/api/links",
];

// Auth routes — always accessible
const AUTH_PREFIXES = ["/login", "/setup", "/api/auth"];

// M-4 fix: precise static asset extension list instead of broad pathname.includes(".")
const STATIC_ASSET_RE = /\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|css|js|map|json|txt|xml|webmanifest)$/i;

function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

function isPublicApi(pathname: string): boolean {
  // Only exact matches — no startsWith prefix matching
  return PUBLIC_API_EXACT.includes(pathname);
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
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("X-DNS-Prefetch-Control", "off");
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

  // If no origin header (same-origin requests from some browsers), allow
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

  // Skip Next.js internals and static assets (M-4: precise extension matching)
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

  // Auth routes are always accessible
  if (isAuthRoute(pathname)) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Public pages and APIs are accessible to everyone
  if (isPublicPage(pathname) || isPublicApi(pathname)) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Everything else requires authentication
  const authed = await isAuthenticated(req);

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

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
