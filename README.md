# Cortex

> Your second brain, wired up.

Your Obsidian vault is full of ideas — but you can't grep intuition. **Cortex** is a web app that gives your vault a voice. Ask it questions, and it pulls the right notes, threads the connections, and answers with the full weight of everything you've ever written. It doesn't just search — it *understands*.

**RAG-powered chat. Tag browser. Random discovery. Note creation. One vault that finally talks back.**

---

## ⚡ What Cortex does differently

Most note apps let you write. Cortex lets you *think*.

| Without Cortex | With Cortex |
|----------------|-------------|
| Searching your vault with Ctrl+F and hope | Ask a question in plain language — Cortex retrieves the right notes and synthesizes an answer |
| Forgetting what you wrote six months ago | Every note is indexed and retrievable by meaning, not just keywords |
| Notes that exist in isolation | Tag browser shows how ideas group and connect |
| No idea which topics are dense and which are thin | Tag browser shows your vault's regions at a glance with note counts per tag |
| Never stumbling on old ideas | Discover mode serves random notes — rediscover what you forgot you knew |
| Missing connections you should have made | Link discovery finds notes that are semantically related but not yet linked |
| Can only write notes in Obsidian | Create new notes from the browser — folder picker, tag input, markdown editor with live preview |

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
- **Slash commands** — `/summarize`, `/connections`, `/gaps`, `/explain`, `/related`, `/timeline`, `/debate`
- **Memory** — Cortex learns your preferences, interests, and patterns from conversations and injects them into future context
- **Citation previews** — click any source citation to preview the full note content inline

### Vault Exploration
| Feature | Description |
|---------|-------------|
| **Tag browser** | Browse every tag in your vault, see note counts, expand to view tagged notes — filterable and mobile-friendly |
| **Discover** | Random note surfacing — tap shuffle to rediscover forgotten ideas with content previews, tags, and connection counts |
| **Note editor** | Create new notes from the browser — folder picker (with new folder creation), tag input, markdown editor with live preview |
| **Vault diagnostics** | Health indicators, orphan detection, link stats, and a DNA-style fingerprint of your vault |
| **Topic clusters** | 2D scatter plot of your notes grouped by semantic similarity — pan, zoom, search, and inspect |
| **Note lineage** | Which notes keep surfacing in your queries? Lineage tracks frequency and recency |
| **Link discovery** | Surfaces unlinked notes that should be connected based on content overlap |

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
- **Guest mode** — unauthenticated visitors can chat (rate-limited via Haiku), browse tags, discover random notes, and view vault diagnostics (read-only, zero API cost on non-chat routes)
- **Protected routes** — full chat, web search, TTS, sessions, memory, lineage, clusters, note creation, and settings require authentication
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
        │
   ┌────┴────┐
   ▼         ▼
Upstash    Upstash
Redis      Vector
(notes,    (embeddings,
 state)     1024-dim voyage-3)
   │         │
   └────┬────┘
        ▼
  Vercel serverless
  (Next.js API routes)
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
| Embeddings | Voyage AI (voyage-3, 1024 dimensions) |
| Vector store | Upstash Vector |
| KV / State | Upstash Redis |
| TTS | ElevenLabs |
| Web search | Tavily |
| Auth | jose (JWT), bcrypt, otplib (TOTP), qrcode |
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

The sync is **incremental** — it computes MD5 hashes per note and only re-processes changed files. Run it whenever your vault changes, or set up a cron job / CI workflow.

For **local development**, the app reads directly from the filesystem at `VAULT_PATH`, so syncing is only required for the Vercel deployment.

---

## 🗺 Routes

| Route | Auth | Description |
|-------|------|-------------|
| `/` | Guest | Chat — guest mode (vault-backed, ephemeral, rate-limited) or full interface when authenticated |
| `/vault` | Guest | Vault diagnostics and health |
| `/tags` | Guest | Tag browser — explore every tag and its notes |
| `/discover` | Guest | Random note discovery — shuffle through your vault |
| `/notes/new` | Required | Note editor — create new notes with folder picker and tags |
| `/clusters` | Required | Semantic topic clusters — 2D scatter plot with pan, zoom, and search |
| `/lineage` | Required | Note reference history |
| `/memory` | Required | Memory management |
| `/settings` | Required | AI personality sliders |
| `/login` | — | Login |
| `/setup` | — | First-run enrollment |

Guest chat (`/api/chat/guest`) uses Claude Haiku, is limited to 500 character inputs, 500 output tokens, 10 messages/hour per IP, and 100 messages/day globally. No session or memory persistence.

Guest exploration routes (vault, tags, discover) are read-only and make zero LLM/embedding API calls.

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
```

---

## ☁️ Deploying to Vercel

1. Push the repo to GitHub
2. Import the project in Vercel
3. Add all environment variables from `.env.local` to your Vercel project settings
4. Deploy — the app uses serverless functions with Edge middleware
5. Run `npm run sync` locally (or in CI) to push vault content to Upstash

The filesystem is read-only on Vercel. All state (sessions, memory, personality, auth config, lineage) is stored in Upstash Redis. Vault content and embeddings are pushed via `npm run sync`.

---

## 📄 License

[MIT](./LICENSE) with [Commons Clause](https://commonsclause.com/)

Free to use, modify, and distribute for personal and noncommercial purposes. You may not sell the software or offer it as a paid product or service.
