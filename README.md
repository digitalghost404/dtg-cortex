# Cortex

> Your second brain, wired up.

Your Obsidian vault is full of ideas — but you can't grep intuition. **Cortex** is a web app that gives your vault a voice. Ask it questions, and it pulls the right notes, threads the connections, and answers with the full weight of everything you've ever written. It doesn't just search — it *understands*.

**RAG-powered chat. Auto-tagging. File explorer. Voice conversations. Neural visualization. Public sharing. One vault that finally talks back.**

---

## ⚡ What Cortex does differently

Most note apps let you write. Cortex lets you *think*.

| Without Cortex | With Cortex |
|----------------|-------------|
| Searching your vault with Ctrl+F and hope | Ask a question in plain language — Cortex retrieves the right notes and synthesizes an answer |
| Forgetting what you wrote six months ago | Every note is indexed and retrievable by meaning, not just keywords |
| Notes that exist in isolation | Tag browser shows how ideas group and connect |
| No idea which topics are dense and which are thin | Tag browser shows your vault's regions at a glance with note counts per tag |
| Can't visualize how your ideas connect | Neural Pulse renders your vault as a living brain — ask a question and watch neurons light up as sources are retrieved |
| Tagging notes by hand, inconsistently | Auto-tagger analyzes content and suggests tags using AI — bulk or real-time |
| Never stumbling on old ideas | Discover mode serves random notes — rediscover what you forgot you knew |
| Missing connections you should have made | Link discovery finds notes that are semantically related but not yet linked |
| Can only write notes in Obsidian | Create new notes from the browser — folder picker, tag input, markdown editor with live preview |
| Digging through folders to find a specific note | File explorer sidebar with tree view, filter, and one-click open |
| Can't share a note without copying the whole thing | Public share links with expiration — one click, anyone can read it |
| Typing every query by hand | Conversational voice mode — speak, listen, repeat. Say "Hey Cortex" to wake it up |

---

## 🛠 Features

### Chat
- **RAG-backed Q&A** — Voyage embeddings + Upstash Vector search retrieves the most relevant notes for every query
- **Streamed responses** from Claude via Vercel AI SDK — fast, contextual, citation-backed
- **Session persistence** — conversations are saved and resumable from a sidebar
- **Guest chat** — unauthenticated visitors can chat with the vault (rate-limited, ephemeral, Haiku-backed)
- **Starter prompts** — tap-to-ask suggestions in guest mode for instant exploration
- **Web search** — prefix any message with `/web` to pull live results via Tavily
- **Vault search** — prefix any message with `/search` to search your vault inline without leaving chat
- **Image upload** — drag-and-drop or attach images to your messages for multimodal queries
- **Text-to-speech** — hear responses read aloud via ElevenLabs (browser fallback for guests)
- **Voice input** — speak your questions with browser speech recognition
- **Conversational mode** — toggle a continuous voice loop: speak → submit → response → TTS → auto-relisten
- **"Hey Cortex" wake phrase** — background listener activates voice input hands-free (Chrome/Edge)
- **Slash commands** — `/summarize`, `/connections`, `/gaps`, `/explain`, `/related`, `/timeline`, `/debate`
- **Memory** — Cortex learns your preferences, interests, and patterns from conversations and injects them into future context
- **Citation previews** — click any source citation to preview the full note content inline
- **Share from chat** — share any cited source note via a public expiring link, directly from the citation row

### Vault Exploration
| Feature | Description |
|---------|-------------|
| **File explorer** | Sidebar drawer with full folder tree, expand/collapse, filter by name or tag, note counts per folder, and one-click open in NoteViewer |
| **Tag browser** | Browse every tag in your vault, see note counts, expand to view tagged notes — filterable and mobile-friendly |
| **Discover** | Random note surfacing — tap shuffle to rediscover forgotten ideas with content previews, tags, and connection counts |
| **Note editor** | Create new notes from the browser — folder picker (with new folder creation), tags input with real-time AI suggestions, markdown editor with live preview |
| **Vault diagnostics** | Health indicators, orphan detection, link stats, sync status with one-click sync trigger, and a DNA-style fingerprint of your vault |
| **Topic clusters** | 2D scatter plot of your notes grouped by semantic similarity — pan, zoom, search, and inspect |
| **Neural Pulse** | Living neural network visualization — notes are neurons arranged by semantic similarity, with ambient breathing animations, pulse particles along synaptic connections, and RAG-driven activation via an embedded mini-chat. Procedural sound effects (Web Audio API) accompany neuron light-ups, pulse propagation, and cooldown |
| **Note lineage** | Which notes keep surfacing in your queries? Lineage tracks frequency and recency |
| **Link discovery** | Surfaces unlinked notes that should be connected based on content overlap |

### Auto-Tagging
- **Bulk auto-tag CLI** — `npm run auto-tag` sends every note's content to Claude Haiku and merges suggested tags into frontmatter. Max 5 tags per note, respects existing tags, uses your vault's tag vocabulary for consistency
- **Flags** — `--dry-run` (preview without writing), `--filter=folder/` (scope to a folder), `--model=` (override model)
- **Real-time tag suggestions** — as you type in the note editor, Cortex embeds your content, finds similar notes in the vector index, and surfaces their tags as clickable chips

