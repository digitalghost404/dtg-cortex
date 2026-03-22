# Bidirectional Auto-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically sync notes between the deployed Cortex app (Vercel/Redis) and the local Obsidian vault in both directions.

**Architecture:** Enhance the existing `sync:watch` mode to poll Redis for pending creates every 15 seconds alongside the existing chokidar filesystem watcher. Install as a systemd user service for auto-start on login.

**Tech Stack:** TypeScript, Node.js, chokidar, Upstash Redis, systemd, vitest

**Spec:** `docs/superpowers/specs/2026-03-22-bidirectional-auto-sync-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `lib/sync.ts` | Modify | Add `pullPending()` function, add `skipPending` option to `runSync()` |
| `scripts/sync.ts` | Modify | Add poll interval, `recentPulls` set, graceful shutdown |
| `scripts/install-service.sh` | Create | Generate and manage systemd user service |
| `package.json` | Modify | Add `sync:install`, `sync:uninstall`, `sync:logs` scripts |
| `__tests__/lib/sync.test.ts` | Modify | Add tests for `pullPending()` and `skipPending` option |

---

### Task 1: Add `pullPending()` to `lib/sync.ts`

**Files:**
- Modify: `lib/sync.ts`
- Modify: `__tests__/lib/sync.test.ts`

- [ ] **Step 1: Write the failing test for `pullPending()` — empty pending set**

Add to `__tests__/lib/sync.test.ts`:

```typescript
// ===========================================================================
// pullPending
// ===========================================================================

describe("pullPending", () => {
  it("returns zero when no pending creates exist", async () => {
    kvMock.smembers.mockResolvedValueOnce([]);

    const result = await pullPending();

    expect(result).toEqual({ written: 0, paths: [] });
    expect(kvMock.smembers).toHaveBeenCalledWith("vault:pending-creates");
  });
});
```

Also add `pullPending` to the import at line 65:

```typescript
import { runSync, pullPending } from "@/lib/sync";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/sync.test.ts -t "returns zero when no pending creates exist"`
Expected: FAIL — `pullPending` is not exported from `@/lib/sync`

- [ ] **Step 3: Export `pullPending()` with minimal implementation**

In `lib/sync.ts`, add after the `md5()` helper (around line 39):

```typescript
// ---------------------------------------------------------------------------
// Lightweight pending-creates pull (used by watch mode on 15s interval)
// ---------------------------------------------------------------------------

