# Pokaico — Build Progress

> Version-controlled, phased, TDD-based implementation. Each phase is locked after completion.
> Active phase can be worked on; all others are blocked.

---

## Phase 0: Foundation & Scaffolding [✅]

**Scope:** Tauri 2 + React + Node sidecar skeleton, dep installation, monorepo structure, build verification.

- [x] Init Tauri 2 project with React/Vite/TypeScript frontend
- [x] Init Node.js sidecar workspace (`agent/`) with separate package.json
- [x] Install core deps: `better-sqlite3`, `sqlite-vec`, `mastra`, `ai`, `@opencode-ai/models`, `@xberg-io/xberg`, `vitest`
- [x] Configure TypeScript (ES2022 modules for Mastra compat)
- [x] Set up `.gitignore`, `.editorconfig`, `.gitattributes`
- [x] Git init → initial commit
- [x] **Test:** Smoke — app compiles, sidecar starts, IPC channel works
- [x] **Deliverable:** Empty shell app with sidecar process communication verified

---

## Phase 1: Data Layer — SQLite + Filesystem [✅]

**Scope:** All DB tables, journal format, memory directory structure, file I/O modules.

- [x] SQLite schema: `sessions`, `topics`, `resources`, `edges`, `session_pointers`, FTS5 virtual table, sqlite-vec virtual table
- [x] Journal module: write formatted `.md` (`journal/YYYY-MM-DD-<session>.md`), parse back to structured data
- [x] Memory module: topic directory tree (`memory/topics/<slug>/CONTEXT.md`, `memory/INDEX.md`), resource companion `.md` management
- [x] **Test:** DB creation, journal write/read roundtrip, memory dir creation matches expected structure — 44 tests (+17 edge case: dir autocreate, FK, special chars, tool turns, CRLF, YAML dashes, missing frontmatter, non-.md files, spaces in slug, collision, stale INDEX, case sensitivity)
- [x] **Deliverable:** Working data layer with journal + memory filesystem ops + DB schema

---

## Phase 2: Embedding Service [✅]

**Scope:** E5-small Python sidecar (sentence-transformers), similarity computation, sqlite-vec + FTS5 integration.

- [x] Python sidecar: embed.py with sentence-transformers, stdin/stdout JSON loop, model loaded on startup
- [x] `model.ts`: Python subprocess manager (spawn, embed, embedBatch, close)
- [x] `service.ts`: integrate vec0 INSERT, embed API with `query:`/`passage:` prefix, hybrid search (FTS5 + vector)
- [x] Cosine similarity: compute between vectors, threshold-based matching (384-dim)
- [x] sqlite-vec: store/query/delete embedding vectors, ANN search (via hybrid)
- [x] FTS5: full-text search over topic content, BM25 ranking, hybrid search
- [x] **Test:** 96 passing tests across 7 files — embedding dimension (384), known-vector similarity, vec0 store/query, FTS5 search relevance, hybrid search, fallback
- [x] **Deliverable:** Embedding service that generates, stores, and queries vectors + full-text

---

## Phase 3: Memory Pipeline State Machine [✅] (closed again)

**Scope:** Full extraction pipeline: guard → summarize → refresh_foundational → extract_topics → write → re-index → pointer update. **Completed: multi-topic extraction + data directory config.**

- [x] Session pointer guard: read `last_extracted_message_ts`, skip if no new messages
- [x] Summarization: LLM call to condense session into structured summary
- [x] `refresh_foundational`: always runs on 3 shipped topics (`user-profile`, `user-background`, `user-communication`), 700-token target each
- [x] `extract_topics`: similarity-gated against existing topics, create-or-update, excludes foundational, slug-collision guard
- [x] Write phase: per-topic async mutex, per-session async mutex, provenance markers `[src:sessionId:timestamp]`, action types (`create`, `update`, `external`), topicId validation, idempotency guard, resources/ for external artifacts only (no auto-overflow)
- [x] Re-index: rebuild FTS5 + embedding vectors for updated topic with dedup check, char/4 token estimation
- [x] Pointer update: atomic ordering (pointer before journal mark), unix timestamp via `started_at` + `HH:mm:ss`
- [x] Error handling: LLM retry wrapper, graceful summarization failures, journal file exact matching, frontmatter-scoped `markJournalExtracted`
- **Test:** 178 unit + 3 E2E smoke = 181 tests passing (4 skipped)
- **Deliverable:** Complete memory pipeline that processes sessions into evergreen topics

