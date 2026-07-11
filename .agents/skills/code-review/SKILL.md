---
name: code-review
description: Code review for the Pokaico project. Extends the global code-review framework (Dimension 4 — Domain Correctness) with Pokaico-specific domain rules: memory pipeline, INDEX-primary routing, embedding service, SQLite/filesystem, Mastra tools, Tauri frontend. Produces a tiered report (Critical→Nit) with actionable fix/test recommendations per finding.
---

# Code Review — Pokaico

Extends the global `code-review` skill. The global skill defines dimensions 1–3 and 5–8 (API design, types, error handling, tests, arithmetic, performance, documentation). This file **replaces Dimension 4 (Domain Correctness)** with Pokaico-specific rules. Refer to the global skill for the full review framework, finding classification, and output format.

## When to Use

Same triggers as global code-review — plus any time a module in `agent/src/memory/`, `agent/src/embeddings/`, `agent/src/db/`, or `agent/src/mastra/` is changed.

## Dimension 4: Domain Correctness (Pokaico)

When reviewing any module, cross-check against the relevant subset below.

### 4a. SPEC.md & Phase Contract
- Does the code respect the **current phase** in `PROGRESS.md`? No reaching into future phases.
- Is the behavior documented in `SPEC.md` — and does the code match the specified flow?
- Are phase-specific acceptance criteria met?

### 4b. Memory Pipeline (processSession)
- **Step order is sacred:** guard (1) → summarize (2) → refresh_foundational (3) → extract_topics (4) → compact→write (5) → reindex (6) → edges/resources (6b) → regenerateIndex (6c) → updatePointer (7) → markJournalExtracted (8).
- **Guard:** `hasNewMessages` reads `session_pointers.last_extracted_message_ts`; if no new messages, extraction skips entirely.
- **Summarization:** uses LLM via `ai-sdk` `generateText`; returns `SummaryOutput` with optional `topics[]` array.
- **refresh_foundational:** runs on 3 shipped topic IDs only: `user-profile`, `user-background`, `user-communication`. Target: `FOUNDATIONAL_CAP=700` tokens.
- **Pointer before journal mark:** `updatePointer` (Step 7) MUST run before `markJournalExtracted` (Step 8). If pointer fails, journal stays `extracted: false` → safe re-process.
- **Journal mark:** `extracted: true` replacement is scoped to the YAML frontmatter block only (between first `---` pair).

### 4c. INDEX-primary Routing
- **INDEX.md is the PRIMARY router.** Routing is deterministic, LLM-free: `routeTopics` (`retrieval.ts`) uses lexical Jaccard overlap against `INDEX.md` entries. `searchSimilar` (embedding/FTS5) is **secondary fallback** — called only when INDEX yields no lexical hit.
- **`parseIndex`** reads INDEX.md into `IndexTopic[]` with a tolerant regex (`^\s*-\s+\*\*(.+?)\*\*\s*:\s*(.*?)\s*$`). Returns `[]` when INDEX.md is absent.
- **`regenerateIndex`** rebuilds INDEX.md mechanically after every extraction (pipeline Step 6c). Always overwrites, no `existsSync` guard (unlike dead `ensureIndex`). Atomic write: temp file + `renameSync`. Wrapped in try/catch so a failure never aborts extraction.
- **Read-path seam:** `retrieveMemory(memoryDir, query, opts?)` is the public entry point the Phase 4 agent will call. It routes INDEX-primary and loads matched CONTEXT.md blocks.