export async function pullPending(): Promise<{ written: number; paths: string[] }> {
  const VAULT_PATH = process.env.VAULT_PATH;
  if (!VAULT_PATH) throw new Error("VAULT_PATH is not set");

  const pending = await kv.smembers("vault:pending-creates");
  if (pending.length === 0) return { written: 0, paths: [] };

  let written = 0;
  const paths: string[] = [];

  for (const relativePath of pending) {
    const noteData = await kv.hgetall<Record<string, string>>(`vault:note:${relativePath}`);
    if (!noteData) {
      await kv.srem("vault:pending-creates", relativePath);
      continue;
    }

    const diskPath = path.join(VAULT_PATH, relativePath);

    // Skip if file already exists on disk
    if (fs.existsSync(diskPath)) {
      await kv.srem("vault:pending-creates", relativePath);
      continue;
    }

    // Prefer rawContent; fall back to reconstructing frontmatter
    let content = noteData.rawContent;
    if (!content && noteData.content) {
      const name = noteData.name || path.basename(relativePath, ".md");
      const tags: string[] = noteData.tags ? JSON.parse(noteData.tags) : [];
      const created = noteData.modifiedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
      const frontmatter = [
        "---",
        `title: "${name}"`,
        `created: ${created}`,
        "source: cortex-chat",
        "tags:",
        ...tags.map((t: string) => `  - ${t.replace(/^#/, "")}`),
        "---",
      ].join("\n");
      content = frontmatter + "\n\n" + noteData.content + "\n";
    }

    if (!content) {
      await kv.srem("vault:pending-creates", relativePath);
      continue;
    }

    try {
      const dir = path.dirname(diskPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(diskPath, content, "utf-8");

      // Set hash so runSync() skips this file as "unchanged"
      const hash = md5(content);
      await kv.setJSON(`vault:hash:${relativePath}`, hash);
      await kv.srem("vault:pending-creates", relativePath);

      written++;
      paths.push(relativePath);
    } catch (err) {
      console.error(`[pullPending] Failed to write ${relativePath}:`, err);
    }
  }

  return { written, paths };
}
```

- [ ] **Step 4: Run the empty-set test to verify it passes**

Run: `npx vitest run __tests__/lib/sync.test.ts -t "returns zero when no pending creates exist"`
Expected: PASS

- [ ] **Step 5: Write tests for `pullPending()` — writes pending note to disk and sets hash**

Add to the `pullPending` describe block in `__tests__/lib/sync.test.ts`:

```typescript
  it("writes pending note to disk and sets hash", async () => {
    kvMock.smembers.mockResolvedValueOnce(["cortex-notes/test.md"]);
    kvMock.hgetall.mockResolvedValueOnce({
      name: "test",
      rawContent: "---\ntitle: test\n---\nHello",
      content: "Hello",
      tags: "[]",
      outgoing: "[]",
      folder: "cortex-notes",
      words: "1",
      modifiedAt: "2026-03-22T00:00:00.000Z",
      size: "25",
    });
    (fs.existsSync as unknown as Mock).mockReturnValueOnce(false);

    const result = await pullPending();

    expect(result.written).toBe(1);
    expect(result.paths).toEqual(["cortex-notes/test.md"]);
    expect(fs.mkdirSync).toHaveBeenCalled();
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(VAULT, "cortex-notes/test.md"),
      "---\ntitle: test\n---\nHello",
      "utf-8",
    );
    // Hash must be set so runSync skips it
    expect(kvMock.setJSON).toHaveBeenCalledWith(
      "vault:hash:cortex-notes/test.md",
      expect.any(String),
    );
    expect(kvMock.srem).toHaveBeenCalledWith("vault:pending-creates", "cortex-notes/test.md");
  });

  it("skips notes that already exist on disk", async () => {
    kvMock.smembers.mockResolvedValueOnce(["existing.md"]);
    kvMock.hgetall.mockResolvedValueOnce({ rawContent: "content" });
    (fs.existsSync as unknown as Mock).mockReturnValueOnce(true);

    const result = await pullPending();

    expect(result.written).toBe(0);
    expect(result.paths).toEqual([]);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("reconstructs frontmatter when rawContent is missing", async () => {
    kvMock.smembers.mockResolvedValueOnce(["cortex-notes/reconstructed.md"]);
    kvMock.hgetall.mockResolvedValueOnce({
      name: "reconstructed",
      content: "Some body text",
      tags: JSON.stringify(["#test"]),
      modifiedAt: "2026-03-22T00:00:00.000Z",
    });
    (fs.existsSync as unknown as Mock).mockReturnValueOnce(false);

    const result = await pullPending();

    expect(result.written).toBe(1);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("reconstructed.md"),
      expect.stringContaining("title: \"reconstructed\""),
      "utf-8",
    );
  });
```

- [ ] **Step 6: Run all pullPending tests**

Run: `npx vitest run __tests__/lib/sync.test.ts -t "pullPending"`
Expected: PASS (all 4 tests)

- [ ] **Step 7: Commit**

```bash
git add lib/sync.ts __tests__/lib/sync.test.ts
git commit -m "feat: add pullPending() for lightweight Redis→vault sync"
```

---

### Task 2: Add `skipPending` option to `runSync()`

**Files:**
- Modify: `lib/sync.ts:75` (runSync signature)
- Modify: `__tests__/lib/sync.test.ts`

- [ ] **Step 1: Write the failing test for skipPending**

Add to `__tests__/lib/sync.test.ts` in a new describe block:

```typescript
describe("runSync with skipPending", () => {
  it("skips pending-creates block when skipPending is true", async () => {
    (fs.readdirSync as unknown as Mock).mockReturnValue([]);
    setupSmembers([], ["should-be-skipped.md"]);

    const result = await runSync({ skipPending: true });

    expect(result.pendingWritten).toBe(0);
    // smembers is called once for vault:notes:index, but NOT for vault:pending-creates
    expect(kvMock.smembers).toHaveBeenCalledTimes(1);
    expect(kvMock.smembers).toHaveBeenCalledWith("vault:notes:index");
  });
});
```

Note: the `setupSmembers` helper wires two sequential calls. With `skipPending: true`, only the first call (vault:notes:index) should happen.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run __tests__/lib/sync.test.ts -t "skips pending-creates block when skipPending is true"`
Expected: FAIL — `runSync` does not accept options

- [ ] **Step 3: Modify `runSync()` to accept options**

In `lib/sync.ts`, change the signature at line 75:

```typescript
export async function runSync(
  options: { skipPending?: boolean } = {},
): Promise<SyncResult> {
```

Then wrap the pending-creates block (lines 224-245) with:

```typescript
  // Handle pending creates (skipped in watch mode where pullPending handles this)
  let pendingWritten = 0;
  if (!options.skipPending) {
    const pendingCreates = await kv.smembers("vault:pending-creates");
    for (const pendingPath of pendingCreates) {
      const noteData = await kv.hgetall<Record<string, string>>(`vault:note:${pendingPath}`);
      if (!noteData) {
        await kv.srem("vault:pending-creates", pendingPath);
        continue;
      }

      // Prefer rawContent; fall back to reconstructing frontmatter
      let fileContent = noteData.rawContent;
      if (!fileContent && noteData.content) {
        const name = noteData.name || path.basename(pendingPath, ".md");
        const tags: string[] = noteData.tags ? JSON.parse(noteData.tags) : [];
        const created = noteData.modifiedAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
        const frontmatter = [
          "---",
          `title: "${name}"`,
          `created: ${created}`,
          "source: cortex-chat",
          "tags:",
          ...tags.map((t: string) => `  - ${t.replace(/^#/, "")}`),
          "---",
        ].join("\n");
        fileContent = frontmatter + "\n\n" + noteData.content + "\n";
      }

      if (!fileContent) {
        await kv.srem("vault:pending-creates", pendingPath);
        continue;
      }

      const diskPath = path.join(VAULT_PATH, pendingPath);
      const dir = path.dirname(diskPath);

      try {
        fs.mkdirSync(dir, { recursive: true });
        if (!fs.existsSync(diskPath)) {
          fs.writeFileSync(diskPath, fileContent, "utf-8");
          pendingWritten++;
        }
      } catch (err) {
        console.error(`  Failed to write pending note ${pendingPath}:`, err);
      }

      await kv.srem("vault:pending-creates", pendingPath);
    }
  }
