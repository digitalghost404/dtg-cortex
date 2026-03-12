# Cortex

> Your second brain, wired up.

Your Obsidian vault is full of ideas — but you can't grep intuition. **Cortex** is a web app that gives your vault a voice. Ask it questions, and it pulls the right notes, threads the connections, and answers with the full weight of everything you've ever written. It doesn't just search — it *understands*.

**RAG-powered chat. Live knowledge graph. Semantic clusters. One vault that finally talks back.**

---

## ⚡ What Cortex does differently

Most note apps let you write. Cortex lets you *think*.

| Without Cortex | With Cortex |
|----------------|-------------|
| Searching your vault with Ctrl+F and hope | Ask a question in plain language — Cortex retrieves the right notes and synthesizes an answer |
| Forgetting what you wrote six months ago | Every note is indexed and retrievable by meaning, not just keywords |
| Notes that exist in isolation | A live knowledge graph shows how every idea connects to every other |
| No idea which topics are dense and which are thin | Semantic cluster map groups your notes by theme — see your vault's regions at a glance |
| Manually reviewing stale notes | Ambient mode surfaces forgotten notes, quotes, stats, and "on this day" flashbacks |
| Wondering if two ideas are related | Note lineage tracks which notes appear together across your queries over time |
| Missing connections you should have made | Link discovery finds notes that are semantically related but not yet linked |

---

## 🧠 Features

### Chat
- **RAG-backed Q&A** — Voyage embeddings + Vectra vector search retrieves the most relevant notes for every query
- **Streamed responses** from Claude via Vercel AI SDK — fast, contextual, citation-backed
- **Session persistence** — conversations are saved and resumable from a sidebar
- **Web search** — prefix any message with `/web` to pull live results via Tavily
- **Text-to-speech** — hear responses read aloud via ElevenLabs
- **Voice input** — speak your questions with browser speech recognition
- **Slash commands** — `/summarize`, `/connections`, `/gaps`, `/explain`, `/related`, `/timeline`, `/debate`
- **Memory** — Cortex learns your preferences, interests, and patterns from conversations and injects them into future context

### Vault exploration
- **Knowledge graph** — interactive d3-force canvas with live file watcher integration — see changes pulse through the graph in real time
- **Topic clusters** — 2D scatter plot of your notes grouped by semantic similarity
- **Vault diagnostics** — health indicators, orphan detection, link stats, and a DNA-style fingerprint of your vault
- **Note lineage** — which notes keep surfacing in your queries? Lineage tracks frequency and recency
- **Link discovery** — surfaces unlinked notes that should be connected based on content overlap
- **Ambient mode** — a lean-back display that cycles through quotes, stats, forgotten notes, tag clouds, and "on this day" memories
- **Digest** — AI-generated summary of vault activity and notable connections

### Personalisation
- **Personality sliders** — adjust formality, response length, challenge level, and creativity
- **Persistent memory** — preferences, interests, facts, and patterns with a management UI

---

## 🔒 Auth

Cortex is designed to be deployed on the public internet as a personal tool.

- **Single-user setup** — password + TOTP MFA (scan a QR code on first run)
- **JWT sessions** with server-side revocation, 24h expiry, strict same-site cookies
- **Rate limiting** on login and setup endpoints
- **Guest mode** — unauthenticated visitors can explore the graph, vault diagnostics, clusters, and ambient mode (read-only, zero API cost)
- **Protected routes** — chat, web search, TTS, sessions, memory, lineage, digest, and settings require authentication
- **Security headers** — CSP, HSTS, X-Frame-Options DENY, origin validation on all mutations

---

## 🛠 Tech stack

| Layer | Library |
|-------|---------|
| Framework | Next.js 16, React 19 |
| AI / LLM | Anthropic Claude via `@ai-sdk/anthropic` + Vercel AI SDK |
| Embeddings | Voyage AI |
| Vector store | Vectra (local, file-based) |
| TTS | ElevenLabs |
| Web search | Tavily |
| Graph | d3-force |
| Auth | jose (JWT), bcrypt, otplib (TOTP), qrcode |
| Styling | Tailwind CSS v4 |
| Vault watch | chokidar |

No external database. All state lives on the local filesystem.

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

# Optional — required for TTS
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...

# Optional — required for /web search
TAVILY_API_KEY=...
```

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

### 5. Index your vault

After logging in, hit **INIT VAULT INDEX** from the chat page. This reads every `.md` file in your vault, chunks it, generates Voyage embeddings, and builds a local Vectra index. Leave the file watcher running to pick up changes automatically.

---

## 🗺 Routes

| Route | Auth | Description |
|-------|------|-------------|
| `/` | Required | Chat — the main interface |
| `/graph` | Guest | Interactive knowledge graph |
| `/vault` | Guest | Vault diagnostics and health |
| `/clusters` | Guest | Semantic topic clusters |
| `/ambient` | Guest | Ambient display mode |
| `/digest` | Required | AI-generated vault digest |
| `/lineage` | Required | Note reference history |
| `/memory` | Required | Memory management |
| `/settings` | Required | AI personality sliders |
| `/login` | — | Login |
| `/setup` | — | First-run enrollment |

Guest routes are read-only and make zero LLM/embedding API calls.

---

## 💬 Cortex in action

```
"What have I written about spaced repetition and how does it connect to my productivity notes?"

"Summarize everything I know about systems thinking"

"What connections exist between my notes on stoicism and cognitive behavioral therapy?"

"What am I missing or haven't written about regarding machine learning?"

"Challenge my understanding of free will based on what I've written"

"/web What are the latest developments in retrieval-augmented generation?"

"Create a timeline of everything related to my career transition"

"What notes are related to my thesis outline that I haven't linked yet?"
```

---

## 📦 Building for production

```bash
npm run build
npm start
```

Deploy behind HTTPS. The `JWT_SECRET` and all API keys should be injected via your hosting platform's secret store — not committed to the repo.

---

## 📄 License

[MIT](./LICENSE) with [Commons Clause](https://commonsclause.com/)

Free to use, modify, and distribute for personal and noncommercial purposes. You may not sell the software or offer it as a paid product or service.