### Reopened — multi-topic extraction + data directory config [✅]
- [x] `config.ts`: resolveDataRoot (override → POKAICO_DATA_DIR → settings → Documents\Pokaico), getPaths, ensurePaths, setDataDir (persist ke %APPDATA%\Pokaico\config.json)
- [x] `types.ts`: TopicSegment + SummaryOutput.topics[]
- [x] `summarizer.ts`: segmentasi percakapan jadi banyak topik dalam 1 LLM call
- [x] `extract.ts`: banyak TopicChange per sesi (create/update per segmen), dedupe segmen→topik-existing sama, collision slug dalam batch
- [x] `pipeline.ts`: verifikasi loop multi-topik + kalibrasi SIMILARITY_THRESHOLD (combinedScore scale)
- [x] `index.ts`: wiring minimal pakai path dari config
- [x] Smoke E2E (Gemini + E5 asli): 1 sesi 2 subjek → 2 topik; chat baru → retrieve; sesi ke-2 → (calibration note)
- [x] Phase 3 ditutup kembali

---

## Phase 4: Mastra Agent + Retrieval Tools [ ]

**Scope:** Mastra conversational agent, 6 retrieval tools as Mastra tools.

- [ ] Mastra agent: model from models.dev catalog, system prompt from foundational topics
- [ ] `search_topics`: FTS5 + embedding hybrid search, ranked results
- [ ] `read_topic`: full CONTEXT.md for a topic slug
- [ ] `list_topics`: all topics with metadata, filterable by kind
- [ ] `ingest_resource`: programmatic file copy → Xberg extraction → companion `.md` → graph edge (agent never touches filesystem directly)
- [ ] `read_resource`: companion `.md` content or original file info
- [ ] `read_session`: raw journal transcript
- **Test:** Each tool independently with mock data, agent invokes correct tools, ingest_resource flow (copy + extract + link)
- **Deliverable:** Working conversational agent with full retrieval toolkit

---

## Phase 5: Frontend (React + Tauri) [ ]

**Scope:** Desktop UI: chat interface, settings, IPC bridge, pixel art aesthetic.

- [ ] Tauri window config (size, title, pixel art icon)
- [ ] Sidecar lifecycle (start on launch, stop on close)
- [ ] IPC bridge (React ↔ Node.js sidecar via tauri commands or HTTP)
- [ ] Chat UI: message list (markdown rendering), input field, file attachment, typing indicator, error display
- [ ] Settings: data directory (first-launch flow), model selection, view journal, view topics, about
- [ ] Pixel art styling: cozy palette, pixel fonts, custom decorative elements
- **Test:** Component rendering, IPC roundtrip, settings persistence, full chat flow (message → agent → response → display)
- **Deliverable:** Working desktop app with chat UI + settings + agent integration

---

## Phase 6: Polish & Robustness [ ]

**Scope:** Error recovery, edge cases, performance, data integrity, docs.

- [ ] Sidecar crash auto-restart, DB corruption detection + rebuild from files, LLM timeout handling, file I/O error handling
- [ ] Edge cases: first launch, empty journal, long sessions, concurrent messages, Xberg failure, embedding model failure
- [ ] Performance: pipeline <30s, embedding <1s, search <500ms, startup <3s
- [ ] External journal edit detection, DB rebuild utility
- [ ] README polish + basic user docs
- **Test:** All recovery paths, error scenarios, performance benchmarks, data integrity verification
- **Deliverable:** Polished v0.1 desktop app

---

## Backlog

Ideas, features, and improvements scoped but not yet scheduled into a phase.

### Cross-link edges (NEXT — dikerjakan setelah retrieval multi-topik selesai)

SPEC §6 baris 187: jika satu sesi menyentuh ≥2 topik, tulis edge di tabel `edges` + referensi inline di CONTEXT.md (`See [notes](resources/...md)`). Ditunda sementara agar fokus ke alur save→retrieve dulu.

### Topic re-consolidation

CONTEXT.md grows unbounded as updates accumulate. After many sessions, topics become large and redundant. We need a consolidation step that safely rewrites CONTEXT.md into a more compact form — without losing provenance markers or factual information.

**Design:**

```
BEFORE                              AFTER
─────────────────────────           ─────────────────────────
[src:s1:100]                        [src:s1:100][src:s5:200][src:s8:300]
User likes hiking.                  
                                    User enjoys hiking, especially solo
[src:s5:200]                        mountain treks. Mount Kinabalu was
Mount Kinabalu was memorable.       their most memorable trip. Prefers
                                    trails over roads.
[src:s8:300]
Prefers solo hikes over group ones.
```

1. **Extract markers programmatically** — regex `\[src:[^\]]+\]` collected into a single line
2. **LLM consolidates text only** — removes redundancy, keeps all facts. Markers never touch the LLM
3. **Reassemble** — `markersLine + "\n" + consolidatedText`

**Trigger:** Count-based (10+ provenance markers) or size-based (CONTEXT.md > ~50 lines).

**Placement:** Between `applyChanges` (Step 5) and `reindexTopics` (Step 6) in the pipeline.

**Safety:** Consolidation is optional — if LLM call fails, skip and keep original content. LLM prompt guarantees all factual information is preserved. Provenance markers are never passed to the LLM.
