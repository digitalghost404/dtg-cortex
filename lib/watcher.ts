import path from "path";
import chokidar, { FSWatcher } from "chokidar";
import { indexExists, indexSingleFile, removeFileFromIndex } from "@/lib/indexer";
import { watcherEvents } from "@/lib/watcher-events";

const VAULT_PATH = process.env.VAULT_PATH!;

// Singleton state
let watcher: FSWatcher | null = null;
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleIndex(filePath: string): void {
  const existing = debounceTimers.get(filePath);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    filePath,
    setTimeout(async () => {
      debounceTimers.delete(filePath);

      if (!indexExists()) {
        console.log(`[watcher] skipping ${filePath} — index not built yet`);
        return;
      }

      try {
        await indexSingleFile(filePath);
        const relativePath = path.relative(VAULT_PATH, filePath);
        console.log(`[watcher] indexed: ${relativePath}`);
      } catch (err) {
        console.error(`[watcher] failed to index ${filePath}:`, err);
      }
    }, 300)
  );
}

function scheduleRemove(filePath: string): void {
  const existing = debounceTimers.get(filePath);
  if (existing) clearTimeout(existing);

  debounceTimers.set(
    filePath,
    setTimeout(async () => {
      debounceTimers.delete(filePath);

      if (!indexExists()) {
        return;
      }

      try {
        const relativePath = path.relative(VAULT_PATH, filePath);
        await removeFileFromIndex(relativePath);
        console.log(`[watcher] removed: ${relativePath}`);
      } catch (err) {
        console.error(`[watcher] failed to remove ${filePath} from index:`, err);
      }
    }, 300)
  );
}

export function startWatcher(): void {
  if (watcher !== null) {
    // Already running — no-op
    return;
  }

  if (!VAULT_PATH) {
    throw new Error("VAULT_PATH is not set in environment");
  }

  watcher = chokidar.watch(VAULT_PATH, {
    ignored: /(^|[/\\])\../, // ignore dotfiles/dotdirs
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300 },
  });

  watcher
    .on("add", (filePath: string) => {
      if (!filePath.endsWith(".md")) return;
      watcherEvents.emit({
        type: "add",
        name: path.basename(filePath, ".md"),
        path: path.relative(VAULT_PATH, filePath),
        timestamp: Date.now(),
      });
      scheduleIndex(filePath);
    })
    .on("change", (filePath: string) => {
      if (!filePath.endsWith(".md")) return;
      watcherEvents.emit({
        type: "change",
        name: path.basename(filePath, ".md"),
        path: path.relative(VAULT_PATH, filePath),
        timestamp: Date.now(),
      });
      scheduleIndex(filePath);
    })
    .on("unlink", (filePath: string) => {
      if (!filePath.endsWith(".md")) return;
      watcherEvents.emit({
        type: "unlink",
        name: path.basename(filePath, ".md"),
        path: path.relative(VAULT_PATH, filePath),
        timestamp: Date.now(),
      });
      scheduleRemove(filePath);
    })
    .on("error", (err: unknown) => {
      console.error("[watcher] chokidar error:", err);
    });

  console.log(`[watcher] watching ${VAULT_PATH} for .md changes`);
}

export async function stopWatcher(): Promise<void> {
  if (watcher === null) {
    return;
  }

  // Cancel any in-flight debounce timers
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();

  await watcher.close();
  watcher = null;
  console.log("[watcher] stopped");
}

export function isWatching(): boolean {
  return watcher !== null;
}
