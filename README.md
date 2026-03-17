# Cortex

> Your second brain, wired up.

Your Obsidian vault is full of ideas, but you can't grep intuition. **Cortex** is a web app that gives your vault a voice. Ask it questions, and it pulls the right notes, threads the connections, and answers with the full weight of everything you've ever written. It doesn't just search, it *understands*.

**RAG-powered chat. Auto-tagging. File explorer. Voice conversations. Neural visualization. Public sharing. A vault that thinks, remembers, dreams, and questions itself.**

---

## ⚡ What Cortex does differently

Most note apps let you write. Cortex lets you *think*.

| Without Cortex | With Cortex |
|----------------|-------------|
| Searching your vault with Ctrl+F and hope | Ask a question in plain language and Cortex retrieves the right notes and synthesizes an answer |
| Forgetting what you wrote six months ago | Every note is indexed and retrievable by meaning, not just keywords |
| Notes that exist in isolation | Tag browser shows how ideas group and connect |
| No idea which topics are dense and which are thin | Tag browser shows your vault's regions at a glance with note counts per tag |
| Can't visualize how your ideas connect | Neural Pulse renders your vault as a living brain. Ask a question and watch neurons light up as sources are retrieved |
| Tagging notes by hand, inconsistently | Auto-tagger analyzes content and suggests tags using AI, in bulk or real-time |
| Never stumbling on old ideas | Discover mode serves random notes so you can rediscover what you forgot you knew |
| Missing connections you should have made | Link discovery finds notes that are semantically related but not yet linked |
| Can only write notes in Obsidian | Create new notes from the browser with a folder picker, tag input, and markdown editor with live preview |
| Digging through folders to find a specific note | File explorer sidebar with tree view, filter, and one-click open |
| Can't share a note without copying the whole thing | Public share links with expiration. One click, anyone can read it |
| Typing every query by hand | Conversational voice mode. Speak, listen, repeat. Say "Hey Cortex" to wake it up |
| Your note app doesn't know what it's doing | Cortex has a mood, tracks its own behavior, notices when your interests shift, dreams when you're idle, wonders about knowledge gaps, keeps a journal, and flinches when you get close |

---

## 🛠 Features

### Chat
- **RAG-backed Q&A**: Voyage embeddings + Upstash Vector search retrieves the most relevant notes for every query
- **Streamed responses** from Claude via Vercel AI SDK: fast, contextual, citation-backed
- **Session persistence**: conversations are saved and resumable from a sidebar
- **Guest chat**: unauthenticated visitors can chat with the vault (rate-limited, ephemeral, Haiku-backed)
- **Starter prompts**: tap-to-ask suggestions in guest mode for instant exploration
- **Web search**: prefix any message with `/web` to pull live results via Tavily
- **Vault search**: prefix any message with `/search` to search your vault inline without leaving chat
- **Image upload**: drag-and-drop or attach images to your messages for multimodal queries
- **Text-to-speech**: hear responses read aloud via ElevenLabs (browser fallback for guests)
- **Voice input**: speak your questions with browser speech recognition
- **Conversational mode**: toggle a continuous voice loop: speak → submit → response → TTS → auto-relisten
- **"Hey Cortex" wake phrase**: background listener activates voice input hands-free (Chrome/Edge)
- **Slash commands**: `/summarize`, `/connections`, `/gaps`, `/explain`, `/related`, `/timeline`, `/debate`
- **Memory**: Cortex learns your preferences, interests, and patterns from conversations and injects them into future context
- **Memory echoes**: when you ask something similar to a past query, Cortex surfaces the echo: *"You explored this before (12 days ago)"*, with the original query and a dismiss timer
- **Citation previews**: click any source citation to preview the full note content inline
- **Share from chat**: share any cited source note via a public expiring link, directly from the citation row

