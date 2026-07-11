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
- [x] `refresh_foundational`: always runs on 3 shipped topics (`user-profile`, `user-background`, `user-patterns`), 700-token target each
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

### Reopened — CONTEXT.md compaction + cross-link edges [✅]

Menggantikan backlog "Topic re-consolidation" (append-only + provenance markers) dengan model **compact-on-update dalam token cap**: setiap update, LLM merangkum-ulang & *replace* CONTEXT.md; detail yang tidak muat tumpah ke `resources/` (+ inline `See [notes](resources/…)` + edge `has-detailed-notes`). Marker provenance in-text dihapus di jalur compact; idempotensi kini via `session_pointers.last_extracted_message_ts`.

- [x] Slice 1 — `tokens.ts`: `countTokens` (heuristik `ceil(chars/4)`, zero-dep) + `CONTEXT_CAP=2500`/`FOUNDATIONAL_CAP=700`; `reindexer.ts` reuse
- [x] Slice 2 — `compactor.ts`: `compact()` LLM condense-in-cap → `CompactResult{context, overflow[], edges[]}`; tipe `CompactOverflow`/`CompactEdge`/`CompactResult`
- [x] Slice 3 — `writer.ts` update = **replace** (bukan append) + tulis overflow ke `resources/`; `pipeline.ts` inject `compact`, condense foundational (ganti `truncate` kasar)
- [x] Slice 4 — `search.ts` `purgeTopicChunks` + `reindexer.ts` purge chunk lama sebelum re-index (fix akumulasi stale chunk)
- [x] Slice 5 — `edges.ts` (`writeEdge`/`writeResource`/`linkCoOccurring`/`topicExists`, FK-safe); pipeline step 6b tulis overflow→resource, suggested edges, `linkCoOccurring` saat ≥2 topik
- [x] Slice 6 — E2E smoke (Gemini asli): `compact()` mengecilkan konten oversized ke dalam cap
- **Test:** 201 passed, 4 skipped (dijalankan dari `agent/`). Known-limitation tetap: kalibrasi `SIMILARITY_THRESHOLD` (E2E Test 3 update path) & sanitasi karakter khusus FTS5 (E2E Test 2 retrieval)

### Phase 3b: INDEX-primary routing + mechanical observer [✅ — issues #2/#3/#4 closed; #1 poin 2/3/4 closed]

Keputusan arsitektur (dikunci sesi ini): routing retrieval **tidak** lagi bergantung skor similarity `combinedScore` (`SIMILARITY_THRESHOLD=0.35`, `extract.ts:4` — rapuh, sering meleset → duplikat topik). Sebaliknya:

