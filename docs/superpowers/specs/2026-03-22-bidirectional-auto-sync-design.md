# Bidirectional Auto-Sync Between Cortex (Vercel) and Local Obsidian Vault

**Date:** 2026-03-22
**Status:** Approved

## Problem

Cortex is deployed on Vercel. The Obsidian vault lives on a local machine. Currently:

- **Vault → Redis:** Runs once daily at 6am UTC via Vercel cron, or manually via `npm run sync`. Watch mode exists but must be started manually.
- **Redis → Vault:** Fully manual via `npm run sync:pull`. Notes created in Cortex go to `vault:pending-creates` in Redis and sit there until pulled.

The user wants notes created in either location to automatically appear in the other.

## Approach

Enhance the existing `sync:watch` mode to handle both directions, and install it as a systemd user service that auto-starts on login.

- **Vault → Redis:** Already handled by chokidar in watch mode (1s debounce → `runSync()`)
- **Redis → Vault:** New 15s polling interval checks `vault:pending-creates` and writes new notes to disk

## Design

### 1. Lightweight `pullPending()` function

**Location:** `lib/sync.ts`
**Signature:** `pullPending(): Promise<{ written: number; paths: string[] }>`

Behavior:
1. Call `kv.smembers("vault:pending-creates")`
2. If empty, return `{ written: 0, paths: [] }` immediately (one Redis call, 99% of invocations)
3. For each pending path:
   a. Fetch note data from Redis (`vault:note:{path}`)
   b. Skip if file already exists on disk
   c. Write `rawContent` to disk (create directories as needed). If `rawContent` is missing, reconstruct from `content` + metadata (same logic as `sync-from-redis.ts`)
   d. Compute MD5 hash of the **exact string passed to `writeFileSync`** using the same `md5()` helper from `lib/sync.ts`, and set `vault:hash:{path}` in Redis. This guarantees hash equivalence with `runSync()`, which hashes `fs.readFileSync(path, "utf-8")`.
   e. Remove path from `vault:pending-creates`
4. Return `{ written, paths }` (paths needed by the caller to populate `recentPulls`)

Setting the hash in step (d) is critical: when chokidar detects the new file and triggers `runSync()`, the hash will match and the note will be skipped as "unchanged." This prevents redundant re-processing.

### 2. Changes to `runSync()`

Add an optional `skipPending?: boolean` parameter to `runSync()`. When `true`, skip the pending-creates block (lines 225-245 in current code). The watch mode in `scripts/sync.ts` will pass `skipPending: true` since `pullPending()` handles that responsibility on a faster cadence. The API route and one-shot sync continue to pass `false` (default) so they still handle pending creates.

This eliminates the overlap where both `pullPending()` and `runSync()` could race on the same pending paths.

### 3. Enhanced watch mode in `scripts/sync.ts`

Add to the existing watch mode:

**Immediate + 15s poll interval:**
```typescript
// Run immediately on startup, then every 15s
await pullPending();
const pollInterval = setInterval(async () => {
  const { written, paths } = await pullPending();
  if (written > 0) {
    for (const p of paths) recentPulls.add(p);
    console.log(`Pulled ${written} note(s) from Cortex`);
  }
}, 15_000);
```

**`recentPulls` skip set:**
Track files written by `pullPending()` so chokidar ignores them entirely (avoids even the hash-check overhead from `runSync()`).

- `pullPending()` returns written paths; the caller adds them to a `Set<string>`
- Entries are removed **after `runSync()` completes** (not on a timer), in the `scheduleSync()` callback. This is safer than a timeout since `runSync()` can take variable time depending on vault size and embedding work.
- The chokidar `scheduleSync()` callback checks this set and skips if the changed file is in it

**Graceful shutdown:**
Handle `SIGINT` and `SIGTERM`:
- Clear the poll interval
- Close the chokidar watcher
- Exit cleanly

**Watch mode calls `runSync({ skipPending: true })`** to avoid overlap with `pullPending()`.

### 4. systemd user service

**Install script:** `scripts/install-service.sh`

Generates `~/.config/systemd/user/cortex-sync.service`:

```ini
[Unit]
Description=Cortex Vault Sync (bidirectional)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=<project-dir>
ExecStart=/bin/bash -c 'set -a && source <project-dir>/.env.local && set +a && exec <resolved-npm-path> run sync:watch'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

Key details:
- **No `EnvironmentFile`** — `.env.local` likely uses quoted values which systemd parses incorrectly. Instead, use a bash wrapper that sources the file properly.
- **Resolved npm path** — the install script uses `which npm` to find the actual npm binary (handles nvm/fnm/volta setups where npm is not at `/usr/bin/npm`).
- Runs as the user (not root), so it has access to vault files and home directory.

After writing the file:
- `systemctl --user daemon-reload`
- `systemctl --user enable --now cortex-sync`
- Print status confirmation

**Uninstall:** Corresponding logic to stop, disable, and remove the service file.

### 5. Package.json scripts

```json
"sync:install": "bash scripts/install-service.sh install",
"sync:uninstall": "bash scripts/install-service.sh uninstall",
"sync:logs": "journalctl --user -u cortex-sync -f"
```

### 6. Vercel cron

No change. Stays at daily 6am UTC as a safety net for when the local daemon isn't running.

## Data Flow

```
LOCAL OBSIDIAN VAULT
  │                          ▲
  │ chokidar (1s debounce)   │ pullPending (15s poll)
  │                          │
  ▼                          │
runSync() ──────────────► UPSTASH REDIS ◄──── Cortex Web App
  (full scan, hash,          │                  (POST /api/notes/create)
   embed, briefing)          │                  adds to vault:pending-creates
                             │
                             ▼
                      UPSTASH VECTOR
```

## What's Changing in Existing Code

- `runSync()` in `lib/sync.ts` — add `skipPending` option to skip the pending-creates block
- `scripts/sync.ts` — add poll interval, `recentPulls` set, graceful shutdown, pass `skipPending: true`
- `package.json` — add `sync:install`, `sync:uninstall`, `sync:logs` scripts

## What's NOT Changing

- `scripts/sync-from-redis.ts` — kept as standalone manual tool
- `/api/sync` route — untouched (calls `runSync()` without `skipPending`)
- Note creation API — untouched, still writes to `vault:pending-creates`
- `vercel.json` — no change to cron schedule

## Edge Cases

- **Daemon not running:** Pending creates accumulate in Redis. Next daemon start pulls them all immediately (initial `pullPending()` call). Daily cron still pushes vault → Redis.
- **Conflict (same path edited in both):** Vault wins. `runSync()` overwrites Redis with local content. This matches current behavior — the vault is the source of truth for existing files.
- **Large pending batch:** If many notes are created in Cortex while daemon is off, `pullPending()` processes them all on next run. Each triggers a Redis fetch + disk write but no embeddings (those happen in `runSync()` after chokidar fires, but the hash will match so they'll be skipped — embeddings were already handled when the note was created via the API or will be handled by the next full sync).
- **Network failure:** `pullPending()` errors are caught and logged. The 15s interval retries automatically. `Restart=on-failure` in systemd handles process crashes.
