```
╔════════════════════════════════════════╗
║                                        ║
║  █▀█ █▀█ █▄▀ █▀█ █ █▀▀ █▀█            ║
║  █▀▀ █▄█ █ █ █▀█ █ █▄▄ █▄█            ║
║                                       ║
║      a cozy AI lifespace  ✦           ║
║                                        ║
╚════════════════════════════════════════╝
```

There are so many cool ways to work with AI right now. Companions, workspaces, agents that build things for you. I genuinely love watching this space grow.

Pokaico is my little corner in that world. Not better — just different. Built around a quiet idea.

*Most AI tools remember your last conversation. Some remember a few. What if your companion truly knew you?*

Not just your chat history. The patterns. What matters to you. How you like to communicate. All of it — growing with you, every session, without you ever having to repeat yourself.

---

## how it works

Pokaico sits on your desktop. Right there, in its own window. Pixel art glowing softly. Ready.

Every conversation becomes a **journal entry** — faithful, immutable, markdown. What was said, exactly as it was said. These files live on your machine. You can open them with Notepad.

Then, quietly, while you're doing other things, a background worker reads those journals and starts to see patterns.

It's called a **memory pipeline**. It takes each journal, summarizes the conversation, and asks: *is there anything new here?* If there is, it gently updates the right topics. Some are about your life — your hobbies, your work, your people. Some are foundational — who you are, your background, how you like to talk. These get refreshed every time, so your pokai never goes stale.

Everything lives in plain markdown:

```
memory/
 ├─ INDEX.md                    ← routing map, rebuilt every extraction
 └─ topics/
     ├─ hiking/
     │   ├─ CONTEXT.md          ← "User hikes every weekend. Prefers trails over roads."
     │   └─ resources/          ← overflow content, long conversations
     ├─ user-profile/
     │   └─ CONTEXT.md          ← foundational — updated every session
     ├─ user-background/
     │   └─ CONTEXT.md          ← foundational
     ├─ user-patterns/
     │   └─ CONTEXT.md          ← foundational (recurring patterns)
     └─ ...
```

The companion reads from these files. It first checks `INDEX.md` — a compact routing map of every topic and their connections. If it finds a match, it reads the topic's `CONTEXT.md` directly from the filesystem. No embedding call, no vector search. Just fast, deterministic file reads. When the routing map doesn't have an answer, it falls back to hybrid search (vector + FTS5) as a secondary option. But the common path is a direct read — your pokai goes straight to the right file and reads what it needs.

You can browse the topics any time. Edit them. Delete them. They're just folders and markdown — yours to keep, yours to understand.

A SQLite database sits alongside as a fast search index. Delete it anytime — it rebuilds from your journals. The source of truth is always the files.

---

## what it is and what it isn't

Pokaico is:

- A cozy desktop companion with pixel art and warm vibes
- A memory that actually sticks — persistent, organized, growing
- Files on your machine you can read with any text editor
- Free, offline-first (local embedding search, optional cloud LLM for extraction)

Pokaico isn't:

- A productivity tool (no kanban, no calendars, no email)
- A cloud service (journals stay on your machine; LLM calls use your API key)
- A generic chatbot wrapper
- Trying to be the fastest, smartest, or most powerful anything

---

## what's inside

**journal** — immutable, append-only transcript of every turn. Write-only. Never mutated.

**memory pipeline** — a background worker that distills conversations into organized topics. Uses Gemini (free tier) for now, but the pipeline is model-agnostic. Guard → summarize → refresh foundational → extract (deterministic INDEX pre-check) → compact → write → reindex → observer rebuild INDEX. Every step verified with 247 tests.

**topics** — folders of CONTEXT.md files. Organized. Searchable. Updated every session. Never cluttered because old content overflows to resources/ instead of endless accumulation.

**tools** — retrieval is a two-tier system. `INDEX.md` is the primary router: the agent matches your question against topic summaries using simple word overlap (fast, deterministic, zero model cost). When that doesn't find a match, it falls back to `search_topics` (hybrid vector + FTS5). Other tools like `read_topic`, `list_topics`, `read_resource`, `read_session`, and `ingest_resource` handle everything else — reading content, browsing the graph, and importing files.

**all local** — SQLite + FTS5 + sqlite-vec for fast retrieval. E5-small for embeddings (384-dim, multilingual, CPU-friendly). No API keys required for search.

---

## tech

Built with care, for people who want their AI to feel like home.

`Tauri 2` &middot; `React` &middot; `TypeScript/Node.js` &middot; `Mastra` &middot; `SQLite`

---

## come say hi

Pokaico isn't quite ready yet. I'm building it slowly — a lot of thought, a fair amount of pixel art, and way too many tests for a v0.1.

Star the repo if you'd like to follow along. Pull requests and ideas are welcome, but so is just saying hello.

---

```
    ◜◝  ◜◝
   (◕‿◕)      pokaico
    ◟◞  ◟◞    a cozy AI lifespace
```
