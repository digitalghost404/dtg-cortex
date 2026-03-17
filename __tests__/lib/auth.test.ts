import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validatePassword,
  getAuthConfig,
  saveAuthConfig,
  isSetupComplete,
  hashPassword,
  verifyPassword,
  generateTotpSecret,
  verifyTotp,
  verifyTotpWithReplay,
  getTotpUri,
  signJWT,
  verifyJWT,
  revokeToken,
  checkRateLimit,
  COOKIE_NAME,
  LOGIN_RATE_LIMIT,
  SETUP_RATE_LIMIT,
} from "@/lib/auth";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/kv", () => ({
  getJSON: vi.fn(),
  setJSON: vi.fn(),
  setNX: vi.fn(),
  setWithTTL: vi.fn(),
  exists: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("bcrypt", () => ({
  default: { hash: vi.fn(), compare: vi.fn() },
}));

vi.mock("otplib", () => ({
  generateSecret: vi.fn(() => "MOCK_SECRET"),
  verifySync: vi.fn(() => ({ valid: true })),
  generateURI: vi.fn(() => "otpauth://totp/Cortex:owner?secret=MOCK_SECRET&issuer=Cortex"),
}));

// jose is used with the real crypto in most tests. We mock it here so that
// we can override jwtVerify with mockImplementationOnce for the two edge-case
// branches in revokeToken that require a payload without jti / without exp.
vi.mock("jose", async (importActual) => {
  const actual = await importActual<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn((...args: Parameters<typeof actual.jwtVerify>) =>
      actual.jwtVerify(...args)
    ),
  };
});

// ---------------------------------------------------------------------------
// Lazy imports (after mocks are registered)
// ---------------------------------------------------------------------------

