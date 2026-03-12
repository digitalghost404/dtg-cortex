"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/app/components/AuthProvider";
import GuestNav from "@/app/components/GuestNav";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AmbientCard {
  type: "quote" | "stat" | "connection" | "forgotten" | "tag_cloud" | "on_this_day";
  title: string;
  content: string;
  meta?: string;
}

type FadeState = "in" | "visible" | "out";

// ---------------------------------------------------------------------------
// Card renderers
// ---------------------------------------------------------------------------

function QuoteCard({ card }: { card: AmbientCard }) {
  return (
    <div className="ambient-card__inner ambient-card--quote">
      <p className="ambient-card__quote-text">{card.content}</p>
      {card.meta && (
        <p className="ambient-card__quote-source">
          <span className="ambient-card__quote-bracket">[[</span>
          {card.meta}
          <span className="ambient-card__quote-bracket">]]</span>
        </p>
      )}
    </div>
  );
}

function StatCard({ card }: { card: AmbientCard }) {
  return (
    <div className="ambient-card__inner ambient-card--stat">
      <p className="ambient-card__stat-label">{card.title}</p>
      <p className="ambient-card__stat-number">{card.content}</p>
      {card.meta && <p className="ambient-card__stat-meta">{card.meta}</p>}
    </div>
  );
}

function ConnectionCard({ card }: { card: AmbientCard }) {
  const parts = card.content.split(" → ");
  const from = parts[0] ?? card.content;
  const to = parts[1] ?? "";
  return (
    <div className="ambient-card__inner ambient-card--connection">
      <p className="ambient-card__connection-label">{card.title}</p>
      <div className="ambient-card__connection-nodes">
        <span className="ambient-card__connection-node">{from}</span>
        <div className="ambient-card__connection-line" aria-hidden="true">
          <span className="ambient-card__connection-arrow">→</span>
        </div>
        <span className="ambient-card__connection-node">{to}</span>
      </div>
      {card.meta && <p className="ambient-card__connection-meta">{card.meta}</p>}
    </div>
  );
}

function ForgottenCard({ card }: { card: AmbientCard }) {
  return (
    <div className="ambient-card__inner ambient-card--forgotten">
      <p className="ambient-card__forgotten-header">{card.title}</p>
      <p className="ambient-card__forgotten-excerpt">{card.content}</p>
      {card.meta && <p className="ambient-card__forgotten-meta">{card.meta}</p>}
    </div>
  );
}

function TagCloudCard({ card }: { card: AmbientCard }) {
  // content format: "tag:count tag:count ..."
  const entries = card.content
    .split(" ")
    .map((part) => {
      const idx = part.lastIndexOf(":");
      if (idx === -1) return { tag: part, count: 1 };
      return { tag: part.slice(0, idx), count: parseInt(part.slice(idx + 1), 10) || 1 };
    })
    .filter((e) => e.tag.length > 0);

  const maxCount = Math.max(...entries.map((e) => e.count), 1);

  return (
    <div className="ambient-card__inner ambient-card--tag-cloud">
      <p className="ambient-card__tag-label">{card.title}</p>
      <div className="ambient-card__tag-cloud">
        {entries.map((e) => {
          const scale = 0.7 + (e.count / maxCount) * 0.9;
          return (
            <span
              key={e.tag}
              className="ambient-card__tag"
              style={{ fontSize: `${scale}em`, opacity: 0.4 + (e.count / maxCount) * 0.6 }}
            >
              {e.tag}
              <span className="ambient-card__tag-count">{e.count}</span>
            </span>
          );
        })}
      </div>
      {card.meta && <p className="ambient-card__tag-meta">{card.meta}</p>}
    </div>
  );
}

function OnThisDayCard({ card }: { card: AmbientCard }) {
  const names = card.content.split(", ").filter(Boolean);
  return (
    <div className="ambient-card__inner ambient-card--on-this-day">
      <p className="ambient-card__otd-header">{card.title}</p>
      <ul className="ambient-card__otd-list">
        {names.map((name) => (
          <li key={name} className="ambient-card__otd-item">
            <span className="ambient-card__otd-bullet">◆</span>
            {name}
          </li>
        ))}
      </ul>
      {card.meta && <p className="ambient-card__otd-meta">{card.meta}</p>}
    </div>
  );
}

