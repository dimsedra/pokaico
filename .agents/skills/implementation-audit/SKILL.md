---
name: implementation-audit
description: Audit whether the implementation matches what was promised/specified — especially the project's plan/spec for the current (phase-locked) work. Distinct from code-review; verifies ALIGNMENT ("did we build what we said?"), not code quality. Critical, detail-oriented, skeptical. Use when the user says "audit implementation", "sesuai rencana?", "cek alignment", "did we build what we planned", or after a phase is implemented and before merge.
---

# Implementation Audit

The implementation-audit answers one question: **"Did we build what we said we'd build?"** — for the phase where the audit is requested.

This is deliberately different from `code-review`, which asks *"Is the code correct, robust, and well-shaped?"*. A module can pass code-review and still fail an implementation-audit because it quietly dropped a requirement, implemented a feature in a way that doesn't achieve the stated goal, or marked "done" something that has no reachable code path or test. The auditor is a skeptic checking **promises against evidence**.

## When to Use

When the user asks you to:
- "Audit implementation" / "Implementation audit"
- "Sesuai rencana?" / "Cek alignment" / "Apakah sudah sesuai spesifikasi?"
- "Did we build what we planned?" / "Verify against the spec"
- "Cek apakah yang dikerjakan sesuai issue/ADR/phase"
- After a phase is implemented, especially before merge / opening a PR
- Wants alignment verification, not (only) code quality

If the user wants code *quality* (bugs, types, edge cases, perf), use `code-review` instead. Often run both, but keep the questions separate.

## How to use

### 0. Establish the audit scope (the "what was promised")
The phase is the contract. Identify it first:
1. Read `PROGRESS.md` to find the **currently-unlocked/active phase** (and the sub-step the work claims to complete). This is the primary contract.
2. Read the phase's source-of-truth spec: the relevant section of `SPEC.md`, the GitHub issue(s) for the work (`gh issue view <n>`), any ADR under `docs/adr/` or referenced `*.md`, and the design/plan notes agreed before implementation.
3. Pull in `AGENTS.md` conventions (phase-locking, TDD, modularity) as acceptance criteria.
4. Also capture **claims made in the conversation** — the user's asks, the agent's "done" summaries, commit messages. These are promises too.

