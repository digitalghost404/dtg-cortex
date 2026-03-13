#!/usr/bin/env npx tsx
/**
 * Auto-Tag Script
 *
 * Reads .md files from VAULT_PATH, sends content to Claude Haiku for tag
 * suggestions, and merges them into each note's frontmatter.
 *
 * Usage:
 *   npm run auto-tag                     # tag all notes
 *   npm run auto-tag -- --dry-run        # preview without writing
 *   npm run auto-tag -- --filter=folder/ # scope to a folder
 *   npm run auto-tag -- --model=claude-sonnet-4-20250514
 *
 * Environment: requires VAULT_PATH, ANTHROPIC_API_KEY
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const VAULT_PATH = process.env.VAULT_PATH;
const MAX_TAGS_PER_NOTE = 5;
const API_DELAY_MS = 200;

if (!VAULT_PATH) {
  console.error("VAULT_PATH is not set");
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse CLI flags
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const filterArg = args.find((a) => a.startsWith("--filter="));
const filterPath = filterArg ? filterArg.split("=")[1] : null;
const modelArg = args.find((a) => a.startsWith("--model="));
const model = modelArg ? modelArg.split("=")[1] : "claude-haiku-4-5-20251001";

const client = new Anthropic();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseTag(raw: unknown): string {
  const s = String(raw).trim().toLowerCase();
  return s.startsWith("#") ? s : `#${s}`;
}

function extractTags(data: Record<string, unknown>): string[] {
  const raw = data.tags ?? data.tag ?? data.Topics ?? data.topics ?? null;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(normaliseTag);
  if (typeof raw === "string") {
    return raw
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map(normaliseTag);
  }
  return [];
}

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function autoTag() {
  console.log(`Auto-tagging vault: ${VAULT_PATH}`);
  console.log(`Model: ${model}`);
  if (dryRun) console.log("DRY RUN — no files will be modified");
  if (filterPath) console.log(`Filter: ${filterPath}`);
  console.log();

  // Collect all markdown files
  let files = collectMarkdownFiles(VAULT_PATH!);

  // Apply folder filter
  if (filterPath) {
    files = files.filter((f) => {
      const rel = path.relative(VAULT_PATH!, f);
      return rel.startsWith(filterPath);
    });
  }

  console.log(`Found ${files.length} markdown files`);

  // First pass: collect all existing tags to build vocabulary
  const tagCounts = new Map<string, number>();
  const fileData: Array<{
    fullPath: string;
    relativePath: string;
    content: string;
    existingTags: string[];
    frontmatter: Record<string, unknown>;
    rawContent: string;
  }> = [];

  for (const fullPath of files) {
    const raw = fs.readFileSync(fullPath, "utf-8");
    const { data, content } = matter(raw);
    const existingTags = extractTags(data as Record<string, unknown>);
    const relativePath = path.relative(VAULT_PATH!, fullPath);

    for (const tag of existingTags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }

    fileData.push({
      fullPath,
      relativePath,
      content,
      existingTags,
      frontmatter: data as Record<string, unknown>,
      rawContent: raw,
    });
  }

  const vocabulary = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);

  console.log(`Tag vocabulary: ${vocabulary.length} unique tags`);
  console.log();

  // Second pass: suggest tags for each note
  let tagged = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < fileData.length; i++) {
    const file = fileData[i];
    const slotsAvailable = MAX_TAGS_PER_NOTE - file.existingTags.length;

    if (slotsAvailable <= 0) {
      skipped++;
      continue;
    }

    // Truncate content to avoid token limits (roughly 2000 words)
    const truncatedContent = file.content.split(/\s+/).slice(0, 2000).join(" ");

    if (!truncatedContent.trim()) {
      skipped++;
      continue;
    }

    try {
      const response = await client.messages.create({
        model,
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `Analyze this note and suggest up to ${slotsAvailable} tags for it. Return ONLY a JSON array of tag strings (without # prefix). Prefer tags from this existing vocabulary when appropriate: ${vocabulary.slice(0, 50).map((t) => t.replace("#", "")).join(", ")}

Existing tags on this note: ${file.existingTags.join(", ") || "none"}

Note content:
${truncatedContent}`,
          },
        ],
      });

      const text =
        response.content[0].type === "text" ? response.content[0].text : "";

      // Parse JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) {
        console.warn(`  [${file.relativePath}] Could not parse response`);
        errors++;
        continue;
      }

      const suggestedRaw = JSON.parse(jsonMatch[0]) as string[];
      const suggested = suggestedRaw
        .map(normaliseTag)
        .filter((t) => !file.existingTags.includes(t))
        .slice(0, slotsAvailable);

      if (suggested.length === 0) {
        skipped++;
        continue;
      }

      const mergedTags = [...file.existingTags, ...suggested];

      // Store tags without # for frontmatter (common convention)
      const tagsForFrontmatter = mergedTags.map((t) => t.replace(/^#/, ""));

      if (dryRun) {
        console.log(
          `  [${file.relativePath}] +${suggested.length} tags: ${suggested.join(", ")}`
        );
      } else {
        // Rewrite frontmatter
        const updated = matter.stringify(file.content, {
          ...file.frontmatter,
          tags: tagsForFrontmatter,
        });
        fs.writeFileSync(file.fullPath, updated, "utf-8");
        console.log(
          `  [${file.relativePath}] +${suggested.length} tags: ${suggested.join(", ")}`
        );
      }

      tagged++;
    } catch (err) {
      console.error(
        `  [${file.relativePath}] Error:`,
        err instanceof Error ? err.message : err
      );
      errors++;
    }

    // Rate limit
    if (i < fileData.length - 1) {
      await sleep(API_DELAY_MS);
    }

    if ((i + 1) % 25 === 0) {
      console.log(`  Progress: ${i + 1}/${fileData.length}`);
    }
  }

  console.log(`\nAuto-tag complete:`);
  console.log(`  Tagged: ${tagged}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Errors: ${errors}`);
  console.log(`  Total: ${fileData.length}`);

  if (!dryRun && tagged > 0) {
    console.log(`\nRemember to run: npm run sync`);
  }
}

autoTag().catch((err) => {
  console.error("Auto-tag failed:", err);
  process.exit(1);
});