### 4d. Deterministic Pre-create Check (extractTopics)
- **Before `create`**, `extractTopics` reads `indexSlugs` (from `parseIndex` via pipeline Step 4) and uses `resolveDeterministic(title)` to decide UPDATE vs CREATE.
- **Match rules:**
  - Exact slug match → UPDATE (deterministic, no embedding call, `similarityScore:1`).
  - Single numeric-suffixed sibling (e.g. `bike-purchase-1`, `bike-purchase-2`) → UPDATE that sibling.
  - Title > 60 chars → skip deterministic (two distinct long titles can collapse to same truncated slug).
  - Multiple ambiguous siblings → fall back to embedding (don't guess).
- **Self-guard foundational:** `foundational` slugs are deleted from `deterministicSlugs` even if the caller forgot to filter — foundational topics are never updated by extraction.
- **FALLBACK_MATCH_THRESHOLD = 0.35** gates the *hybrid combined score* (vector + FTS5), NOT a pure embedding score. This is a fallback gate, not the primary decider.

### 4e. Embedding Service & FTS5
- **Model:** E5-small (384-dim vectors) via Python sidecar (`embed.py`, stdin/stdout JSON loop). Subprocess managed by `model.ts`.
- **sqlite-vec:** `chunk_vec` virtual table, `vec0(embedding float[384])`. Query via `MATCH` with cosine distance.
- **FTS5:** `chunk_fts` virtual table, default `unicode61` tokenizer. Content indexed by `reindexTopics` → `search.ts` `indexTopic`.
- **buildFtsQuery:** sanitizes FTS5 syntax (strips `"`, `*`, `:`, `(`, `)`, `-`), drops boolean operators (`AND`/`OR`/`NOT`/`NEAR`), aligns with `unicode61` (NFKD → strip combining diacritics), joins tokens with ` OR ` for partial-token match (not AND-default).
- **hybridSearch:** combines vector cosine + FTS5 BM25 with configurable `vectorWeight`.
- **ftsSearch/hybridSearch catch:** must `console.error` and return `[]` on FTS5 parse errors (never silently kill the keyword branch).
- **Token budget:** `CONTEXT_CAP=2500`, `FOUNDATIONAL_CAP=700` (char/4 heuristic, zero-dep `countTokens`).

### 4f. SQLite + Filesystem
- **better-sqlite3:** synchronous API. WAL mode not required (single-sidecar). All writes wrapped in explicit transactions where consistency matters.
- **DB schema (`schema.ts`):** `sessions`, `topics`, `resources`, `edges`, `session_pointers` (by `session_id`). `topics.is_foundational` (0/1 int). `topics.updated_at` (unix ms).
- **Filesystem = source of truth:** `scanTopics` reads directory listing from `memory/topics/`, not the DB `topics` table. The DB is rebuildable from `.md` files.
- **Atomic writes:** `regenerateIndex` uses `writeFileSync(tmp)` → `renameSync(tmp, final)`. Topic writes use `withTopicLock` (per-topic async mutex) to prevent concurrent corruption.
- **Journal format:** `journal/YYYY-MM-DD-<sessionId>.md`, YAML frontmatter (`session_id`, `started_at`, `model`, `extracted: true/false`). Turns delimited by `## [HH:mm:ss] role`.

### 4g. Mastra Agents & Tools (Phase 4, future)
- Agent will use `@mastra/core` with model from models.dev catalog.
- System prompt injected from foundational topics (`user-profile`, `user-background`, `user-communication`).
- 6 retrieval tools planned: `search_topics`, `read_topic`, `list_topics`, `ingest_resource`, `read_resource`, `read_session`.
- Agent calls `retrieveMemory` at session start to inject INDEX-primary routed context.

### 4h. Tauri + React Frontend (Phase 5, future)
- Desktop app: Tauri 2 shell, React/Vite/TypeScript frontend, Node.js sidecar (`agent/`).
- IPC bridge: Tauri commands or HTTP between React ↔ sidecar.
- Pixel art aesthetic: cozy palette, pixel fonts.

### 4i. Testing Discipline
- **Framework:** vitest (`agent/vitest.config.ts`, `globals: true`, `dotenv`).
- **TDD:** red → green → commit; vertical slices one seam at a time per `tdd` skill.
- **Test at seams:** public interface only (never internals). Mocks at module boundaries.
- **Smoke tests:** gated via `describe.runIf(hasApiKey)`. Require `GOOGLE_GENERATIVE_AI_API_KEY` + Python E5 sidecar. Known environmental failures (Gemini quota) are not code regressions.
- **tsc:** `tsc --noEmit` currently has pre-existing `LanguageModelV1`→`LanguageModel` rename errors in `ai` v7 — not a regression; tests are the source of truth.
- **Known environmental flake:** `model.test.ts` "FIX F4: request timeout" — Python subprocess startup timing.

### 4j. Named Constants & Magic Numbers
| Constant | Value | Location | Meaning |
|---|---|---|---|
| `FALLBACK_MATCH_THRESHOLD` | 0.35 | `extract.ts:10` | Hybrid combined-score gate for update-vs-create (fallback only) |
| `CONTEXT_CAP` | 2500 | `tokens.ts` | Token budget for episodic topic CONTEXT.md |
| `FOUNDATIONAL_CAP` | 700 | `tokens.ts` | Token budget per foundational topic |
| `FOUNDATIONAL_TOPIC_IDS` | `["user-profile","user-background","user-communication"]` | `pipeline.ts:57` | Never updated by extraction |
| Embedding dim | 384 | `schema.ts:46` | E5-small vector dimension |
| `RETRY_COUNT` | 1 | `pipeline.ts:121` | LLM retry attempts |
| `SIMILARITY_THRESHOLD` | (obsolete) | — | Replaced by `FALLBACK_MATCH_THRESHOLD` |

### 4k. Branch & Commit Discipline
- **Branch:** work on feature branches (e.g. `feat/index-primary-routing`), never on `main`.
- **Commit prefix:** conventional commits (`feat`, `fix`, `test`, `docs`, `refactor`, `chore`).
- **PROGRESS.md:** updated on sub-phase completion. Phase-lock enforced.
- **No commits of secrets/keys.**
