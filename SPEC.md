# Pokaico — v0.1 Architecture Decision Record

Cozy AI Workspace. A personal "Pokai" companion that truly understands you.
Pixel art aesthetic, cozy style. Build start · v0.1.

## 1. Decision summary

| Layer | Decision | Why (short) |
|---|---|---|
| Desktop shell | **Tauri 2** | Already decided. Rust core + web frontend, small binary, sidecar support for a Node backend. |
| Frontend framework | **React** | |
| Language / runtime | **TypeScript / Node.js**, single language end-to-end | Frontend is already JS/TS under Tauri; keeping the agent backend in TS means one ecosystem, one package manager, and native compatibility with models.dev's own SDK. |
| Agent framework | **Mastra** | TS-native agent framework (not a Python port). Ships agents, tools, workflows, memory hooks, evals, and MCP support in one package — you'll only use the "agent + tools + workflow" primitives in v0.1 and grow into workflows/MCP for v0.2 agentic features. |
| Model provider layer | **Vercel AI SDK** (`ai` package) + **models.dev** catalog (`@opencode-ai/models` or its raw JSON/TOML feed) | Mastra is built on top of the AI SDK, so this isn't an extra dependency — models.dev exists specifically to feed AI-SDK-shaped provider configs, so you get "any provider, any model" without hand-maintaining a model-name enum. |
| Embedding model | **E5-small** (Python sidecar via `sentence-transformers`) | 334M params, 100+ languages, 384-dim, retrieval-optimized (asymmetric `query:`/`passage:` prefix), runs on CPU via Python sidecar — ~150MB RAM, drops `onnxruntime-node` dependency. |
| Backend database | **SQLite** (via `better-sqlite3` or `libsql`) + **sqlite-vec** extension + **FTS5** | One embedded file, zero server, hybrid (vector + keyword) search in one engine. Crucially: this DB is a *disposable index*, not a source of truth — the markdown files are — so simplicity and rebuildability beat raw vector-search ceiling. |
| Memory system | **Pokaico** (custom, filesystem-based, as you've specified) | No change — this is your differentiator, not a place to bolt on a generic framework. |
| Document extraction | **Xberg** (Rust core, `@xberg-io/xberg`) | 96 formats (PDF, DOCX, XLSX, PPTX, HTML, CSV, images, email, code), auto-detect MIME, auto-routing. OCR built-in via multiple backends (Candle GLM-OCR default). One dependency replaces pdf-oxide + office-oxide + custom pipeline. |

---

## 2. Why TypeScript over Python (the framework decision)

You said "agent-friendly, up-to-date, with AI skills." Walking through the actual constraints:

- **models.dev's canonical SDK is npm** (`@opencode-ai/models`), and it's designed to slot straight into the Vercel AI SDK's provider registry. In Python you'd be hand-writing the provider→model mapping yourself (doable, but it's exactly the "custom-write model names per provider" work you said you want to avoid).
- **Mastra vs. Python equivalents (LangGraph, PydanticAI):** as of mid-2026, Mastra is the framework consultancies and production teams are converging on for TS specifically because it bundles agents + workflows + memory + evals + MCP without LangChain's abstraction overhead, and it doesn't suffer the "TS port lags Python by weeks" problem that `@langchain/langgraph` has. Since your desktop shell (Tauri) and frontend are already JS/TS, staying in one language removes an entire class of IPC/serialization friction.
- **Python's edge would be** ML-heavy local inference (e.g., if you later want to fine-tune, run bigger local models, or do heavier CV/audio work). None of that is in v0.1 scope. If a specific v0.2+ feature needs Python (e.g. a sandboxed code-execution tool), Tauri supports a **second sidecar** — you're not locked out of Python, you just don't need it as the *orchestration* language.

### On "AI Skills" specifically
Don't pick a framework based on which one has a "Skills" feature bolted on — **Agent Skills (the `SKILL.md` folder convention)** is framework-agnostic. It's just:
1. A directory convention (`SKILL.md` + supporting files),
2. A short "here are your available skills" index in the system prompt,
3. A tool that lets the agent `read`/`view` a skill file on demand (progressive disclosure — load only when relevant).

You can implement this yourself as a Mastra tool (`readSkill(name)`) in an afternoon. Treat it as a v0.2 agentic feature (you already scoped it that way) rather than a framework-selection criterion.

---

## 3. Process architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Tauri Shell (Rust)                                           │
│  - Window management, OS integration, filesystem permissions │
│  - Spawns/monitors the Node sidecar process                  │
└───────────────┬───────────────────────────────────────────────┘
                │ IPC (stdio or localhost HTTP)
┌───────────────▼───────────────────────────────────────────────┐
│ Frontend (React/Svelte/Vue + Tauri webview)                   │
│  - Pixel-art cozy UI, chat-as-journal interface                │
└───────────────┬───────────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────────┐
│ Node.js Sidecar (bundled via Tauri sidecar / pkg)              │
│                                                                 │
│  Mastra Agent Runtime                                          │
│   - Agent + tools (models.dev-backed model calls via AI SDK)   │
│   - Pokaico memory adapter (custom, replaces Mastra's default) │
│                                                                 │
│  Memory Pipeline (background worker, same process)              │
│   - Session watcher: new transcript? → extraction job           │
│   - Extraction: LLM call → classify topic → CRUD on /memory     │
│                                                                 │
│  Storage                                                        │
│   - <dataDir>/journal/*.md  (source of truth, on disk)         │
│   - <dataDir>/memory/**/*.md  (derived, on disk)               │
│   - <dataDir>/pokai.db      (index: embeddings + FTS + graph      │
│                              edges cache — rebuildable from .md) │
└─────────────────────────────────────────────────────────────────┘
```

`<dataDir>` is the user's chosen Pokaico data directory (e.g. `~/Documents/Pokaico`). The project repo and user data are separate trees — the app asks the user where to store their data on first launch.

Key principle carried through: **the SQLite DB can be deleted and rebuilt by re-walking and re-embedding `<dataDir>/memory/`.** It never holds anything that isn't derivable from the markdown tree. This gives you a clean recovery story and means schema migrations are low-stakes.

### Architecture note: embedding runtime

**Current (v0.1):** Embedding runs via a Python sidecar process (`agent/python/embed.py`) using `sentence-transformers` with `intfloat/multilingual-e5-small`. The sidecar is spawned at startup and communicates via stdin/stdout JSON lines. This is a pragmatic choice for development — Python handles tokenization + pooling + normalization in one call, and the same Python stack could be reused for future deep research / search / agent tools.

**Production consideration:** The Python sidecar creates deployment friction — users need Python installed, model download is ~120MB (cached in `~/.cache/huggingface/`), and bundling requires PyInstaller or similar. Future alternatives:

| Alternative | Trade-off |
|---|---|
| **transformers.js** (`@huggingface/transformers`) | Pure JS ONNX inference — no Python dep, no sidecar, same E5-small model available (`Xenova/multilingual-e5-small`). Eliminates the entire Python dependency. Feasibility confirmed: transformers.js is mature (Xenova ecosystem) and covers most SentenceTransformer models. |
| **PyInstaller bundle** | Compile Python + model into standalone `.exe` — transparent to user but adds ~150MB to binary. |

**Decision:** Python sidecar for v0.1 development. Revisit for production — if Python-side features (deep research, agent tools) don't materialize, transformers.js would simplify the stack significantly.

### User environment assumption

Pokaico assumes the user's machine has **zero programming tools** installed — no Python, Node.js, Git, compilers, or package managers. The developer is responsible for preparing and bundling every dependency (via PyInstaller, embedded runtimes, or Tauri resources). Downloads during first launch (model files, engine binaries) are by design, not a bug — this is the standard pattern for desktop ML applications (LM Studio, Ollama). Installer size and first-run wait time are acceptable trade-offs for zero-assumption portability.

---

## 4. Journal layer (immutable transcript)

A `journal/` directory sits alongside `memory/` as the source-of-truth recording of every conversation turn — write-only, append-only, never mutated after write.

```
memory/          # derived synthesis (built from journal)
journal/         # immutable log (what was actually said)
```

### Format

Each file is one session, written immediately after every user/AI turn:

```markdown
---
session_id: a3f9
started_at: 2026-07-08T14:02:11+07:00
model: claude-sonnet-5
extracted: false
---

## [14:02:11] User
Man, work was rough today.

## [14:02:19] Pokai
That sounds exhausting, especially if it's a pattern...

## [14:05:03] User
Yeah it happens like every two weeks.
```

### Rules

- **Append, don't rewrite** — each turn is an append; no re-serialization cost as sessions grow.
- **Frontmatter carries pipeline state** — `extracted: false` → extraction job flips it to `true` (or stores last-extracted message timestamp, matching the `session_pointers` table). Auditable in-file, not just in DB.
- **Attachments as references** — `![photo](../topics/family/resources/mom-bday-2026.jpg)`. Journal stays lightweight text; blobs live under `memory/topics/*/resources/`.
- **Tool calls as turn types** — `## [14:03:02] Tool: search_topics` — zero-cost structured writes, no schema migration needed to add later.
- **Agent extraction reads from journal**, writes into `memory/topics/`. Journal is the immutable input; `memory/` is the derived output.

---

## 5. Database schema sketch (SQLite)

```sql
-- Mirrors the graph structure described in INDEX.md, cached for fast lookup
CREATE TABLE topics (
  id TEXT PRIMARY KEY,              -- e.g. "user-preferences"
  path TEXT NOT NULL,               -- memory/topics/user-preferences/CONTEXT.md
  summary TEXT,                     -- one-line description (mirrors INDEX.md entry)
  token_count INTEGER,              -- for enforcing the 2500-token cap
  is_foundational INTEGER DEFAULT 0,-- loaded at every conversation start
  updated_at INTEGER
);

CREATE TABLE edges (
  from_topic TEXT REFERENCES topics(id),
  to_topic TEXT REFERENCES topics(id),
  relationship TEXT,                -- free-text label, e.g. "influences", "related-to"
  PRIMARY KEY (from_topic, to_topic, relationship)
);

CREATE TABLE resources (
  id TEXT PRIMARY KEY,
  topic_id TEXT REFERENCES topics(id),
  path TEXT NOT NULL,               -- memory/topics/.../resources/foo-notes.md
  kind TEXT,                        -- md | image | pdf | doc
  updated_at INTEGER
);

-- Vector + lexical index (sqlite-vec virtual table + FTS5), one row per chunk
CREATE VIRTUAL TABLE chunk_fts USING fts5(content, topic_id UNINDEXED, source_path UNINDEXED);
CREATE VIRTUAL TABLE chunk_vec USING vec0(embedding float[384]);

CREATE TABLE session_pointers (
  session_id TEXT PRIMARY KEY,
  last_extracted_message_ts INTEGER  -- lets you detect "no new transcript since last extraction"
);
```

`session_pointers` is what implements your "fast session switching = no extraction" rule cheaply: on session start/switch, compare the session's latest message timestamp against `last_extracted_message_ts`; only enqueue an extraction job if it's newer.

---

## 6. Memory pipeline as a state machine

Your spec already describes this well; here's it translated into concrete triggers/states for implementation:

1. **Trigger:** new session started, or user switches away from a session.
2. **Guard:** `has_new_messages = latest_ts(session) > session_pointers.last_extracted_message_ts`. If false → no-op.
3. **Summarize transcript** — one LLM call, output used by both sub-pipelines below.
4. **`refresh_foundational(summary, foundational_topics[])`** — always runs. Sends all foundational CONTEXT.md + summary in one prompt. LLM decides per topic whether new info exists. Returns `[{topicId, newContent | null}]`. Never similarity-gated — foundational topics are too important to leave to a threshold.
5. **`extract_topics(summary, indexSlugs?)`** — two-phase:
   - **Phase A (deterministic, no LLM):** reads INDEX.md (the canonical routing map) before creating anything. If a topic slug already exists in INDEX.md, the system **updates** that topic instead of creating a duplicate. This is the primary gate, replacing the old similarity-threshold approach.
   - **Phase B (similarity fallback):** only when no INDEX match is found, falls back to embedding/FTS5 similarity search for near-matches. The similarity threshold is now a secondary safety net, not the primary decider.
   - If ≥2 topics or resources touched, write cross-link edges in SQLite and inline references in CONTEXT.md.
6. **Write phase** — for each topic needing update, acquire per-topic lock → read current file → attempt to condense new info into the token cap. Overflow to `resources/` is the *last resort*, used only when the LLM judges the content cannot be adequately condensed into CONTEXT.md without losing essential meaning. Each overflow file gets a cross-link edge (`"has-detailed-notes"`) and an inline reference in CONTEXT.md so the agent knows it exists.
7. **Re-index:** upsert changed topic chunks into `chunk_fts` / `chunk_vec`; update `topics.updated_at`, `topics.token_count`.
8. **Observer (INDEX rebuild):** after every extraction, INDEX.md is mechanically rebuilt from the current topic graph — no LLM involved, always overwrites stale content atomically. This keeps the routing map fresh without manual maintenance.
9. **Update pointer:** `session_pointers.last_extracted_message_ts = latest_ts(session)`.

### Concurrency

The contended resource is the **topic**, not the session. Two sessions extracting in close succession can both decide to touch the same `CONTEXT.md`. The guard must be per-topic:

- **Per-topic in-memory mutex** (a `Map<topicId, Promise<void>>` that chains writes). When extraction resolves that topic X needs updating, it awaits the topic's lock before reading the current `CONTEXT.md`, appending, and writing back.
- **No deadlock risk** at v0.1 scale — a single extraction touches at most 2–3 topics, and the lock is held only during the file I/O window (milliseconds), not the LLM call. Acquire lock → read current file → write → release. The LLM call (minutes) happens *before* acquiring locks.
- **Queue emerges naturally** — if three extractions all need topic X, they serialise behind the mutex. No separate queue primitive needed. If you later want ordering guarantees (e.g. FIFO per topic), upgrade the mutex to a `Map<topicId, AsyncQueue>` — same shape, slightly more structure.
- **Lock file (disk) unnecessary** for v0.1 single-process — the in-memory map is sufficient because there's exactly one Node process. If you later split the memory pipeline into a separate process, switch to advisory `.topic-<id>.lock` files.

Implementation sketch:

```ts
const topicLocks = new Map<string, Promise<void>>();

async function withTopicLock(topicId: string, fn: () => Promise<void>) {
  while (topicLocks.has(topicId)) {
    await topicLocks.get(topicId); // wait for previous writer
  }
  const done = fn().finally(() => topicLocks.delete(topicId));
  topicLocks.set(topicId, done);
  return done;
}
```

This replaces the old "one extraction per session at a time" guard entirely — that guard is both too strict (serialises unrelated sessions) and too loose (allows concurrent writes to the same topic).

---

## 7. Retrieval / read path

The write side (extraction) populates `memory/` and the SQLite index. The read side is what the conversational agent uses to answer user questions from stored context — it's a set of Mastra tools, not a monolithic "load everything" prompt.

### Session start

On session open, the agent receives:
- **System prompt** — static, <500 tokens.
- **INDEX.md** — the canonical routing map. A compact listing of every topic (one line + summary) plus graph edges. The agent uses this to **route before searching**: if the user's question matches a known topic, the agent already knows where to look without an embedding call.
- **Foundational topics** — shipped at app init, capped at 700 tokens each, 2100 total. Each is an always-loaded topic that the extraction pipeline also refreshes every cycle (see §6):

  | Topic | Path | What it captures |
  |---|---|---|
  | `user-profile` | `memory/topics/user-profile/CONTEXT.md` | Cognitive/behavioural profile: personality traits, thinking patterns, values, decision-making style, emotional triggers, communication preferences. |
  | `user-background` | `memory/topics/user-background/CONTEXT.md` | Bio: name, location, timezone, occupation, languages. Work: role, industry, career goals. Life: living situation, key relationships. |
  | `user-communication` | `memory/topics/user-communication/CONTEXT.md` | Tone preferences, how they like to be addressed, pet peeves, response style, turn-off topics. |

  After summarization target, content that genuinely cannot be condensed spills to `resources/` with a cross-link edge and inline reference in CONTEXT.md.

- **Recent journal summary** — last N messages across recent sessions, for continuity. Not full transcripts, just a condensed timeline.

Everything else is loaded lazily via tools.

### Conversational tools (Mastra)

| Tool | Trigger | What it does |
|---|---|---|
| `search_topics(query)` | Agent decides user is referencing something stored — and INDEX.md alone wasn't enough | **INDEX-primary route** (lexical match against topic summaries) first; only if that yields nothing, falls back to embedding + FTS5 search. Returns top‑5 topic IDs + snippets. Agent picks which to read. |
| `read_topic(topicId)` | Agent wants full context on a topic after search or INDEX match | Reads `memory/topics/<topicId>/CONTEXT.md` — returns full text. If >2500 tokens, returns summary first with option to read details. |
| `list_topics(filter?)` | Agent wants to browse the topic graph | Queries `INDEX.md` or `topics` table. Supports filter: `foundational`, `recently_updated`, or prefix match. |
| `ingest_resource(source, topicId)` | User shares/uploadsa file via chat | Copies original to `memory/topics/<topicId>/resources/<filename>`. Runs Xberg extraction: text-based formats → saves `<filename>.md`; images/scanned PDF → if OCR enabled, saves OCR output as `<filename>.md`. Agent never touches filesystem — all done programmatically. Returns extracted text. |
| `read_resource(path)` | Agent needs a resource | Reads companion `.md` if present (e.g. `resume.md` alongside `resume.pdf`). Falls back to original file. Xberg handles format detection — agent receives clean text regardless of source format. |
| `read_session(sessionId)` | Agent needs exact transcript, not the synthesized version | Reads `journal/YYYY-MM-DD-<sessionId>.md`. Used when extraction might have missed nuance. |

### Decision flow

```
User message
  └→ Agent system prompt has INDEX.md + foundational topics + recent summary
      └→ Agent generates response — if it needs stored context:
          └─ Match against INDEX.md (lexical) — fast, zero model cost
              ├─ Match found → read_topic(topicId) → full context → incorporate
              └─ No match → search_topics("user's work schedule") → embedding/FTS5
                  └─ read_topic("work/schedule") → full context
                      └─ [optional] read_resource("work/schedule/resources/calendar.md")
                          └→ Agent incorporates into response
```

The agent is *not* forced to use tools. For simple queries ("what's my name?") the foundational topics in the prompt suffice. Tools are there for depth — the agent decides when to invoke them. The key architectural change: **INDEX.md is the primary router**, making the common case (known topic) fast and deterministic. Embedding/FTS5 is only consulted when the routing map doesn't contain a match.

### Why this design

- **Tool-based, not prompt-dump** — keeps the system prompt small (<3000 tokens baseline). Context is loaded on demand, not pre-injected.
- **Rerank is the agent's job** — the LLM is better at deciding relevance than a similarity-score threshold. `search_topics` returns candidates; the agent picks what to read.
- **Journal is the fallback** — if extraction ever loses nuance, `read_session` gives the agent the raw transcript. This is what makes the journal↔memory split safe.

---

## 8. What's explicitly out of scope for v0.1

Per your own scoping — listed here just so it's visible in one place and doesn't creep in:
- Search tools, Deep Research, Agent Skills execution, Agent Workflows, sandboxed terminal.
- **Floating tray overlay** — `Ctrl+Alt+P` global shortcut → small always-on-top window (icon-sized, expandable) for screen-sharing + chat with the agent via vision LLM. Feasible via `tauri-plugin-global-shortcut` + a second Tauri window (`decorations: false`, `alwaysOnTop: true`). Not for v0.1.
- Any multi-provider *routing* logic beyond "pick a model from the models.dev catalog" (no automatic fallback/cost-routing yet).
- LanceDB / a second vector engine — only revisit this if a single topic's resources genuinely grow into the hundreds of thousands of chunks or you add heavy multimodal (image/audio) embedding search, at which point LanceDB's Node SDK is a drop-in upgrade path from sqlite-vec.

---

## 9. Memory gardening (v0.2+)

Periodic LLM-driven pass that reviews `INDEX.md` and proposes topic merges, splits, or retitling — solving the drift problem where `user-preferences`, `preferences`, and `likes-and-dislikes` accumulate as near-duplicates across separate extraction runs.

### Trigger

- **Manual** (user invokes "garden my memory" from UI) or **time-based** (e.g. every 7 days, configurable). Not on every extraction — gardening is a batch operation.

### Process

1. LLM reads `INDEX.md` (all topic summaries + edge labels) and the first ~50 lines of each `CONTEXT.md`.
2. Proposes a diff: merge `user-preferences` ↔ `preferences`, split "work rants" out of `daily-life`, rename `misc` to something meaningful, etc.
3. User reviews the proposal in-UI (accept/reject per change). Nothing auto-applied — gardening is destructive and needs human sign-off.
4. On acceptance: rewrite `CONTEXT.md`, update `INDEX.md`, re-run extraction on affected sessions (or mark `extracted: false` on relevant journal files to trigger re-extraction).

### Why not v0.1

v0.1's extraction pipeline is strictly additive — it creates and appends, never reconsolidates. Gardening requires the ability to *rewrite* the topic tree, which needs a user-review UI and a re-indexing path that aren't needed for initial build. The journal layer is what makes gardening safe: you can always re-extract from the immutable transcript if a merge goes wrong.

---

## 10. Suggested layout — project vs. user data

Two separate trees. The project repo is for code; user data lives wherever the user chooses.

```
# Project repo (checkout, build, ship)
pokai/
├── src-tauri/                 # Rust shell, tauri.conf.json, sidecar binaries
├── src/                       # Frontend (pixel-art UI)
├── agent/                     # Node sidecar
│   ├── src/
│   │   ├── mastra/            # Agent + tool definitions
│   │   ├── memory/            # Pipeline, extraction, CRUD logic
│   │   ├── db/                # SQLite schema, migrations, query helpers
│   │   └── embeddings/        # E5-small Python sidecar wrapper
│   └── package.json
└── ...config files

# User data directory (e.g. ~/Documents/Pokaico/, configured on first launch)
<dataDir>/
├── journal/                    # Immutable transcripts (source of truth for what was said)
│   └── 2026-07-08-<session>.md
├── memory/                     # Derived synthesis (built from journal/)
│   ├── INDEX.md                    # PRIMARY routing map (built mechanically after every extraction)
│   └── topics/
│       └── <topic>/
│           ├── CONTEXT.md
│           └── resources/
└── pokai.db                    # SQLite index (disposable, rebuildable from above)
```

---

## 11. Open items to confirm before/while building

- **OCR backend (downloadable via settings)** — only used when conversation LLM has no vision. Vision LLMs handle images directly. OCR built into Xberg via Candle backends; model downloads on first use. UI presents categorized options with size + best-for context for informed user choice: Tesseract (~10 MB, CPU, 100+ languages) — lightweight; PaddleOCR (~8–120 MB, CPU/GPU, best for CJK) — balanced; GLM-OCR (~3 GB, GPU recommended, region-aware) — default. Not needed for v0.1 — `disableOcr: true`.
- **Model default for the extraction LLM** vs. the conversational LLM — you may want a cheaper/faster model (via models.dev) for background extraction and a stronger one for the live chat.

---

## 12. CSS Theming Architecture (v0.1+)

A CSS custom properties-based theme system. Not part of v0.1 core UI — implement base pixel styling in v0.1, ship theme presets in a later iteration.

### Mechanism

- All color tokens are CSS custom properties defined on `:root` as defaults.
- Each theme is a class applied to `<html>` (e.g. `<html class="theme-cozy-forest">`).
- Theme switching via React context + `localStorage` persistence.

### Theme anatomy (~25 variables per theme)

```css
:root {
  /* Background -- 4 levels */
  --color-bg-base: #faf6f0;
  --color-bg-surface: #f0ebe3;
  --color-bg-elevated: #e8e0d4;
  --color-bg-overlay: rgba(0, 0, 0, 0.4);

  /* Text -- 3 levels */
  --color-text-primary: #2c2416;
  --color-text-secondary: #6b5c48;
  --color-text-muted: #a09080;

  /* Accent -- 3 semantic */
  --color-accent-primary: #c75b39;
  --color-accent-secondary: #4a8c6f;
  --color-accent-tertiary: #d4a04a;

  /* Surface -- 2 levels */
  --color-surface-chat: #ffffff;
  --color-surface-input: #ffffff;

  /* Border -- 2 levels */
  --color-border-subtle: #ddd6cb;
  --color-border-strong: #b8a99a;

  /* Shadow -- 2 levels */
  --color-shadow-soft: rgba(44, 36, 22, 0.08);
  --color-shadow-hard: rgba(44, 36, 22, 0.15);

  /* Semantic -- per component area */
  --color-message-user: var(--color-accent-primary);
  --color-message-pokai: var(--color-surface-chat);
  --color-link: #3b7dbd;
  --color-error: #c0392b;
  --color-success: #4a8c6f;

  /* Pixel aesthetics */
  --pixel-border-width: 2px;
  --pixel-shadow-offset: 2px;
}
```

### Theme presets (shipped, v0.1+)

| Class | Name | Vibe |
|---|---|---|
| `theme-cozy-forest` | Cozy Forest | Warm earth tones, beige/terracotta/olive -- default |
| `theme-midnight` | Midnight | Deep navy, cool blues, low contrast, easy on eyes |
| `theme-sunrise` | Sunrise | Warm coral, cream, golden -- bright and airy |
| `theme-ocean` | Ocean | Cool teal, slate, soft greens -- calm and clean |

### Pixel art aesthetic constraints

- Limited palette: each theme uses at most 12 distinct hues, with tint/shade variation via luminance only.
- Hard-edged shadows (`box-shadow` with no blur, offset = `--pixel-shadow-offset`).
- No `border-radius` on primary UI elements (chat bubbles may have 2px for readability).
- `image-rendering: pixelated` on avatar/icon elements.
- Grid-aligned spacing (multiples of 4px or 8px).

### Theme file structure

```
src/themes/
├── cozy-forest.css
├── midnight.css
├── sunrise.css
└── ocean.css
```

Each file overrides only the `--color-*` variables. The pixel/shape tokens stay in `src/styles/variables.css` as theme-independent.