### Public Sharing
- **Expiring share links** — share any note with a public URL that expires after 1h, 24h, 3 days, 7 days, or 30 days
- **Share from chat** — click SHARE on any citation to generate a link with an expiration picker and copy-to-clipboard
- **Share management** — view and revoke all active share links from the settings page
- **Minimal public page** — shared notes render with title, tags, content, and a "Shared from Cortex" footer — no auth required

### Scheduled Sync
- **Watch mode** — `npm run sync:watch` does an initial sync, then watches your vault for changes and incrementally syncs on save (1s debounce via chokidar)
- **Sync API** — `POST /api/sync` triggers a full sync from the web UI or external cron. Accepts JWT auth or a `x-cron-secret` header
- **Vercel cron** — automatic daily sync via `vercel.json` cron config
- **Sync from UI** — "Sync Now" button on the vault diagnostics page with "last synced" indicator

### Experience
- **Boot sequence** — terminal-style login animation with system checks, progress bar, and VaultDNA logo
- **Welcome greeting** — ElevenLabs voice greeting on login
- **Command palette** — `Cmd+K` / `Ctrl+K` to navigate, run commands, switch sessions, or fire slash commands
- **Personality sliders** — adjust formality, response length, challenge level, and creativity
- **Persistent memory** — preferences, interests, facts, and patterns with a management UI

---

## 🔒 Auth & Security

Cortex is designed to be deployed on the public internet as a personal tool.

- **Single-user setup** — password + TOTP MFA (scan a QR code on first run)
- **JWT sessions** with server-side revocation via Redis, 24h expiry, strict same-site cookies
- **Rate limiting** — Redis-backed INCR+EXPIRE on login and setup endpoints
- **TOTP replay prevention** — atomic set-if-not-exists prevents reuse of one-time codes
- **CSRF protection** — origin validation on all mutating requests
- **Guest mode** — unauthenticated visitors can chat (rate-limited via Haiku), browse tags, discover random notes, view vault diagnostics, and view shared notes (read-only, zero API cost on non-chat routes)
- **Protected routes** — full chat, web search, TTS, sessions, memory, lineage, clusters, neural pulse, note creation, file explorer, sharing management, sync, and settings require authentication
- **Public share routes** — `/share/{token}` and `/api/share/{token}` are accessible without auth; management routes (`POST/GET/DELETE /api/share`) require auth
- **Security headers** — CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Edge-compatible token revocation** — middleware checks JWT revocation via Upstash REST API before hitting any route

---

## ⚙️ Architecture

Cortex runs on **Vercel serverless functions** with all persistent state stored in **Upstash Redis** and embeddings in **Upstash Vector**. A dual-mode abstraction layer (`lib/kv.ts`) falls back to the local filesystem when Redis credentials are absent, so local development works without any cloud services.

### Data flow

```
Local vault (.md files)
        │
        ▼
  npm run sync          ← incremental sync via MD5 hashing
  npm run sync:watch    ← watch mode: auto-sync on file changes
  npm run auto-tag      ← AI-powered bulk tagging via Claude Haiku
        │
   ┌────┴────┐
   ▼         ▼
Upstash    Upstash
Redis      Vector
(notes,    (embeddings,
 shares,    1024-dim voyage-3)
 state)
   │         │
   └────┬────┘
        ▼
  Vercel serverless
  (Next.js API routes)
        │
        ▼
  Vercel cron (every 6h)
  → POST /api/sync
```

### Dual-mode storage

| Environment | State | Embeddings |
|-------------|-------|------------|
| **Vercel (production)** | Upstash Redis | Upstash Vector |
| **Local dev** | Filesystem (`.cortex-kv/`) | Upstash Vector (or skip if no key) |

Mode is determined automatically by the presence of `KV_REST_API_URL`.

---

## 🧩 Tech Stack

| Layer | Library |
|-------|---------|
| Framework | Next.js 16, React 19 |
| AI / LLM | Anthropic Claude via `@ai-sdk/anthropic` + Vercel AI SDK |
| Auto-tagging | `@anthropic-ai/sdk` direct (Claude Haiku) |
| Embeddings | Voyage AI (voyage-3, 1024 dimensions) |
| Vector store | Upstash Vector |
| KV / State | Upstash Redis |
| TTS | ElevenLabs |
| Web search | Tavily |
| File watching | chokidar |
| Auth | jose (JWT), bcrypt, otplib (TOTP), qrcode |
| Visualization | Canvas 2D, Web Audio API (procedural sound synthesis) |
| Styling | Tailwind CSS v4 |

---

## 🚀 Setup

### 1. Install dependencies

```bash
git clone <repo-url>
cd cortex
npm install
```

### 2. Configure environment variables

Create `.env.local` in the project root:

