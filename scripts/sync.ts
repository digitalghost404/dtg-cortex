#!/usr/bin/env npx tsx
/**
 * Vault Sync Script (Bidirectional)
 *
 * Reads the local Obsidian vault, computes MD5 hashes for incremental sync,
 * and pushes note content to Upstash Redis + embeddings to Upstash Vector.
 *
 * In watch mode, also polls Redis every 15s for notes created in the Cortex
 * web app and writes them to the local vault.
 *
 * Usage:
 *   npm run sync          # one-time sync
 *   npm run sync:watch    # bidirectional watch mode (vault↔Redis)
 *
 * Environment: requires VAULT_PATH, KV_REST_API_URL, KV_REST_API_TOKEN,
 *              UPSTASH_VECTOR_REST_URL, UPSTASH_VECTOR_REST_TOKEN, VOYAGE_API_KEY
 */

import path from "path";
import { runSync, pullPending } from "../lib/sync";

const VAULT_PATH = process.env.VAULT_PATH;
const watchMode = process.argv.includes("--watch");

if (!VAULT_PATH) {
  console.error("VAULT_PATH is not set");
  process.exit(1);
}

async function main() {
  console.log(`Syncing vault: ${VAULT_PATH}`);
  const startTime = Date.now();

  const result = await runSync();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nSync complete in ${elapsed}s:`);
  console.log(`  Created: ${result.created}`);
  console.log(`  Updated: ${result.updated}`);
  console.log(`  Unchanged: ${result.unchanged}`);
  console.log(`  Deleted: ${result.deleted}`);
  console.log(`  Vectors upserted: ${result.vectorsUpserted}`);
  if (result.pendingWritten > 0) {
    console.log(`  Pending notes written to disk: ${result.pendingWritten}`);
  }
  console.log(`  Total notes: ${result.totalNotes}`);
  console.log(`  Total words: ${result.totalWords.toLocaleString()}`);

  if (watchMode) {
    console.log(`\nStarting bidirectional watch mode on ${VAULT_PATH}...`);
    const { watch } = await import("chokidar");

    // Track files recently written by pullPending so chokidar skips them
    const recentPulls = new Set<string>();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let syncing = false;

    const watcher = watch(VAULT_PATH!, {
      ignored: /(^|[/\\])\./,
      persistent: true,
      ignoreInitial: true,
    });

    function scheduleSync(filePath: string) {
      // Skip files we just pulled from Redis
      const relative = path.relative(VAULT_PATH!, filePath);
      if (recentPulls.has(relative)) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        if (syncing) return;
        syncing = true;
        // Snapshot recentPulls before sync — only these get cleared after.
        // New paths added by pullPending during sync are preserved.
        const pullSnapshot = new Set(recentPulls);
        console.log(`\n[${new Date().toISOString()}] Change detected, syncing...`);
        try {
          const start = Date.now();
          const r = await runSync({ skipPending: true });
          const ms = Date.now() - start;
          console.log(
            `  Sync done in ${(ms / 1000).toFixed(1)}s: +${r.created} ~${r.updated} -${r.deleted} =${r.unchanged}`
          );
        } catch (err) {
          console.error("  Sync error:", err);
        } finally {
          syncing = false;
          for (const p of pullSnapshot) recentPulls.delete(p);
        }
      }, 1000);
    }

    watcher.on("add", scheduleSync);
    watcher.on("change", scheduleSync);
    watcher.on("unlink", scheduleSync);

    // Pull pending creates immediately, then every 15 seconds
    console.log("Checking for pending notes from Cortex...");
    try {
      const initial = await pullPending();
      if (initial.written > 0) {
        for (const p of initial.paths) recentPulls.add(p);
        console.log(`  Pulled ${initial.written} pending note(s) from Cortex`);
      }
    } catch (err) {
      console.error("  Initial pull failed:", err);
    }

    const pollInterval = setInterval(async () => {
      try {
        const { written, paths } = await pullPending();
        if (written > 0) {
          for (const p of paths) recentPulls.add(p);
          console.log(
            `\n[${new Date().toISOString()}] Pulled ${written} note(s) from Cortex`
          );
        }
      } catch (err) {
        console.error("[pullPending] Error:", err);
      }
    }, 15_000);

    // Graceful shutdown
    function shutdown() {
      console.log("\nShutting down sync daemon...");
      clearInterval(pollInterval);
      watcher.close();
      process.exit(0);
    }
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.log("Watching for changes + polling Redis every 15s... (Ctrl+C to stop)");
  }
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
