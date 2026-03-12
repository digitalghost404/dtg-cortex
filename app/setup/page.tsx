"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";

export default function SetupPage() {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [step, setStep] = useState<"enroll" | "credentials">("enroll");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [qrError, setQrError] = useState(false);

  useEffect(() => {
    fetch("/api/auth/setup")
      .then((r) => r.json())
      .then((data) => {
        if (data.setupComplete) {
          router.replace("/login");
          return;
        }
        setTotpSecret(data.totpSecret || "");
        setTotpUri(data.totpUri || "");
        // Generate QR code client-side using browser Canvas API
        if (data.totpUri && canvasRef.current) {
          QRCode.toCanvas(canvasRef.current, data.totpUri, {
            width: 200,
            margin: 2,
            color: { dark: "#22d3ee", light: "#050d14" },
          }).catch(() => setQrError(true));
        }
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load setup data");
        setLoading(false);
      });
  }, [router]);

  // Re-render QR when canvas becomes available (initial render has null ref)
  useEffect(() => {
    if (!loading && canvasRef.current && totpUri && step === "enroll") {
      QRCode.toCanvas(canvasRef.current, totpUri, {
        width: 200,
        margin: 2,
        color: { dark: "#22d3ee", light: "#050d14" },
      }).catch(() => setQrError(true));
    }
  }, [loading, totpUri, step]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (step === "enroll") {
      setStep("credentials");
      return;
    }

    if (password.length < 12) {
      setError("Password must be at least 12 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (totpToken.length !== 6) {
      setError("Enter a 6-digit code from your authenticator");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, totpToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Setup failed");
      } else {
        router.replace("/login");
      }
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "var(--bg-void)",
        fontFamily: "var(--font-geist-mono, monospace)",
        color: "var(--text-muted)", fontSize: "0.7rem", letterSpacing: "0.15em",
      }}>
        INITIALIZING SETUP...
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: "var(--bg-void)", padding: "1rem",
      overflowY: "auto",
    }}>
      {/* Title */}
      <div style={{ marginBottom: "2rem", textAlign: "center" }}>
        <h1 style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "1.1rem", fontWeight: 700, letterSpacing: "0.35em",
          color: "var(--cyan-bright)",
          textShadow: "0 0 12px rgba(34,211,238,0.4), 0 0 40px rgba(34,211,238,0.15)",
          margin: 0,
        }}>
          CORTEX SETUP
        </h1>
        <p style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.55rem", letterSpacing: "0.2em",
          color: "var(--text-muted)", marginTop: "0.5rem",
        }}>
          OWNER ENROLLMENT
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%", maxWidth: "400px",
          border: "1px solid var(--border-dim)",
          background: "var(--bg-deep)",
          padding: "2rem 1.75rem",
          borderRadius: "2px",
          boxShadow: "0 0 40px rgba(34,211,238,0.05)",
        }}
      >
        {step === "enroll" ? (
          <>
            <div style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.6rem", letterSpacing: "0.15em",
              color: "var(--text-muted)", marginBottom: "1.25rem",
              borderBottom: "1px solid var(--border-dim)",
              paddingBottom: "0.75rem",
            }}>
              STEP 1 / 2 — ADD TO AUTHENTICATOR APP
            </div>

            {/* QR Code (client-side canvas) */}
            {!qrError && (
              <div style={{ textAlign: "center", marginBottom: "1rem" }}>
                <canvas
                  ref={canvasRef}
                  style={{
                    borderRadius: "4px",
                    border: "1px solid var(--border-dim)",
                  }}
                />
              </div>
            )}

            {/* Toggle manual entry */}
            <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
              <button
                type="button"
                onClick={() => setShowManual(!showManual)}
                style={{
                  background: "transparent",
                  border: "none",
                  fontFamily: "var(--font-geist-mono, monospace)",
                  fontSize: "0.5rem",
                  letterSpacing: "0.1em",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textDecoration: "underline",
                  textDecorationColor: "var(--border-dim)",
                  textUnderlineOffset: "3px",
                  padding: "0.25rem",
                }}
              >
                {showManual ? "HIDE MANUAL KEY" : (qrError ? "SHOW MANUAL KEY" : "CAN'T SCAN? ENTER KEY MANUALLY")}
              </button>

              {showManual && totpSecret && (
                <div
                  onClick={() => {
                    navigator.clipboard.writeText(totpSecret);
                  }}
                  title="Click to copy"
                  style={{
                    fontFamily: "var(--font-geist-mono, monospace)",
                    fontSize: "0.65rem",
                    letterSpacing: "0.15em",
                    color: "var(--text-secondary)",
                    textAlign: "center",
                    padding: "0.6rem",
                    marginTop: "0.75rem",
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border-dim)",
                    borderRadius: "2px",
                    wordBreak: "break-all",
                    cursor: "pointer",
                    transition: "border-color 0.15s",
                  }}
                >
                  {totpSecret}
                  <div style={{
                    fontSize: "0.45rem",
                    color: "var(--text-faint)",
                    marginTop: "0.4rem",
                    letterSpacing: "0.08em",
                  }}>
                    CLICK TO COPY — ENTER AS MANUAL KEY IN YOUR AUTHENTICATOR
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.6rem", letterSpacing: "0.15em",
              color: "var(--text-muted)", marginBottom: "1.25rem",
              borderBottom: "1px solid var(--border-dim)",
              paddingBottom: "0.75rem",
            }}>
              STEP 2 / 2 — SET PASSWORD & VERIFY MFA
            </div>

            <label style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.5rem", letterSpacing: "0.12em",
              color: "var(--text-muted)", display: "block",
              marginBottom: "0.35rem",
            }}>
              PASSWORD (MIN 12 CHARS, UPPER + LOWER + DIGIT + SPECIAL)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              style={{
                width: "100%", padding: "0.6rem 0.75rem",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-dim)",
                borderRadius: "2px",
                color: "var(--text-primary)",
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.75rem",
                outline: "none",
                marginBottom: "1rem",
              }}
            />

            <label style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.5rem", letterSpacing: "0.12em",
              color: "var(--text-muted)", display: "block",
              marginBottom: "0.35rem",
            }}>
              CONFIRM PASSWORD
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={{
                width: "100%", padding: "0.6rem 0.75rem",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-dim)",
                borderRadius: "2px",
                color: "var(--text-primary)",
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.75rem",
                outline: "none",
                marginBottom: "1rem",
              }}
            />

            <label style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.5rem", letterSpacing: "0.12em",
              color: "var(--text-muted)", display: "block",
              marginBottom: "0.35rem",
            }}>
              AUTHENTICATOR CODE
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={totpToken}
              onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
              placeholder="6-digit code"
              style={{
                width: "100%", padding: "0.6rem 0.75rem",
                background: "var(--bg-surface)",
                border: "1px solid var(--border-dim)",
                borderRadius: "2px",
                color: "var(--text-primary)",
                fontFamily: "var(--font-geist-mono, monospace)",
                fontSize: "0.75rem", letterSpacing: "0.3em",
                textAlign: "center",
                outline: "none",
              }}
            />
          </>
        )}

        {error && (
          <p style={{
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.6rem", color: "#f87171",
            marginTop: "0.75rem", marginBottom: 0,
          }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%", marginTop: "1.25rem",
            padding: "0.6rem",
            background: "transparent",
            border: "1px solid var(--border-mid)",
            borderRadius: "2px",
            color: "var(--cyan-bright)",
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.65rem", letterSpacing: "0.15em",
            cursor: submitting ? "wait" : "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "var(--border-bright)";
            e.currentTarget.style.boxShadow = "var(--shadow-glow-sm)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "var(--border-mid)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          {submitting
            ? "COMPLETING SETUP..."
            : step === "enroll"
            ? "CONTINUE"
            : "COMPLETE SETUP"}
        </button>

        {step === "credentials" && (
          <button
            type="button"
            onClick={() => { setStep("enroll"); setError(""); }}
            style={{
              width: "100%", marginTop: "0.5rem",
              padding: "0.5rem",
              background: "transparent",
              border: "1px solid var(--border-dim)",
              borderRadius: "2px",
              color: "var(--text-muted)",
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.55rem", letterSpacing: "0.12em",
              cursor: "pointer",
            }}
          >
            BACK TO QR CODE
          </button>
        )}
      </form>
    </div>
  );
}