```

This aligns `runSync()`'s pending-creates logic with `pullPending()` — both now reconstruct frontmatter when `rawContent` is missing, and both call `srem` even when skipping a note (prevents orphaned entries in the pending set).

Move the `let pendingWritten = 0;` declaration to before the `if` block (it was previously declared inline at line 226).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/sync.test.ts -t "skips pending-creates block when skipPending is true"`
Expected: PASS

- [ ] **Step 5: Run full sync test suite to verify no regressions**

Run: `npx vitest run __tests__/lib/sync.test.ts`
Expected: All existing tests PASS (they call `runSync()` without options, so `skipPending` defaults to `false`)

- [ ] **Step 6: Commit**

```bash
git add lib/sync.ts __tests__/lib/sync.test.ts
git commit -m "feat: add skipPending option to runSync()"
```

---

### Task 3: Enhance watch mode in `scripts/sync.ts`

**Files:**
- Modify: `scripts/sync.ts`

- [ ] **Step 1: Update the import to include `pullPending`**

At line 16 of `scripts/sync.ts`:

```typescript
import { runSync, pullPending } from "../lib/sync";
```

- [ ] **Step 2: Add `recentPulls` set and update watch mode**

Replace the entire watch mode block (lines 45-79) with:

```typescript
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
```

- [ ] **Step 3: Add `path` import at top of file**

At the top of `scripts/sync.ts`, add:

```typescript
import path from "path";
```

- [ ] **Step 4: Update the file header comment**

Replace lines 2-12:

```typescript
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
```

- [ ] **Step 5: Verify the script compiles**

Run: `npx tsx --eval "import './scripts/sync'" 2>&1 | head -5`
Expected: No syntax/import errors (it will fail on missing env vars, which is fine)