Be explicit about which document is the authority for each requirement. If sources conflict, flag the conflict as a finding (don't silently pick one).

### 1. Extract the promise list (claims)
From the above, enumerate **every normative statement** — anything that says what the system *must* / *should* do, behave, prevent, or produce. For each claim record:
- **ID** (C1, C2, …)
- **Source** (file:line / issue # / ADR / chat line)
- **Promise** — verbatim or close paraphrase
- **Acceptance signal** — the observable behavior + entry point that would prove it (and the test that must exist)

Keep claims at the granularity the spec used. Don't invent requirements that weren't promised, but DO include implicit requirements the spec clearly implies (label them "implied").

### 2. Collect evidence (skeptically)
For each claim, hunt for proof that it is *actually achieved in behavior*, not merely present in code:
- **Reachable path:** is the code invoked from a real entry point (pipeline step, exported function in the phase's flow)? Dead code that "implements" a feature counts as **Missing**.
- **Test exists & passes:** is there a test asserting the behavior, not just exercising the function? A test that can't fail (tautological) or only checks shape counts as **Unverified**.
- **No silent deviation:** did the implementation choose a different mechanism than the plan *without saying so*? Even if it works, unannounced deviation is a **Deviation** — the plan is the contract.
- **Side-effects:** did this change break or alter a previously-aligned promise elsewhere? Check the git diff against the rest of the codebase (dependency drill).

Read full files, not just diffs. For a phase diff, also read the files the changed code calls to confirm the promise is honored end-to-end.

### 3. Verdict per claim

| Verdict | Meaning | Action |
|---|---|---|
| ✅ **Aligned** | Implemented, reachable, and a real passing test proves the behavior | None |
| 🟡 **Partial** | Implemented but only partly meets the promise, or only the happy path | Close the gap |
| 🟠 **Deviation** | Implemented *differently* than specified, or different scope than promised, without acknowledgment | Reconcile with plan (change code or change plan) |
| 🔴 **Missing** | Promised but not implemented / only dead code / no reachable path | Implement or formally de-scope |
| ⚪ **Unverified** | Implemented in code but no trustworthy test or reachable path proves it | Add a vertical-slice test at the seam |
| 🔵 **Conflict** | Sources disagree on what was promised | Resolve the spec first |

**Skeptic's defaults:** no passing test ⇒ at best **Unverified**; "looks done" ⇒ suspect until a reachable path is shown; "done" in chat without a test ⇒ **Unverified**.

### 4. Output the audit report (format below)

## Audit dimensions (alignment lens)
While collecting evidence, specifically probe:
1. **Requirement coverage** — every promise from spec/issue/ADR has a corresponding behavior. Missing ones are findings.
2. **Promise vs behavior** — the code does what the claim *literally* says, and the *intent* of the claim is achieved (not just the letter).
3. **Undeclared scope cuts** — plan items that vanished from the implementation or commit log without comment.
4. **Undeclared additions** — things built that weren't in the plan (scope creep / gold-plating) needing justification.
5. **Phase-lock discipline** — work stayed within the unlocked phase; nothing reached into other phases; `PROGRESS.md` updated to reflect completion.
6. **Acceptance criteria honored** — if the issue/plan stated explicit acceptance tests or "definition of done", each is met.
7. **Commit/PR hygiene** — commits map to the promised vertical slices; messages don't over-claim ("fixes X" when X is only partial).
8. **Test truth** — tests assert the promised behavior at the public seam (per `tdd` skill); no tautology, no skipped-by-default smoke masking a gap.

## Finding Classification
(alignment-focused — distinct from code-review's severity scale)

| Level | Meaning |
|---|---|
| 🔴 Missing / Conflict | Promise absent, or sources contradict (blocks "done") |
| 🟠 Deviation | Built differently / unannounced scope change |
| 🟡 Partial / Unverified | Present but incomplete or unproven |
| 🔵 Process | Phase-lock, commit, or test-hygiene lapse (trust gap, not behavior gap) |

## Output Format

```
# Implementation Audit: <phase / issue / module>

Audit scope (the promise contract):
- Phase: PROGRESS.md → <phase name> (locked sub-step: <x>)
- Primary spec: <SPEC.md §x / issue #n / ADR-00xx>
- Also checked: <chat claims, AGENTS.md rules, related code>

---

## Promise → Evidence matrix
| ID | Promise (source)        | Verdict      | Evidence (file:line / test)        |
|----|-------------------------|--------------|------------------------------------|
| C1 | ...                     | ✅ Aligned   | extract.ts:131; tests/extract.test.ts > "..." |
| C2 | ...                     | 🟠 Deviation | ...                                |
| C3 | ...                     | ⚪ Unverified| code present but no test           |
...

## 🔴 Critical (Missing / Conflict)
### Cx. <title> (source)
- **Promise:** verbatim
- **Found:** what's actually there
- **Gap:** why it's not aligned
- **Required to close:** concrete action + test

## 🟠 Deviation
...

## 🟡 Partial / Unverified
...

## 🔵 Process
...

---
## Summary
- Aligned: X • Partial: X • Deviation: X • Missing: X • Unverified: X • Conflict: X
- Promises fully met: X / total
- **Verdict:** ✅ Aligned / ⚠️ Aligned-with-gaps / ❌ Not aligned
- **Blocker before merge:** <list or "none">
```

## Notes
- This skill verifies *alignment*, not *quality*. Run `code-review` separately for correctness/robustness.
- The phase spec is the contract; the agent's "done" message is a claim, not proof.
- When in doubt, downgrade the verdict (Aligned → Unverified) and ask for the test.
- If the spec itself is ambiguous, file it as 🔵 Conflict / "spec gap" rather than guessing.