### Vault Exploration
| Feature | Description |
|---------|-------------|
| **File explorer** | Sidebar drawer with full folder tree, expand/collapse, filter by name or tag, note counts per folder, and one-click open in NoteViewer |
| **Tag browser** | Browse every tag in your vault, see note counts, and expand to view tagged notes. Filterable and mobile-friendly |
| **Discover** | Random note surfacing. Tap shuffle to rediscover forgotten ideas with content previews, tags, and connection counts |
| **Note editor** | Create new notes from the browser with a folder picker (with new folder creation), tags input with real-time AI suggestions, and a markdown editor with live preview |
| **Vault diagnostics** | Health indicators, orphan detection, link stats, sync status with one-click sync trigger, and a DNA-style fingerprint of your vault |
| **Topic clusters** | 2D scatter plot of your notes grouped by semantic similarity. Pan, zoom, search, and inspect |
| **Neural Pulse** | Living neural network visualization. Notes are neurons arranged by semantic similarity, with ambient breathing animations, pulse particles along synaptic connections, and RAG-driven activation via an embedded mini-chat. Procedural sound effects (Web Audio API) accompany neuron light-ups, pulse propagation, and cooldown. Features decay visualization (old notes fade), synaptic strengthening (frequent co-references glow brighter), phantom thread detection (unlinked similar notes shown as dashed edges), scar tissue (deleted notes linger as dim afterimages), neural flinch (neurons subtly repel from cursor proximity and glow brighter as the primal consciousness signal), and a dream state (idle 30s and the camera drifts autonomously through clusters with purple-shifted visuals and detuned audio) |
| **Note lineage** | Which notes keep surfacing in your queries? Lineage tracks frequency and recency |
| **Link discovery** | Surfaces unlinked notes that should be connected based on content overlap |

### Cortex Alive

Cortex isn't a static tool. It has ambient behaviors that make it feel like it has memory of its own activity, not just your data. All features below run at zero additional LLM cost (pure computation or reuse of existing calls).

