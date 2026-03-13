/**
 * sync-from-redis.ts
 *
 * Pulls notes from Redis (Upstash KV) that don't exist in the local Obsidian vault
 * and writes them to the filesystem. Run this to sync dossier notes and any other
 * notes created via the deployed Cortex app.
 *
 * Usage:
 *   source .env.local && npx tsx scripts/sync-from-redis.ts
 *
 * Or use the npm script:
 *   npm run sync:pull
 */

import { Redis } from "@upstash/redis";
import * as fs from "fs/promises";
import * as path from "path";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

const vaultPath = process.env.VAULT_PATH || "";

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function syncFromRedis() {
  if (!vaultPath) {
    console.error("VAULT_PATH is not set. Source .env.local first.");
    process.exit(1);
  }

  console.log(`Syncing from Redis → ${vaultPath}\n`);

  // Get all note paths from the Redis vault index
  const allPaths = (await redis.smembers("vault:notes:index")) as string[];
  console.log(`Total notes in Redis index: ${allPaths.length}`);

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const relativePath of allPaths) {
    const localPath = path.join(vaultPath, relativePath);

    // Skip if file already exists locally
    if (await fileExists(localPath)) {
      skipped++;
      continue;
    }

    // Fetch note data from Redis
    const noteData = (await redis.hgetall(`vault:note:${relativePath}`)) as Record<string, string>;

    if (!noteData || Object.keys(noteData).length === 0) {
      continue; // No data in Redis for this path
    }

    // Prefer rawContent (includes frontmatter), fall back to reconstructing
    let content = noteData.rawContent;

    if (!content && noteData.content) {
      const name = noteData.name || path.basename(relativePath, ".md");
      const tags: string[] = noteData.tags ? JSON.parse(noteData.tags) : ["#cortex-generated"];
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
      failed++;
      console.log(`  SKIP (no content): ${relativePath}`);
      continue;
    }

    try {
      const dir = path.dirname(localPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(localPath, content, "utf-8");
      synced++;
      console.log(`  NEW: ${relativePath}`);

      // Clean from pending-creates if present
      await redis.srem("vault:pending-creates", relativePath);
    } catch (err) {
      failed++;
      console.error(`  FAIL: ${relativePath}`, err);
    }
  }

  console.log(`\nDone. Synced: ${synced}, Already existed: ${skipped}, Failed: ${failed}`);
}

syncFromRedis().catch(console.error);
