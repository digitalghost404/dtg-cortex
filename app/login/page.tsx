"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../components/AuthProvider";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [step, setStep] = useState<"password" | "totp">("password");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingSetup, setCheckingSetup] = useState(true);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.setupComplete) {
          router.replace("/setup");
        } else if (data.authenticated) {
          router.replace("/");
        } else {
          setCheckingSetup(false);
        }
      })
      .catch(() => setCheckingSetup(false));
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (step === "password") {
      if (!password) return;
      setStep("totp");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, totpToken }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
        // Always reset to step 1 on any failure — no error-based branching (M-7)
        setStep("password");
        setPassword("");
        setTotpToken("");
      } else {
        await refresh();
        router.replace("/");
      }
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (checkingSetup) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "var(--bg-void)",
        fontFamily: "var(--font-geist-mono, monospace)",
        color: "var(--text-muted)", fontSize: "0.7rem", letterSpacing: "0.15em",
      }}>
        INITIALIZING...
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100vh", background: "var(--bg-void)", padding: "1rem",
    }}>
      {/* Title */}
      <div style={{ marginBottom: "2.5rem", textAlign: "center" }}>
        <h1 style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "1.1rem", fontWeight: 700, letterSpacing: "0.35em",
          color: "var(--cyan-bright)",
          textShadow: "0 0 12px rgba(34,211,238,0.4), 0 0 40px rgba(34,211,238,0.15)",
          margin: 0,
        }}>
          CORTEX
        </h1>
        <p style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.55rem", letterSpacing: "0.2em",
          color: "var(--text-muted)", marginTop: "0.5rem",
        }}>
          AUTHENTICATION REQUIRED
        </p>
      </div>

      {/* Login card */}
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%", maxWidth: "360px",
          border: "1px solid var(--border-dim)",
          background: "var(--bg-deep)",
          padding: "2rem 1.75rem",
          borderRadius: "2px",
          boxShadow: "0 0 40px rgba(34,211,238,0.05)",
        }}
      >
        <div style={{
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.6rem", letterSpacing: "0.15em",
          color: "var(--text-muted)", marginBottom: "1.5rem",
          borderBottom: "1px solid var(--border-dim)",
          paddingBottom: "0.75rem",
        }}>
          {step === "password" ? "STEP 1 / 2 \u2014 PASSWORD" : "STEP 2 / 2 \u2014 MFA CODE"}
        </div>

        {step === "password" ? (
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter password"
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
            }}
          />
        ) : (
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={totpToken}
            onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ""))}
            placeholder="6-digit code"
            autoFocus
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
          disabled={loading}
          style={{
            width: "100%", marginTop: "1.25rem",
            padding: "0.6rem",
            background: "transparent",
            border: "1px solid var(--border-mid)",
            borderRadius: "2px",
            color: "var(--cyan-bright)",
            fontFamily: "var(--font-geist-mono, monospace)",
            fontSize: "0.65rem", letterSpacing: "0.15em",
            cursor: loading ? "wait" : "pointer",
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
          {loading ? "AUTHENTICATING..." : step === "password" ? "CONTINUE" : "LOGIN"}
        </button>

        {step === "totp" && (
          <button
            type="button"
            onClick={() => { setStep("password"); setError(""); setTotpToken(""); }}
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
            BACK
          </button>
        )}
      </form>

      {/* Guest mode link */}
      <Link
        href="/vault"
        style={{
          marginTop: "1.5rem",
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.6rem", letterSpacing: "0.15em",
          color: "var(--text-muted)",
          textDecoration: "none",
          padding: "0.4rem 1rem",
          border: "1px solid var(--border-dim)",
          borderRadius: "2px",
          transition: "all 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--cyan-bright)";
          e.currentTarget.style.borderColor = "var(--border-mid)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--text-muted)";
          e.currentTarget.style.borderColor = "var(--border-dim)";
        }}
      >
        EXPLORE AS GUEST
      </Link>
    </div>
  );
}