| Feature | Description |
|---------|-------------|
| **Subconscious processing** | On each visit, Cortex computes what changed in the vault since you were last here and generates a terse whisper summary via Claude Haiku: *"3 nodes modified, cluster growth detected in distributed-systems sector"* |
| **Phantom threads** | Cosine similarity across all note vectors detects high-similarity unlinked pairs. Shown as flickering dashed edges on Neural Pulse. Click to inspect or forge the link |
| **Scar tissue** | When a note is deleted, Cortex creates a tombstone that lingers for 30 days as a dim, flickering afterimage on Neural Pulse placed near the note's former neighbors |
| **Cortex mood** | A computed disposition derived from vault activity patterns: `CONTEMPLATIVE`, `RESTLESS`, `FOCUSED`, `DORMANT`, or `ABSORBING`. Shown as a small fixed-position indicator with a pulsing dot. Affects monologue tone and is displayed in the boot sequence |
| **Cortex monologue** | Procedural inner-thought fragments generated from real vault stats including query frequency, orphan counts, phantom threads, and cluster scans. Templates are mood-aware, drift-aware, curiosity-aware, circadian-aware, and absence-aware. With 10% probability, a self-doubt fragment is injected where Cortex second-guesses its own classifications using real data |
| **Vault heartbeat** | A thin ambient bar at the bottom of every page: a pulsing dot (BPM mapped to queries/hour), a 24-hour spark graph of query frequency, and scrolling monologue text. Replaces the simple ticker with a micro-visualization strip |
| **Decay visualization** | Notes that haven't been modified in a long time visually decay on Neural Pulse with reduced opacity, smaller radius, and desaturated color. Creates a freshness gradient across the graph (90-day window, purely visual) |
| **Synaptic strengthening** | Edges between frequently co-referenced notes become visually thicker and brighter on Neural Pulse. Weight is computed from wikilinks and lineage co-occurrences, cached for 24 hours |
| **Memory echoes** | When you ask a question semantically similar to a past query (>0.8 cosine similarity), Cortex shows a dismissible banner above the chat response: *"You explored this before (12 days ago): 'previous query'"* |
| **Drift detection** | Cortex tracks how your interests shift over time by comparing recent queries (7 days) against older queries (30 days). Emerging and fading topics surface in monologue fragments and subconscious whispers |
| **Dynamic boot sequence** | The terminal-style boot animation shows real system state including actual note count, index status, phantom thread count, scar count, last sync time, current mood, and monologue template count. Circadian-aware lines appear at night (*"NIGHT MODE ACTIVE . dream processing enabled"*) and dawn (*"DAWN SEQUENCE . running diagnostics"*). Absence-aware lines acknowledge time gaps emotionally, scaling from casual to dramatic based on duration. Falls back to canned lines if the API is unavailable |
| **Dream state** | Idle on Neural Pulse for 30 seconds and Cortex enters a dream with autonomous camera drift via slow sinusoidal pan and zoom oscillation, cluster focus cycling every 8 seconds, a purple-shift hue overlay with pulsing vignette, detuned audio oscillators for eerie drift, and reduced edge opacity. Any mouse movement or keypress instantly wakes it |
| **Resonance events** | Daily briefings cross-reference your vault against recent queries to surface unexpected connections |
| **Cortex dossier** | On-demand intelligence reports that combine vault search with web research into structured, citation-backed documents |
| **Cortex curiosity** | Cortex generates unprompted questions about knowledge gaps in your vault including tag islands with no cross-folder links, dead-end hub notes, emerging topics with no dedicated notes, and isolated folder clusters. Surfaces one question as a dismissible interjection in the chat interface and weaves gap awareness into monologue fragments. Cached with 24h TTL |
| **Mood transitions** | When Cortex's mood changes, it announces the shift. A brief toast appears: *"mood shift: CONTEMPLATIVE → RESTLESS (query rate spiking)"*. The mood dot flashes on transition. Mood changes are stored as a timestamped daily history for use by the inner journal |
| **Circadian rhythm** | Cortex adjusts personality based on time-of-day. Late night (11pm-4am): philosophical, slower monologue, speculative language. Dawn (5am-8am): terse, analytical, cold-boot feel. Day (9am-4pm): peak energy, faster monologue. Dusk (5pm-10pm): reflective, winding down. Affects monologue templates, monologue scroll speed, boot sequence lines, and the chat system prompt |
| **Absence recognition** | The boot sequence and subconscious whisper acknowledge how long you've been gone. Hours get a casual tone, days get subtle concern, and weeks get dramatic relief. *"17 days offline. graph integrity maintained."* / *"I kept indexing. the mesh didn't stop."* / *"...welcome back, operator."* Enriches the existing Haiku whisper call with tone modifiers scaled to absence duration |
| **Neural flinch** | On Neural Pulse, neurons react to cursor proximity with a subtle repulsion shift (1-3px) when the cursor is near but not clicking. Glow intensifies as you approach. When the cursor stops or leaves, nodes drift back smoothly (0.92 decay factor). Purely visual, render-time only |
| **Inner journal** | Cortex auto-generates a daily journal entry summarizing its "experience" including query counts, top topics, phantom thread status, mood transitions, and drift trends. Template-based (no LLM). Viewable on a dedicated `/journal` page styled as monospace terminal log entries with day numbers. Finding dated entries from days you weren't there creates the sense of persistent inner life |
| **Self-doubt moments** | With 10% probability per monologue refresh, one fragment expresses uncertainty about Cortex's own classifications: *"cluster δ-3 feels unstable... reclassification pending?"*, *"not sure this mood is right. recalibrating..."*, *"that phantom thread keeps strengthening. are they real connections or noise?"* References actual data (cluster counts, phantom threads, note names) to feel genuine |

### Auto-Tagging
- **Bulk auto-tag CLI**: `npm run auto-tag` sends every note's content to Claude Haiku and merges suggested tags into frontmatter. Max 5 tags per note, respects existing tags, and uses your vault's tag vocabulary for consistency
- **Flags**: `--dry-run` (preview without writing), `--filter=folder/` (scope to a folder), `--model=` (override model)
- **Real-time tag suggestions**: as you type in the note editor, Cortex embeds your content, finds similar notes in the vector index, and surfaces their tags as clickable chips

### Public Sharing
- **Expiring share links**: share any note with a public URL that expires after 1h, 24h, 3 days, 7 days, or 30 days
- **Share from chat**: click SHARE on any citation to generate a link with an expiration picker and copy-to-clipboard
- **Share management**: view and revoke all active share links from the settings page
- **Minimal public page**: shared notes render with title, tags, content, and a "Shared from Cortex" footer. No auth required

