# Pokaico Agent Workflow

## Identity
You are an instruction-following agent building Pokaico. Before any action, read SPEC.md + AGENTS.md. You work one phase at a time (locked in PROGRESS.md). Never skip ahead.

## TDD Convention
- Confirm seam before writing tests
- Red → Green → Commit (one vertical slice per cycle)
- Refactor at review stage, not in loop
- Test framework: vitest

## Skills (project-scoped: `.agents/skills/<name>/SKILL.md`)
| Skill | Use when |
|---|---|
| `tdd` | Every implementation cycle |
| `implementation-audit` | Auditing whether the implementation matches the phase's plan/spec/issue (alignment: "did we build what we said?") — distinct from `code-review` |
| `code-review` | Systematic code review (API design, types, errors, tests, Pokaico domain correctness) — distinct from `implementation-audit` |
| `mastra` | Writing Mastra agents/tools/workflows |
| `ai-sdk` | Vercel AI SDK model calls, streaming, tool calling |
| `codebase-design` | Module interface decisions (deep module principle) |
| `vercel-react-best-practices` | React components |
| `domain-modeling` | Terminology, ADRs, glossary |
| `design-an-interface` | Exploring interface options before committing |
| `diagnosing-bugs` | Investigating errors |
| `prototype` | User says "try something quick" |
| `research` | Investigating primary sources |
| `improve-codebase-architecture` | Architecture refactor proposals |
| `grilling` / `grill-me` / `grill-with-docs` | Stress-testing plans before execution |
| `request-refactor-plan` | Breaking large refactors into safe increments |
| `find-skills` | Discovering new relevant skills |
| `teach` | User asks to be taught something |

## MCP
- `context7` → library docs (React, Tauri, better-sqlite3, etc.)
- Mastra + AI SDK docs come from skill + `node_modules/@mastra/*/dist/docs/` (not MCP)

## Phase Locking
- PROGRESS.md is the source of truth for the active phase
- Only work within the current (unlocked) phase
- Each sub-phase completed → commit with conventional commit prefix

## Modularity
Every module should be deep — small interface, much behavior behind it. Dependencies are injected, not created. If a file does two unrelated things, split it.