function renderCard(card: AmbientCard) {
  switch (card.type) {
    case "quote":       return <QuoteCard card={card} />;
    case "stat":        return <StatCard card={card} />;
    case "connection":  return <ConnectionCard card={card} />;
    case "forgotten":   return <ForgottenCard card={card} />;
    case "tag_cloud":   return <TagCloudCard card={card} />;
    case "on_this_day": return <OnThisDayCard card={card} />;
  }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const DISPLAY_DURATION_MS = 5000;
const FADE_DURATION_MS = 700;

export default function AmbientPage() {
  const { isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const [cards, setCards] = useState<AmbientCard[]>([]);
  const [cardIndex, setCardIndex] = useState(0);
  const [fadeState, setFadeState] = useState<FadeState>("in");
  const [progress, setProgress] = useState(0);
  const [exitHintVisible, setExitHintVisible] = useState(true);
  const [loading, setLoading] = useState(true);

  const cardsRef = useRef<AmbientCard[]>([]);
  const cardIndexRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cycleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  cardsRef.current = cards;
  cardIndexRef.current = cardIndex;

  // ------------------------------------------------------------------
  // Fetch a new batch of cards
  // ------------------------------------------------------------------

  const fetchCards = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ambient", { signal: controller.signal });
      if (!res.ok) return;
      const data = (await res.json()) as { cards: AmbientCard[] };
      if (data.cards && data.cards.length > 0) {
        setCards(data.cards);
        setCardIndex(0);
        setLoading(false);
      }
    } catch {
      // fetch aborted or failed — silently ignore
    }
  }, []);

  // ------------------------------------------------------------------
  // Fullscreen
  // ------------------------------------------------------------------

  useEffect(() => {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {
        // denied — continue without fullscreen
      });
    }
    return () => {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // ------------------------------------------------------------------
  // Exit hint fades after 3s
  // ------------------------------------------------------------------

  useEffect(() => {
    const t = setTimeout(() => setExitHintVisible(false), 3000);
    return () => clearTimeout(t);
  }, []);

  // ------------------------------------------------------------------
  // Escape / click to exit
  // ------------------------------------------------------------------

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        }
        router.push("/");
      }
    }
    function handleClick() {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
      router.push("/");
    }
    window.addEventListener("keydown", handleKey);
    window.addEventListener("click", handleClick);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("click", handleClick);
    };
  }, [router]);

  // ------------------------------------------------------------------
  // Initial fetch
  // ------------------------------------------------------------------

  useEffect(() => {
    fetchCards();
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, [fetchCards]);

  // ------------------------------------------------------------------
  // Card cycling
  // ------------------------------------------------------------------

  const startProgress = useCallback(() => {
    setProgress(0);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    const startTime = Date.now();
    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, (elapsed / DISPLAY_DURATION_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      }
    }, 50);
  }, []);

  const advanceCard = useCallback(() => {
    // Fade out
    setFadeState("out");

    setTimeout(() => {
      const currentCards = cardsRef.current;
      const currentIndex = cardIndexRef.current;
      const nextIndex = currentIndex + 1;

      if (nextIndex >= currentCards.length) {
        // Fetch a new batch and restart
        fetchCards().then(() => {
          setFadeState("in");
          startProgress();
        });
      } else {
        setCardIndex(nextIndex);
        setFadeState("in");
        startProgress();
      }
    }, FADE_DURATION_MS);
  }, [fetchCards, startProgress]);

  useEffect(() => {
    if (loading || cards.length === 0) return;

    setFadeState("in");
    startProgress();

    function scheduleCycle() {
      cycleTimeoutRef.current = setTimeout(() => {
        advanceCard();
        // After fade-out + new card load, reschedule
        const delay = DISPLAY_DURATION_MS + FADE_DURATION_MS * 2;
        cycleTimeoutRef.current = setTimeout(scheduleCycle, delay);
      }, DISPLAY_DURATION_MS);
    }

    scheduleCycle();

    return () => {
      if (cycleTimeoutRef.current) clearTimeout(cycleTimeoutRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, cards.length > 0]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const currentCard = cards[cardIndex] ?? null;

  return (
    <div className="ambient-bg" role="main" aria-label="Ambient Mode">

      {/* Corner label */}
      <div className="ambient-label" aria-hidden="true">
        <span className="ambient-label__dot" />
        AMBIENT MODE
      </div>

      {/* Top-right nav + auth */}
      <div
        style={{
          position: "fixed", top: "1rem", right: "1rem", zIndex: 50,
          display: "flex", alignItems: "center", gap: "0.5rem",
          fontFamily: "var(--font-geist-mono, monospace)",
          fontSize: "0.55rem", letterSpacing: "0.12em",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <GuestNav />
        {isAuthenticated ? (
          <button
            onClick={logout}
            style={{
              background: "transparent", border: "1px solid var(--border-dim)",
              borderRadius: "2px", padding: "3px 10px",
              color: "var(--text-muted)", cursor: "pointer",
              fontFamily: "inherit", fontSize: "inherit", letterSpacing: "inherit",
            }}
          >
            LOGOUT
          </button>
        ) : (
          <Link
            href="/login"
            style={{
              border: "1px solid var(--border-dim)",
              borderRadius: "2px", padding: "3px 10px",
              color: "var(--text-muted)", textDecoration: "none",
            }}
          >
            LOGIN
          </Link>
        )}
      </div>

      {/* Exit hint */}
      <div
        className={`ambient-exit-hint${exitHintVisible ? "" : " ambient-exit-hint--hidden"}`}
        aria-hidden="true"
      >
        CLICK OR PRESS ESC TO EXIT
      </div>

      {/* Card area */}
      <div className="ambient-stage">
        {loading && (
          <div className="ambient-loading" aria-live="polite">
            <div className="ambient-loading__bars">
              <span /><span /><span /><span /><span />
            </div>
            <p className="ambient-loading__text">LOADING VAULT DATA...</p>
          </div>
        )}

        {!loading && currentCard && (
          <div
            className={`ambient-card ambient-card--${fadeState}`}
            key={`${cardIndex}-${currentCard.type}`}
            aria-live="polite"
          >
            {renderCard(currentCard)}
          </div>
        )}
      </div>

      {/* Progress bar */}
      {!loading && (
        <div className="ambient-progress" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="ambient-progress__fill" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
