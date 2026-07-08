# Pokaico — Build Progress

> Version-controlled, phased, TDD-based implementation. Each phase is locked after completion.
> Active phase can be worked on; all others are blocked.

---

## Phase 0: Foundation & Scaffolding [✅]

**Scope:** Tauri 2 + React + Node sidecar skeleton, dep installation, monorepo structure, build verification.

- [x] Init Tauri 2 project with React/Vite/TypeScript frontend
- [x] Init Node.js sidecar workspace (`agent/`) with separate package.json
- [x] Install core deps: `better-sqlite3`, `sqlite-vec`, `mastra`, `ai`, `@opencode-ai/models`, `onnxruntime-node`, `@xberg-io/xberg`, `vitest`
- [x] Configure TypeScript (ES2022 modules for Mastra compat)
- [x] Set up `.gitignore`, `.editorconfig`, `.gitattributes`
- [x] Git init → initial commit
- [x] **Test:** Smoke — app compiles, sidecar starts, IPC channel works
- [x] **Deliverable:** Empty shell app with sidecar process communication verified

---

## Phase 1: Data Layer — SQLite + Filesystem [ ]

**Scope:** All DB tables, journal format, memory directory structure, file I/O modules.

- [ ] SQLite schema: `sessions`, `topics`, `resources`, `edges`, `session_pointers`, FTS5 virtual table, sqlite-vec virtual table
- [ ] Journal module: write formatted `.md` (`journal/YYYY-MM-DD-<session>.md`), parse back to structured data
- [ ] Memory module: topic directory tree (`memory/topics/<slug>/CONTEXT.md`, `memory/INDEX.md`), resource companion `.md` management
- **Test:** DB creation, journal write/read roundtrip, memory dir creation matches expected structure
- **Deliverable:** Working data layer with journal + memory filesystem ops + DB schema

---

## Phase 2: Embedding Service [ ]

**Scope:** EmbeddingGemma-300M ONNX wrapper, similarity computation, sqlite-vec + FTS5 integration.

- [ ] ONNX runtime wrapper: load model, generate embeddings, batch support, error handling
- [ ] Cosine similarity: compute between vectors, threshold-based matching
- [ ] sqlite-vec: store/query/delete embedding vectors, ANN search
- [ ] FTS5: full-text search over topic content, BM25 ranking, hybrid search
- **Test:** Embedding dimension correctness, known-vector similarity scores, sqlite-vec store/query, FTS5 search relevance
- **Deliverable:** Embedding service that generates, stores, and queries vectors + full-text

---

## Phase 3: Memory Pipeline State Machine [ ]

**Scope:** Full extraction pipeline: guard → summarize → refresh_foundational → extract_topics → write → re-index → pointer update.

- [ ] Session pointer guard: read `last_extracted_message_ts`, skip if no new messages
- [ ] Summarization: LLM call to condense session into structured summary
- [ ] `refresh_foundational`: always runs on 3 shipped topics (`user-profile`, `user-background`, `user-communication`), 700-token target each
- [ ] `extract_topics`: similarity-gated against existing topics, create-or-update, excludes foundational
- [ ] Write phase: per-topic in-memory mutex (`Map<topicId, Promise<void>>`), lock only during I/O, `[src:timestamp]` provenance markers, overflow to `resources/` at threshold, cross-link edges
- [ ] Re-index: rebuild FTS5 + embedding vectors for updated topic
- [ ] Pointer update: persist `last_extracted_message_ts`
- **Test:** Each step independently, full pipeline E2E with mock LLM, mutex serialization, overflow trigger, provenance format
- **Deliverable:** Complete memory pipeline that processes sessions into evergreen topics

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
