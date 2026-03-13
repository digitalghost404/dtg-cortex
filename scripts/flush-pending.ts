import { Redis } from "@upstash/redis";
import * as fs from "fs/promises";
import * as path from "path";

const redis = new Redis({
  url: process.env.KV_REST_API_URL || "",
  token: process.env.KV_REST_API_TOKEN || "",
});

const vaultPath = process.env.VAULT_PATH || "";
console.log("VAULT_PATH:", vaultPath);

async function flushPending() {
  const pending = (await redis.smembers("vault:pending-creates")) as string[];
  console.log("Pending creates:", pending.length);

  let wrote = 0;
  for (const p of pending) {
    const noteData = (await redis.hgetall(`vault:note:${p}`)) as Record<string, string>;
    console.log("--- Note:", p);
    console.log("  Fields:", Object.keys(noteData || {}));

    if (noteData?.content) {
      const name = noteData.name || path.basename(p, ".md");
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

      const rawContent = frontmatter + "\n\n" + noteData.content + "\n";

      const filePath = path.join(vaultPath, p);
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, rawContent, "utf-8");
      await redis.srem("vault:pending-creates", p);
      wrote++;
      console.log("  Wrote:", filePath);
    } else {
      console.log("  No content field — skipping");
    }
  }
  console.log("Done. Wrote", wrote, "notes to filesystem");
}

async function cleanup() {
  // Remove any entries with empty data
  const pending = (await redis.smembers("vault:pending-creates")) as string[];
  for (const p of pending) {
    const noteData = (await redis.hgetall(`vault:note:${p}`)) as Record<string, string>;
    if (!noteData || Object.keys(noteData).length === 0) {
      await redis.srem("vault:pending-creates", p);
      console.log("Removed orphaned entry:", p);
    }
  }
}

flushPending().then(() => cleanup()).catch(console.error);
