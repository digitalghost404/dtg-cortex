#!/usr/bin/env npx tsx
/**
 * Vault Sync Script
 *
 * Reads the local Obsidian vault, computes MD5 hashes for incremental sync,
 * and pushes note content to Upstash Redis + embeddings to Upstash Vector.
 *
 * Usage:
 *   npm run sync          # one-time sync
 *   npm run sync:watch    # initial sync + watch for changes
 *
 * Environment: requires VAULT_PATH, KV_REST_API_URL, KV_REST_API_TOKEN,
 *              UPSTASH_VECTOR_REST_URL, UPSTASH_VECTOR_REST_TOKEN, VOYAGE_API_KEY
 */

import { runSync } from "../lib/sync";

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
    console.log(`\nStarting watch mode on ${VAULT_PATH}...`);
    const { watch } = await import("chokidar");

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const watcher = watch(VAULT_PATH!, {
      ignored: /(^|[/\\])\./,
      persistent: true,
      ignoreInitial: true,
    });

    function scheduleSync() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        console.log(`\n[${new Date().toISOString()}] Change detected, syncing...`);
        try {
          const start = Date.now();
          const r = await runSync();
          const ms = Date.now() - start;
          console.log(
            `  Sync done in ${(ms / 1000).toFixed(1)}s: +${r.created} ~${r.updated} -${r.deleted} =${r.unchanged}`
          );
        } catch (err) {
          console.error("  Sync error:", err);
        }
      }, 1000);
    }

    watcher.on("add", scheduleSync);
    watcher.on("change", scheduleSync);
    watcher.on("unlink", scheduleSync);

    console.log("Watching for changes... (Ctrl+C to stop)");
  }
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