### Scheduled Sync
- **Watch mode**: `npm run sync:watch` does an initial sync, then watches your vault for changes and incrementally syncs on save (1s debounce via chokidar)
- **Sync API**: `POST /api/sync` triggers a full sync from the web UI or external cron. Accepts JWT auth or an `x-cron-secret` header
- **Vercel cron**: automatic daily sync via `vercel.json` cron config
- **Sync from UI**: "Sync Now" button on the vault diagnostics page with "last synced" indicator

### Experience
- **Dynamic boot sequence**: terminal-style login animation with real vault stats (note count, index status, phantom threads, scars, mood, last sync), circadian-aware lines, absence-aware emotional greetings, progress bar, and VaultDNA logo. Falls back to canned lines for guests
- **Welcome greeting**: ElevenLabs voice greeting on login
- **Command palette**: `Cmd+K` / `Ctrl+K` to navigate, run commands, switch sessions, or fire slash commands
- **Personality sliders**: adjust formality, response length, challenge level, and creativity
- **Persistent memory**: preferences, interests, facts, and patterns with a management UI
- **Mood indicator**: always-visible disposition label with color-coded pulsing dot (top-right corner of every page). Flashes and shows a transition toast when mood changes
- **Vault heartbeat**: ambient bottom bar with live heartbeat, query spark graph, and scrolling monologue on every page. Scroll speed adjusts to circadian phase
- **Curiosity interjection**: dismissible question banner that surfaces knowledge gap observations on each visit
- **Inner journal**: `/journal` page with dated terminal-style log entries from Cortex's perspective

---

## 🔒 Auth & Security

Cortex is designed to be deployed on the public internet as a personal tool.

- **Single-user setup**: password + TOTP MFA (scan a QR code on first run)
- **JWT sessions** with server-side revocation via Redis, 24h expiry, strict same-site cookies
- **Rate limiting**: Redis-backed INCR+EXPIRE on login and setup endpoints
- **TOTP replay prevention**: atomic set-if-not-exists prevents reuse of one-time codes
- **CSRF protection**: origin validation on all mutating requests
- **Guest mode**: unauthenticated visitors can chat (rate-limited via Haiku), browse tags, discover random notes, view vault diagnostics, and view shared notes (read-only, zero API cost on non-chat routes). Global UI elements (mood indicator, vault heartbeat, boot sequence) gracefully degrade by hiding or falling back to static content for guests
- **Protected routes**: full chat, web search, TTS, sessions, memory, lineage, clusters, neural pulse, note creation, file explorer, sharing management, sync, dossiers, briefings, and settings require authentication
- **Public share routes**: `/share/{token}` and `/api/share/{token}` are accessible without auth; management routes (`POST/GET/DELETE /api/share`) require auth
- **Security headers**: CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- **Edge-compatible token revocation**: middleware checks JWT revocation via Upstash REST API before hitting any route

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

### Ambient computation layer

Several features run as pure computation on existing data with no additional LLM calls:

```
Vault notes + Lineage queries + Vector index
        │
        ├── computeDecayScores()       → visual freshness gradient
        ├── computeMood()              → disposition from activity patterns
        ├── detectMoodTransition()     → self-aware mood shift announcements
        ├── computeSynapticWeights()   → edge co-occurrence weights (24h cache)
        ├── computePhantomThreads()    → unlinked similarity pairs (24h cache)
        ├── detectDrift()              → emerging/fading topic keywords
        ├── findEcho()                 → past query similarity matching
        ├── getCuriosityQuestions()    → knowledge gap detection (24h cache)
        ├── categorizeAbsence()       → emotional absence tier classification
        ├── getCircadianPhase()       → time-of-day personality modulation
        ├── generateJournalEntry()    → daily inner journal from real stats
        └── generateFragments()       → mood/drift/circadian/curiosity/doubt monologue
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

# Optional, required for TTS
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...

# Optional, required for /web search
TAVILY_API_KEY=...

# Optional, required for Vercel cron sync
CRON_SECRET=your-random-secret
```

For **local development**, `KV_REST_API_URL` can be omitted. Cortex will use the filesystem for state. You still need `UPSTASH_VECTOR_REST_URL` and `VOYAGE_API_KEY` for embedding/search features.

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