```env
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...
VAULT_PATH=/absolute/path/to/your/obsidian-vault

# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
JWT_SECRET=your-random-64-char-hex-string

# Upstash Redis (required for Vercel deployment)
KV_REST_API_URL=https://...upstash.io
KV_REST_API_TOKEN=AX...

# Upstash Vector (required for RAG)
UPSTASH_VECTOR_REST_URL=https://...upstash.io
UPSTASH_VECTOR_REST_TOKEN=...

# Optional — required for TTS
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...

# Optional — required for /web search
TAVILY_API_KEY=...

# Optional — required for Vercel cron sync
CRON_SECRET=your-random-secret
```

For **local development**, `KV_REST_API_URL` can be omitted — Cortex will use the filesystem for state. You still need `UPSTASH_VECTOR_REST_URL` and `VOYAGE_API_KEY` for embedding/search features.

### 3. Start the dev server

```bash
npm run dev
```

### 4. First-run enrollment

On first load, Cortex redirects to `/setup`:
1. Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)
2. Set your password (12+ characters, mixed case, digit, special character)
3. Enter the 6-digit TOTP code to verify enrollment

This is a one-time flow. After setup, you'll log in with password + MFA code.

### 5. Sync your vault

Push your vault content to Upstash Redis and generate embeddings in Upstash Vector:

```bash
npm run sync
```

The sync is **incremental** — it computes MD5 hashes per note and only re-processes changed files. Run it whenever your vault changes, or use watch mode for automatic syncing:

```bash
npm run sync:watch
```

Watch mode does an initial sync, then monitors your vault for file changes and incrementally re-syncs with a 1-second debounce.

For **local development**, the app reads directly from the filesystem at `VAULT_PATH`, so syncing is only required for the Vercel deployment.

### 6. Auto-tag your vault (optional)

Run the bulk auto-tagger to add AI-suggested tags to all your notes:

```bash
npm run auto-tag -- --dry-run     # preview suggestions without writing
npm run auto-tag                   # write tags to frontmatter
npm run auto-tag -- --filter=Projects/   # scope to a folder
npm run sync                       # sync updated tags to Redis
```

---

## 🗺 Routes

| Route | Auth | Description |
|-------|------|-------------|
| `/` | Guest | Chat — guest mode (vault-backed, ephemeral, rate-limited) or full interface when authenticated |
| `/vault` | Guest | Vault diagnostics, health, and sync controls |
| `/tags` | Guest | Tag browser — explore every tag and its notes |
| `/discover` | Guest | Random note discovery — shuffle through your vault |
| `/share/{token}` | Guest | Public shared note viewer — read-only, expiring |
| `/notes/new` | Required | Note editor — create new notes with folder picker, tags, and AI tag suggestions |
| `/clusters` | Required | Semantic topic clusters — 2D scatter plot with pan, zoom, and search |
| `/neural` | Required | Neural Pulse — living neural network visualization with chat-driven activation, pulse animations, and procedural sound effects |
| `/lineage` | Required | Note reference history |
| `/memory` | Required | Memory management |
| `/settings` | Required | AI personality sliders and shared links management |
| `/login` | — | Login |
| `/setup` | — | First-run enrollment |

Guest chat (`/api/chat/guest`) uses Claude Haiku, is limited to 500 character inputs, 500 output tokens, 10 messages/hour per IP, and 100 messages/day globally. No session or memory persistence.

Guest exploration routes (vault, tags, discover, shared notes) are read-only and make zero LLM/embedding API calls.

---

## 💬 Cortex in action

```
"What have I written about spaced repetition and how does it connect to my productivity notes?"

"Summarize everything I know about systems thinking"

"What connections exist between my notes on stoicism and cognitive behavioral therapy?"

"What am I missing or haven't written about regarding machine learning?"

"Challenge my understanding of free will based on what I've written"

"/web What are the latest developments in retrieval-augmented generation?"

"/search distributed systems" — search your vault inline

"Create a timeline of everything related to my career transition"

"What notes are related to my thesis outline that I haven't linked yet?"

[Toggle conversational mode → speak your questions → hear answers → auto-relisten]

[Say "Hey Cortex" → voice input activates hands-free]
```

---

## ☁️ Deploying to Vercel

1. Push the repo to GitHub
2. Import the project in Vercel
3. Add all environment variables from `.env.local` to your Vercel project settings (including `CRON_SECRET` for scheduled sync)
4. Deploy — the app uses serverless functions with Edge middleware
5. Run `npm run sync` locally (or in CI) to push vault content to Upstash

The filesystem is read-only on Vercel. All state (sessions, memory, personality, auth config, lineage, shares) is stored in Upstash Redis. Vault content and embeddings are pushed via `npm run sync`. The Vercel cron job triggers `/api/sync` daily at 6 AM UTC to re-index any pending changes.

---

## 📄 License

[MIT](./LICENSE) with [Commons Clause](https://commonsclause.com/)

Free to use, modify, and distribute for personal and noncommercial purposes. You may not sell the software or offer it as a paid product or service.