- **`INDEX.md` = router utama (INDEX-primary).** Peta topik (`memory/INDEX.md`, ringkas 1 baris/topik + label edge) disuntikkan ke konteks agent saat session start (paralel foundational, SPEC §7). LLM merute via peta; `search_topics` (SQLite vec0+FTS5) **turun jadi fallback** untuk query tak-terduga.
- **Cek deterministik sebelum `create`.** `extract_topics` membaca `INDEX.md`/daftar topik yg sudah ada **sebelum** `slugify`+`create`; jika slug/entri serupa ada → `update`, bukan `create` baru. Ini menuntaskan akar duplikat (bukan sekadar nambal threshold).
- **Observer MEKANIS regenerate `INDEX.md`** pasca-ekstraksi (setelah `applyChanges`/`reindexTopics`). `regenerateIndex(memoryDir)` membangun ulang dari tabel `topics`+`edges` **tanpa LLM** (deterministik, biaya nol) — menggantikan `ensureIndex` yg lazy/stale (`topics.ts:76-84`).
- **Sanitasi + OR-semantics FTS5** (issue #1 poin 2) tetap relevan sbg **fallback hardening**, bukan penentu utama.
- **Gardening DITUNDA** v0.1 — dan didefinisikan ulang sbg **user-driven KNOWLEDGE-GRAPH UI (v0.2+)**, BUKAN autonomous LLM job. Penataan memori = preferensi user (rapah/tak rapah beda tiap orang); agent tak boleh memutuskannya sendiri. v0.2+: backend baca `topics`+`edges` → ekspos sbg graph (node+edge+label); UI kanvas interaktif utk navigasi + aksi (merge 2 node, split 1→2, edit/hapus edge, hapus resource, konsolidasi topik) — user yg klik, backend/LLM yg eksekusi. v0.1 cukup: duplikat dihalang di sumber (Langkah 4) + `INDEX.md` selalu segar (Langkah 3). Lihat Phase 5 (Frontend) sbg timba graph UI.

**Implementasi (branch `feat/index-primary-routing`):**

- [x] **#3 — Observer mekanis** (`regenerateIndex`): rebuild `INDEX.md` dari filesystem + tabel `edges`, tanpa LLM, atomic write (temp+rename), dibungkus try/catch agar tak menggagalkan ekstraksi; dipanggil di pipeline Step 6c. Menggantikan `ensureIndex` yg lazy. (commits `09027bc`, `65bb7af`)
- [x] **#4 — Audit sebelum create** (`resolveDeterministic` + `parseIndex`): ekstraksi baca `INDEX.md` via `parseIndex` → `indexSlugs` (Step 4), lalu `extract_topics` UPDATE slug cocok (exact / single numeric-suffixed sibling), self-guard foundational, skip judul >60-char & sibling ambigu → fallback embedding. (commits `f465dc9`, `a28fd41`)
- [x] **#2 — Router INDEX-primary** (`retrieveMemory`/`routeTopics`/`loadRoutedContext`): routing leksikal (Jaccard) dari `INDEX.md` sbg PRIMARY; `searchSimilar` sbg SECONDARY fallback saat INDEX kosong. Seam publik `retrieveMemory` disediakan sbg entry point yg reachable & teruji. (commit `3b300f5`)
- [x] **#1 poin 2/3/4 — Hardening fallback**: `buildFtsQuery` sanitasi sintaks FTS5 + **OR-semantics** (multi-token match) + align diakritik dgn tokenizer `unicode61`; `SIMILARITY_THRESHOLD` → `FALLBACK_MATCH_THRESHOLD` (gate *hybrid combined score*, bukan penentu utama); jalur single-segment pakai `embMatch.score`. (commits `8123bee`, `fe865a1`, `5619ad8`)
- [x] **Tests**: 250+ passing offline; gap verifikasi ditutup — negative-path observer (throw/atomic/deletion), second-session update regression, guard >60-char & sibling ambigu, `parseIndex` tolerance, OR-semantics, `retrieveMemory`. (commit `audit-fixes`)

**Catatan gap (bukan blocker, didokumentasikan):**

- Dedup masih **partial**: judul beda kata yg slugify berbeda tetap `create`; gate `FALLBACK_MATCH_THRESHOLD` (yg "rapuh") tetap jadi satu-satunya net untuk near-duplicate di luar jalur deterministic. Diterima sbg batasan v0.1.
- Read-path router (`retrieveMemory`) sudah reachable & teruji sbg seam, tapi **wiring ke agent terjadi di Phase 4** (belum ada Mastra agent). Phase 4 wajib memanggil `retrieveMemory` saat session start.
- `ensureIndex` kini dead code (diganti `regenerateIndex`); biarkan atau hapus di Phase 4.

Tracking issues:
- [x] [#2](https://github.com/dimsedra/pokaico/issues/2) — INDEX.md sbg router utama + cek deterministik sebelum create ✅
- [x] [#3](https://github.com/dimsedra/pokaico/issues/3) — Observer mekanis regenerate INDEX.md pasca-ekstraksi ✅
- [x] [#4](https://github.com/dimsedra/pokaico/issues/4) — Audit background ekstraksi jurnal: baca INDEX.md sebelum create (pintu masuk #2/#1) ✅
- [#5](https://github.com/dimsedra/pokaico/issues/5) — Memory management UI: knowledge-graph (v0.2+), user-driven, backend/LLM eksekutor
- [x] (Latar: [#1](https://github.com/dimsedra/pokaico/issues/1) poin 2/3/4 — risiko korektnes awal; poin 1=stale chunk SUDAH selesai di Slice 4) ✅

**Urutan eksekusi (disepakati): 3 → 4 → 2 → 1.** Gardening = knowledge-graph UI v0.2+, di luar scope v0.1.

### Reopened — Foundational topics konsolidasi [#7](https://github.com/dimsedra/pokaico/issues/7) [✅]

**Reason:** Menyediakan slot untuk `user-patterns` (trigger skill creation v0.2). `user-communication` di-merge ke `user-profile`, konten tidak hilang — hanya 3 topik jadi:

- [x] `user-profile` (merged: personality + communication preferences + triggers + values)
- [x] `user-background` (tetap: bio + lokasi + pekerjaan + karir)
- [x] `user-patterns` (baru: pola berulang untuk trigger skill creation)

---

### Reopened — Session connectors for user-patterns + prompt definitions [#9](https://github.com/dimsedra/pokaico/issues/9)

**Reason:** Foundational topics perlu definisi di prompt (biar LLM tau persis isi tiap topik). `user-patterns` juga perlu session tags `[session:id]` untuk melacak bukti lintas session sebagai bobot pola.

- [ ] `foundational.ts` — prompt definitions + `sessionId` param + session tag instructions
- [ ] `pipeline.ts` — pass `sessionId` ke `refreshFoundational`
- [ ] Tests — update foundational.test.ts, pipeline.test.ts

**Tidak berubah:** `user-profile` dan `user-background` tanpa session tags (fakta stabil, tidak butuh bobot)

---

## Phase 4: Mastra Agent + Retrieval Tools + IPC [ ]

**Scope:** Mastra conversational agent, 6 retrieval tools as Mastra tools, system prompt with INDEX-primary routing, native Tauri IPC bridge.
**Arsitektur komunikasi:** Frontend ↔ Tauri Rust command ↔ stdin/stdout ↔ Node sidecar. Native IPC sejak awal agar tak perlu migrasi di v0.2.
**Blocker Phase 4:** Issue [#7](https://github.com/dimsedra/pokaico/issues/7) (Foundational topics konsolidasi), [#8](https://github.com/dimsedra/pokaico/issues/8) (Cross-topic edges), dan [#9](https://github.com/dimsedra/pokaico/issues/9) (Session connectors) harus selesai sebelum Group A dimulai.

---

### Reopened — Cross-topic edges: LLM-judged relatedTo [#8](https://github.com/dimsedra/pokaico/issues/8)

**Reason:** `linkCoOccurring` terlalu agresif — bikin edge otomatis jika ≥2 topik dalam satu sesi, padahal user bisa context switch. Edges harus diputuskan oleh LLM:

- [ ] `types.ts` — tambah field `relatedTo: [{topic: string, reason: string}]` di segment output
- [ ] `summarizer.ts` — LLM output `relatedTo` (dengan reason)
- [ ] `edges.ts` — hapus/ubah `linkCoOccurring`
- [ ] `pipeline.ts` — step 6b pakai `relatedTo`, bukan `linkCoOccurring`
- [ ] `topics.ts` — `regenerateIndex()` hapus `## Edges` dari INDEX.md (INDEX murni topic list)
- [ ] Write phase — append `## Related` ke CONTEXT.md (dengan short desc)
- [ ] `SPEC.md` — sinkronisasi desain
- [ ] Tests — update semua test yang bergantung pada edges

**Urutan task (sequential, no backtrack):**

### Group A — Foundation (back end, pure vitest)
- [ ] **Task 1 — Provider registry** ([#6](https://github.com/dimsedra/pokaico/issues/6)) (`agent/src/models/provider.ts`): config provider + API key + model aktif. Default Gemini dari `.env`. Config JSON loader/saver.
  - **models.dev** (`@opencode-ai/models`) → untuk UI model selector (filter LLM via `modalities.output.includes("text")`)
  - **Mastra model router** → agent runtime pakai format `"provider/model"` (Mastra resolve ke AI SDK)
  - Keduanya dipakai, peran berbeda: models.dev buat katalog/pricing, Mastra buat jalanin model
  - Mastra v1.18.2 depend pada `@mastra/core` (belum terinstall) — selesaikan di Task 3
- [ ] **Task 2 — System prompt builder** (`agent/src/mastra/prompt.ts`): `buildPrompt(memoryDir, query?)` → inject INDEX.md + 3 foundational topics + recent journal summary. Output string instruksi agent.
- [ ] **Task 3 — Agent factory** (`agent/src/mastra/index.ts`): `createAgent({ model, tools, memoryDir })` → return Mastra agent tanpa tools (factory terima tools sbg parameter).

### Group B — Tools (standalone, test masing-masing)
- [ ] **Task 4 — `read_topic`** (`agent/src/mastra/tools/read-topic.ts`): baca CONTEXT.md dari filesystem
- [ ] **Task 5 — `list_topics`** (`agent/src/mastra/tools/list-topics.ts`): baca INDEX.md, filter opsional
- [ ] **Task 6 — `read_session`** (`agent/src/mastra/tools/read-session.ts`): baca journal transcript
- [ ] **Task 7 — `search_topics`** (`agent/src/mastra/tools/search-topics.ts`): INDEX-primary route → FTS5/vector fallback
- [ ] **Task 8 — `read_resource`** (`agent/src/mastra/tools/read-resource.ts`): baca resource file dari disk
- [ ] **Task 9 — `ingest_resource`** (`agent/src/mastra/tools/ingest-resource.ts`): copy file + Xberg extraction + graph edge link

### Group C — Assembly & IPC
- [ ] **Task 10 — Chat assembly** (modify `agent/src/index.ts`): import agent factory + semua tool → agent beneran. Tambah **stdin/stdout JSON-line listener** (Tauri IPC protocol). HTTP `/health` tetap untuk dev.
- [ ] **Task 11 — Tauri bridge** (`src-tauri/src/commands.rs` + `tauri.conf.json`): register sidecar di `externalBin`, Rust command `chat(message)` → JSON stdin → baca stdout → balas ke frontend. *(Rust dikerjakan bareng)*
- [ ] **Task 12 — Frontend wire** (React component): panggil `invoke("chat", {message})`, tampilkan response. Text input + chat bubble minimal.

### Group D — Close out
- [ ] **Task 13 — Final**: update PROGRESS.md, full offline suite + smoke test (real Gemini)

**Deliverable:** Working conversational agent dengan INDEX-primary routing + 6 retrieval tools + native IPC bridge + frontend chat minimal.

---

## Phase 5: Frontend — Chat UI & Settings [ ]

**Scope:** Desktop UI: chat interface, settings, pixel art aesthetic. IPC bridge sudah selesai di Phase 4 — tinggal UI.
**Arsitektur komunikasi:** React → `invoke("chat")` (Tauri command, sudah dibangun Phase 4) → stdio → sidecar → balas.

- [ ] Chat UI: message list (markdown rendering), text input, file attachment, typing indicator, error display
- [ ] Settings page: data directory (first-launch flow), model selection (dari provider registry Phase 4), about
- [ ] Pixel art styling: cozy palette, pixel fonts, custom decorative elements, grid-aligned layout
- [ ] **Test:** Component rendering, full chat flow (message → agent → response → display), settings persistence
- **Deliverable:** Working desktop UI with chat + settings + pixel art aesthetic

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

### INDEX.md sebagai router utama (INDEX-primary) [OPEN — lihat Phase 3b, issue #2/#3/#4]

`INDEX.md` dimaksud SPEC sbg peta topik utama (routing + konteks ringkas), tapi `ensureIndex` (`topics.ts:76-84`) cuma bikin sekali & stale. Kini dikunci jadi **router utama**: disuntik ke konteks agent, LLM rute via peta, SQLite `search_topics` turun jadi fallback; observer mekanis regenerate pasca-ekstraksi. Lihat Phase 3b.

### Cross-link edges [✅ DONE — lihat Phase 3 "CONTEXT.md compaction + cross-link edges"]

SPEC §6 baris 187: jika satu sesi menyentuh ≥2 topik, tulis edge di tabel `edges` + referensi inline di CONTEXT.md (`See [notes](resources/...md)`). Diimplementasikan di Slice 5 (`edges.ts` + pipeline step 6b).

### Topic re-consolidation [✅ SUPERSEDED — diganti compact-on-update di Phase 3]

Desain lama (append-only + provenance markers) di bawah ini digantikan oleh model token-cap compaction. Disimpan sebagai catatan sejarah.

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