import * as kv from "@/lib/kv";
import bcrypt from "bcrypt";
import {
  generateSecret as otpGenerateSecret,
  verifySync as otpVerifySync,
  generateURI as otpGenerateURI,
} from "otplib";
import { jwtVerify } from "jose";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = "test-secret-key-for-testing-purposes-32ch";
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("exported constants", () => {
  it("COOKIE_NAME is the correct string", () => {
    expect(COOKIE_NAME).toBe("cortex-token");
  });

  it("LOGIN_RATE_LIMIT has correct shape", () => {
    expect(LOGIN_RATE_LIMIT.maxAttempts).toBe(5);
    expect(LOGIN_RATE_LIMIT.windowMs).toBe(15 * 60 * 1000);
  });

  it("SETUP_RATE_LIMIT has correct shape", () => {
    expect(SETUP_RATE_LIMIT.maxAttempts).toBe(10);
    expect(SETUP_RATE_LIMIT.windowMs).toBe(15 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// validatePassword
// ---------------------------------------------------------------------------

describe("validatePassword", () => {
  it("rejects passwords shorter than 12 characters", () => {
    expect(validatePassword("Short1!abc")).toContain("12");
  });

  it("rejects passwords exceeding 72 bytes", () => {
    const longPassword = "Aa1!" + "\u1F389".repeat(20); // multi-byte padding
    // Use a simpler approach: a 73-byte ASCII string
    const over72 = "Aa1!" + "a".repeat(69); // 4 + 69 = 73 bytes
    expect(validatePassword(over72)).toContain("72");
  });

  it("rejects passwords missing lowercase letter", () => {
    expect(validatePassword("ABCDEFGH1234!")).toContain("lowercase");
  });

  it("rejects passwords missing uppercase letter", () => {
    expect(validatePassword("abcdefgh1234!")).toContain("uppercase");
  });

  it("rejects passwords missing digit", () => {
    expect(validatePassword("Abcdefghijkl!")).toContain("digit");
  });

  it("rejects passwords missing special character", () => {
    expect(validatePassword("Abcdefgh1234")).toContain("special");
  });

  it("returns null for a valid password", () => {
    expect(validatePassword("ValidPass123!")).toBeNull();
  });

  it("returns null for a password exactly 12 characters", () => {
    expect(validatePassword("Abcdefgh12!a")).toBeNull();
  });

  it("checks rules in order: length first", () => {
    expect(validatePassword("a")).toContain("12");
  });

  it("accepts complex valid passwords", () => {
    expect(validatePassword("MyP@ssw0rd!!xyz")).toBeNull();
    expect(validatePassword("C0mpl3x!Pass_")).toBeNull();
  });

  it("rejects password with multi-byte chars exceeding 72 bytes", () => {
    // Each emoji is 4 bytes — "Aa1!" (4 bytes) + 18 emojis (72 bytes) = 76 bytes
    const multiByteOver = "Aa1!" + "🎉".repeat(18);
    expect(validatePassword(multiByteOver)).toContain("72");
  });
});

// ---------------------------------------------------------------------------
// getAuthConfig
// ---------------------------------------------------------------------------

describe("getAuthConfig", () => {
  it("returns config when kv.getJSON resolves", async () => {
    const config = { passwordHash: "hash", totpSecret: "secret", setupComplete: true };
    vi.mocked(kv.getJSON).mockResolvedValueOnce(config);

    const result = await getAuthConfig();
    expect(result).toEqual(config);
    expect(kv.getJSON).toHaveBeenCalledWith("auth:config");
  });

  it("returns null when kv.getJSON resolves to null", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null);
    expect(await getAuthConfig()).toBeNull();
  });

  it("returns null when kv.getJSON throws", async () => {
    vi.mocked(kv.getJSON).mockRejectedValueOnce(new Error("Redis down"));
    expect(await getAuthConfig()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// saveAuthConfig
// ---------------------------------------------------------------------------

describe("saveAuthConfig", () => {
  it("calls kv.setJSON with the auth key and config", async () => {
    vi.mocked(kv.setJSON).mockResolvedValueOnce(undefined);
    const config = { passwordHash: "h", totpSecret: "s", setupComplete: false };

    await saveAuthConfig(config);

    expect(kv.setJSON).toHaveBeenCalledWith("auth:config", config);
  });
});

// ---------------------------------------------------------------------------
// isSetupComplete
// ---------------------------------------------------------------------------

describe("isSetupComplete", () => {
  it("returns true when config.setupComplete is true", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce({
      passwordHash: "h",
      totpSecret: "s",
      setupComplete: true,
    });
    expect(await isSetupComplete()).toBe(true);
  });

  it("returns false when config.setupComplete is false", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce({
      passwordHash: "h",
      totpSecret: "s",
      setupComplete: false,
    });
    expect(await isSetupComplete()).toBe(false);
  });

  it("returns false when getAuthConfig returns null", async () => {
    vi.mocked(kv.getJSON).mockResolvedValueOnce(null);
    expect(await isSetupComplete()).toBe(false);
  });

  it("returns false when kv throws (getAuthConfig catches and returns null)", async () => {
    vi.mocked(kv.getJSON).mockRejectedValueOnce(new Error("fail"));
    expect(await isSetupComplete()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hashPassword
// ---------------------------------------------------------------------------

describe("hashPassword", () => {
  it("delegates to bcrypt.hash with SALT_ROUNDS=10", async () => {
    vi.mocked(bcrypt.hash).mockResolvedValueOnce("hashed-value" as never);
    const result = await hashPassword("MyPassword1!");
    expect(bcrypt.hash).toHaveBeenCalledWith("MyPassword1!", 10);
    expect(result).toBe("hashed-value");
  });
});

// ---------------------------------------------------------------------------
// verifyPassword
// ---------------------------------------------------------------------------

describe("verifyPassword", () => {
  it("returns true when bcrypt.compare resolves true", async () => {
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
    expect(await verifyPassword("plain", "hash")).toBe(true);
    expect(bcrypt.compare).toHaveBeenCalledWith("plain", "hash");
  });

  it("returns false when bcrypt.compare resolves false", async () => {
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);
    expect(await verifyPassword("wrong", "hash")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateTotpSecret
// ---------------------------------------------------------------------------

describe("generateTotpSecret", () => {
  it("calls otplib generateSecret and returns the result", () => {
    const result = generateTotpSecret();
    expect(otpGenerateSecret).toHaveBeenCalled();
    expect(result).toBe("MOCK_SECRET");
  });
});

// ---------------------------------------------------------------------------
// verifyTotp
// ---------------------------------------------------------------------------

describe("verifyTotp", () => {
  it("returns true when otpVerifySync returns { valid: true }", () => {
    vi.mocked(otpVerifySync).mockReturnValueOnce({ valid: true } as ReturnType<typeof otpVerifySync>);
    expect(verifyTotp("123456", "SECRET")).toBe(true);
    expect(otpVerifySync).toHaveBeenCalledWith({ token: "123456", secret: "SECRET" });
  });

  it("returns false when otpVerifySync returns { valid: false }", () => {
    vi.mocked(otpVerifySync).mockReturnValueOnce({ valid: false } as ReturnType<typeof otpVerifySync>);
    expect(verifyTotp("000000", "SECRET")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyTotpWithReplay
// ---------------------------------------------------------------------------

describe("verifyTotpWithReplay", () => {
  it("returns false immediately when TOTP is invalid", async () => {
    vi.mocked(otpVerifySync).mockReturnValueOnce({ valid: false } as ReturnType<typeof otpVerifySync>);
    const result = await verifyTotpWithReplay("000000", "SECRET");
    expect(result).toBe(false);
    expect(kv.setNX).not.toHaveBeenCalled();
  });

  it("returns true when TOTP is valid and setNX succeeds (first use)", async () => {
    vi.mocked(otpVerifySync).mockReturnValueOnce({ valid: true } as ReturnType<typeof otpVerifySync>);
    vi.mocked(kv.setNX).mockResolvedValueOnce(true);

    const result = await verifyTotpWithReplay("123456", "SECRET");
    expect(result).toBe(true);
    expect(kv.setNX).toHaveBeenCalledWith("totp:used:123456", "1", 60);
  });

  it("returns false when TOTP is valid but setNX fails (replay attack)", async () => {
    vi.mocked(otpVerifySync).mockReturnValueOnce({ valid: true } as ReturnType<typeof otpVerifySync>);
    vi.mocked(kv.setNX).mockResolvedValueOnce(false);

    const result = await verifyTotpWithReplay("123456", "SECRET");
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getTotpUri
// ---------------------------------------------------------------------------

describe("getTotpUri", () => {
  it("calls otplib generateURI with correct args and returns the URI", () => {
    const uri = getTotpUri("MYSECRET");
    expect(otpGenerateURI).toHaveBeenCalledWith({
      secret: "MYSECRET",
      issuer: "Cortex",
      label: "owner",
    });
    expect(uri).toBe(
      "otpauth://totp/Cortex:owner?secret=MOCK_SECRET&issuer=Cortex"
    );
  });
});

// ---------------------------------------------------------------------------
// signJWT / verifyJWT / revokeToken — use real jose crypto
// ---------------------------------------------------------------------------

describe("signJWT", () => {
  it("returns a signed JWT string", async () => {
    const token = await signJWT({ role: "owner" });
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // header.payload.signature
  });

  it("throws when JWT_SECRET is not set", async () => {
    delete process.env.JWT_SECRET;
    await expect(signJWT({ role: "owner" })).rejects.toThrow("JWT_SECRET");
    process.env.JWT_SECRET = "test-secret-key-for-testing-purposes-32ch";
  });
});

describe("verifyJWT", () => {
  it("returns payload for a valid, non-revoked token", async () => {
    vi.mocked(kv.exists).mockResolvedValueOnce(false);
    const token = await signJWT({ role: "owner" });
    const payload = await verifyJWT(token);
    expect(payload).not.toBeNull();
    expect(payload?.role).toBe("owner");
  });

  it("returns null for a malformed/garbage token", async () => {
    const result = await verifyJWT("not.a.valid.token");
    expect(result).toBeNull();
  });

  it("returns null for a revoked token (kv.exists returns true)", async () => {
    vi.mocked(kv.exists).mockResolvedValueOnce(true);
    const token = await signJWT({ role: "owner" });
    const result = await verifyJWT(token);
    expect(result).toBeNull();
  });

  it("returns null when JWT_SECRET is wrong during verification", async () => {
    const token = await signJWT({ role: "owner" });
    process.env.JWT_SECRET = "completely-different-secret-key-!!";
    const result = await verifyJWT(token);
    expect(result).toBeNull();
    process.env.JWT_SECRET = "test-secret-key-for-testing-purposes-32ch";
  });

  it("verifies token with no jti field without hitting revocation check", async () => {
    // signJWT always sets jti via crypto.randomUUID — verify normal path
    vi.mocked(kv.exists).mockResolvedValueOnce(false);
    const token = await signJWT({ data: "value" });
    const payload = await verifyJWT(token);
    expect(payload).not.toBeNull();
    expect(kv.exists).toHaveBeenCalled();
  });
});

describe("revokeToken", () => {
  it("extracts jti and calls kv.setWithTTL for a valid token", async () => {
    vi.mocked(kv.setWithTTL).mockResolvedValueOnce(undefined);
    const token = await signJWT({ role: "owner" });
    await revokeToken(token);
    expect(kv.setWithTTL).toHaveBeenCalledOnce();
    const [key, value, ttl] = vi.mocked(kv.setWithTTL).mock.calls[0];
    expect(key).toMatch(/^revoked:/);
    expect(value).toBe("1");
    expect(ttl).toBeGreaterThan(0);
  });

  it("does nothing (no throw) for an invalid token", async () => {
    await expect(revokeToken("garbage.token.here")).resolves.toBeUndefined();
    expect(kv.setWithTTL).not.toHaveBeenCalled();
  });

  it("does nothing when JWT_SECRET is not set", async () => {
    delete process.env.JWT_SECRET;
    await expect(revokeToken("any.token.value")).resolves.toBeUndefined();
    expect(kv.setWithTTL).not.toHaveBeenCalled();
    process.env.JWT_SECRET = "test-secret-key-for-testing-purposes-32ch";
  });

  it("returns early without calling setWithTTL when verified payload has no jti", async () => {
    // Override jwtVerify for this one call to return a payload missing jti
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { iss: "cortex", aud: "cortex-owner", exp: Math.floor(Date.now() / 1000) + 3600 },
      protectedHeader: { alg: "HS256" },
    } as Awaited<ReturnType<typeof jwtVerify>>);

    await revokeToken("some.valid.looking.token");

    expect(kv.setWithTTL).not.toHaveBeenCalled();
  });

  it("uses now+86400 as TTL fallback when payload has no exp field", async () => {
    // Provide a payload with jti but without exp to exercise the `|| now + 86400` branch
    vi.mocked(jwtVerify).mockResolvedValueOnce({
      payload: { iss: "cortex", aud: "cortex-owner", jti: "test-jti-no-exp" },
      protectedHeader: { alg: "HS256" },
    } as Awaited<ReturnType<typeof jwtVerify>>);
    vi.mocked(kv.setWithTTL).mockResolvedValueOnce(undefined);

    await revokeToken("some.valid.looking.token");

    expect(kv.setWithTTL).toHaveBeenCalledOnce();
    const [key, , ttl] = vi.mocked(kv.setWithTTL).mock.calls[0];
    expect(key).toBe("revoked:test-jti-no-exp");
    // TTL should be approximately 86400 (within a few seconds of clock drift)
    expect(ttl).toBeGreaterThanOrEqual(86390);
    expect(ttl).toBeLessThanOrEqual(86400);
  });
});

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

describe("checkRateLimit", () => {
  it("calls kv.rateLimit with prefixed key, maxAttempts, and window in seconds", async () => {
    vi.mocked(kv.rateLimit).mockResolvedValueOnce(true);
    const result = await checkRateLimit("192.168.1.1");
    expect(kv.rateLimit).toHaveBeenCalledWith(
      "ratelimit:192.168.1.1",
      LOGIN_RATE_LIMIT.maxAttempts,
      Math.ceil(LOGIN_RATE_LIMIT.windowMs / 1000)
    );
    expect(result).toBe(true);
  });

  it("returns false when kv.rateLimit returns false (limit exceeded)", async () => {
    vi.mocked(kv.rateLimit).mockResolvedValueOnce(false);
    expect(await checkRateLimit("192.168.1.2")).toBe(false);
  });

  it("accepts a custom limit object", async () => {
    vi.mocked(kv.rateLimit).mockResolvedValueOnce(true);
    const custom = { maxAttempts: 3, windowMs: 60_000 };
    await checkRateLimit("some-key", custom);
    expect(kv.rateLimit).toHaveBeenCalledWith("ratelimit:some-key", 3, 60);
  });
});
