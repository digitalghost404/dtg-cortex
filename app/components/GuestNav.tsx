"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthProvider";

const PUBLIC_LINKS = [
  { href: "/vault", label: "VAULT", icon: "\u25A3" },
  { href: "/tags", label: "TAGS", icon: "\u2606" },
  { href: "/discover", label: "DISCOVER", icon: "\u2740" },
];

export default function GuestNav() {
  const { isAuthenticated } = useAuth();
  const pathname = usePathname();

  // Authenticated users navigate via the main chat page header — don't show this
  if (isAuthenticated) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
      {PUBLIC_LINKS.map(({ href, label, icon }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className="btn-secondary"
            style={{
              fontFamily: "var(--font-geist-mono, monospace)",
              fontSize: "0.55rem",
              letterSpacing: "0.1em",
              padding: "3px 8px",
              borderRadius: "2px",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
              color: active ? "var(--cyan-bright)" : undefined,
              borderColor: active ? "var(--border-mid)" : undefined,
            }}
          >
            <span style={{ fontSize: "0.5rem", opacity: 0.7 }}>{icon}</span>
            {label}
          </Link>
        );
      })}
    </div>
  );
}