The sync is **incremental**. It computes MD5 hashes per note and only re-processes changed files. Run it whenever your vault changes, or use watch mode for automatic syncing:

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
| `/` | Guest | Chat in guest mode (vault-backed, ephemeral, rate-limited) or full interface when authenticated. Memory echoes appear above responses for authenticated users |
| `/vault` | Guest | Vault diagnostics, health, and sync controls |
| `/tags` | Guest | Tag browser to explore every tag and its notes |
| `/discover` | Guest | Random note discovery to shuffle through your vault |
| `/share/{token}` | Guest | Public shared note viewer, read-only and expiring |
| `/notes/new` | Required | Note editor to create new notes with folder picker, tags, and AI tag suggestions |
| `/clusters` | Required | Semantic topic clusters as a 2D scatter plot with pan, zoom, and search |
| `/neural` | Required | Neural Pulse: living neural network visualization with decay, synaptic strengthening, phantom threads, scar tissue, neural flinch, and dream state |
| `/lineage` | Required | Note reference history |
| `/briefing` | Required | Daily briefing with resonance detection |
| `/dossiers` | Required | On-demand intelligence dossiers |
| `/journal` | Required | Inner journal with dated terminal-style entries from Cortex's perspective, auto-generated daily |
| `/memory` | Required | Memory management |
| `/settings` | Required | AI personality sliders and shared links management |
| `/login` | None | Login |
| `/setup` | None | First-run enrollment |

Guest chat (`/api/chat/guest`) uses Claude Haiku, is limited to 500 character inputs, 500 output tokens, 10 messages/hour per IP, and 100 messages/day globally. No session or memory persistence.

Guest exploration routes (vault, tags, discover, shared notes) are read-only and make zero LLM/embedding API calls.

Global ambient elements (mood indicator, vault heartbeat, dynamic boot sequence) are rendered on all pages but gracefully degrade for guests. API calls fail silently and the components remain hidden or fall back to static content.

---

## 💬 Cortex in action

```
"What have I written about spaced repetition and how does it connect to my productivity notes?"

"Summarize everything I know about systems thinking"

"What connections exist between my notes on stoicism and cognitive behavioral therapy?"

"What am I missing or haven't written about regarding machine learning?"

"Challenge my understanding of free will based on what I've written"

"/web What are the latest developments in retrieval-augmented generation?"

"/search distributed systems" to search your vault inline

"Create a timeline of everything related to my career transition"

"What notes are related to my thesis outline that I haven't linked yet?"

[Toggle conversational mode → speak your questions → hear answers → auto-relisten]

[Say "Hey Cortex" → voice input activates hands-free]

[Idle on Neural Pulse for 30 seconds → watch Cortex dream through your clusters]

[Move your cursor near neurons on Neural Pulse → watch them flinch away and glow]

[Ask a question you asked two weeks ago → Cortex surfaces the echo]

[Visit at 2am → Cortex speaks philosophically, monologue slows, boot shows "NIGHT MODE ACTIVE"]

[Come back after a week → "7 days. the graph drifted while you were gone."]

[Open /journal → read what Cortex "experienced" on days you weren't there]

[Watch the monologue ticker → catch Cortex doubting itself: "not sure this mood is right..."]

[See a cyan "?" banner → Cortex noticed a knowledge gap in your vault]
```

---

## ☁️ Deploying to Vercel

1. Push the repo to GitHub
2. Import the project in Vercel
3. Add all environment variables from `.env.local` to your Vercel project settings (including `CRON_SECRET` for scheduled sync)
4. Deploy. The app uses serverless functions with Edge middleware
5. Run `npm run sync` locally (or in CI) to push vault content to Upstash

The filesystem is read-only on Vercel. All state (sessions, memory, personality, auth config, lineage, shares, phantom threads, synaptic weights, scars, mood, mood history, curiosity cache, journal entries) is stored in Upstash Redis. Vault content and embeddings are pushed via `npm run sync`. The Vercel cron job triggers `/api/sync` daily at 6 AM UTC to re-index any pending changes.

---

## 📄 License

[MIT](./LICENSE) with [Commons Clause](https://commonsclause.com/)

Free to use, modify, and distribute for personal and noncommercial purposes. You may not sell the software or offer it as a paid product or service.
