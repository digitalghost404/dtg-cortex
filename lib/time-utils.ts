/**
 * Shared time-formatting utilities used across UI pages and components.
 *
 * This file must remain free of React/Next.js dependencies so it can be
 * imported from both server and client modules.
 */

/**
 * Convert an ISO date string into a human-readable relative time label.
 *
 * Examples:
 *   < 1 minute  → "just now"
 *   < 1 hour    → "5m ago"
 *   < 24 hours  → "3h ago"
 *   1 day       → "yesterday"
 *   < 7 days    → "4d ago"
 *   otherwise   → locale date string (e.g. "3/15/2026")
 */
export function relativeTime(isoStr: string, compact = false): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return compact ? "now" : "just now";
  if (mins < 60) return compact ? `${mins}m` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return compact ? `${hrs}h` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return compact ? "1d" : "yesterday";
  if (days < 7) return compact ? `${days}d` : `${days}d ago`;
  return compact ? `${days}d` : new Date(isoStr).toLocaleDateString();
}