- [ ] **Step 6: Commit**

```bash
git add scripts/sync.ts
git commit -m "feat: bidirectional watch mode — poll Redis for pending creates"
```

---

### Task 4: Create systemd service installer

**Files:**
- Create: `scripts/install-service.sh`

- [ ] **Step 1: Create the install script**

Create `scripts/install-service.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="cortex-sync"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NPM_PATH="$(command -v npm)"

if [ -z "$NPM_PATH" ]; then
  echo "Error: npm not found in PATH"
  exit 1
fi

if [ ! -f "$PROJECT_DIR/.env.local" ]; then
  echo "Error: $PROJECT_DIR/.env.local not found"
  exit 1
fi

install_service() {
  mkdir -p "$SERVICE_DIR"

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Cortex Vault Sync (bidirectional)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=/bin/bash -c 'set -a && source $PROJECT_DIR/.env.local && set +a && exec $NPM_PATH run sync:watch'
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now "$SERVICE_NAME"

  echo ""
  echo "Cortex sync service installed and started."
  echo ""
  echo "  Status:  systemctl --user status $SERVICE_NAME"
  echo "  Logs:    npm run sync:logs"
  echo "  Stop:    systemctl --user stop $SERVICE_NAME"
  echo "  Restart: systemctl --user restart $SERVICE_NAME"
  echo "  Remove:  npm run sync:uninstall"
}

uninstall_service() {
  if systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl --user stop "$SERVICE_NAME"
  fi

  if systemctl --user is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    systemctl --user disable "$SERVICE_NAME"
  fi

  if [ -f "$SERVICE_FILE" ]; then
    rm "$SERVICE_FILE"
    systemctl --user daemon-reload
    echo "Cortex sync service removed."
  else
    echo "Service file not found. Nothing to remove."
  fi
}

case "${1:-}" in
  install)
    install_service
    ;;
  uninstall)
    uninstall_service
    ;;
  *)
    echo "Usage: $0 {install|uninstall}"
    exit 1
    ;;
esac
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x scripts/install-service.sh`

- [ ] **Step 3: Verify the script parses correctly**

Run: `bash -n scripts/install-service.sh && echo "Syntax OK"`
Expected: "Syntax OK"

- [ ] **Step 4: Commit**

```bash
git add scripts/install-service.sh
git commit -m "feat: add systemd service installer for cortex-sync"
```

---

### Task 5: Add npm scripts to `package.json`

**Files:**
- Modify: `package.json:5-16` (scripts section)

- [ ] **Step 1: Add the three new scripts**

Add to the `"scripts"` block in `package.json`:

```json
"sync:install": "bash scripts/install-service.sh install",
"sync:uninstall": "bash scripts/install-service.sh uninstall",
"sync:logs": "journalctl --user -u cortex-sync -f"
```

- [ ] **Step 2: Verify package.json is valid**

Run: `node -e "require('./package.json')" && echo "Valid JSON"`
Expected: "Valid JSON"

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat: add sync:install, sync:uninstall, sync:logs scripts"
```

---

### Task 6: Integration verification

**Files:** None (testing only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: All tests pass, no regressions

- [ ] **Step 2: Verify one-shot sync still works**

Run: `npm run sync` (requires env vars set)
Expected: Syncs successfully, prints results as before. The `skipPending` defaults to `false`, so pending creates are still handled.

- [ ] **Step 3: Verify watch mode starts and shows bidirectional output**

Run: `npm run sync:watch`
Expected output includes:
- "Starting bidirectional watch mode on ..."
- "Checking for pending notes from Cortex..."
- "Watching for changes + polling Redis every 15s..."
Stop with Ctrl+C, verify clean shutdown message.

- [ ] **Step 4: Install the systemd service**

Run: `npm run sync:install`
Expected: Service installed, enabled, and started. Verify with `systemctl --user status cortex-sync`.

- [ ] **Step 5: Verify logs work**

Run: `npm run sync:logs`
Expected: Shows journal output from the cortex-sync service. Ctrl+C to stop.

- [ ] **Step 6: Final commit (if any fixups needed)**

```bash
git add -A
git commit -m "fix: integration fixups for bidirectional sync"
```
