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
export function relativeTime(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(isoStr).toLocaleDateString();
}
