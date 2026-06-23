---
description: Align changes with the ClickUp task, review the code for bugs, stage it, and print a commit message (does not commit)
argument-hint: "[clickup task id / URL]"
allowed-tools: Bash(git *), Bash(clickup *)
---

Get the developer's current changes ready to commit: align with the ClickUp task, review the
code, stage selectively, and print a commit message. **Stages but does not commit; read-only
on ClickUp.** Follow the **`clickup-access`** skill for every ClickUp call.

`$ARGUMENTS`, if present, is a ClickUp task id / URL.

## 1. Align with ClickUp (optional)

Resolve the task id per `clickup-access`: explicit `$ARGUMENTS`, then branch name
(`CU-<id>` / `[A-Z]+-[0-9]+`). If none resolves, **ask**; if still none, **skip this step**
and say in the output that no ClickUp alignment was done.

With an id: preflight (`CLICKUP_TOKEN`, `clickup version`), then `clickup task view <ID> --json`
(name, status, full description, acceptance criteria). Map changes to requirements, citing
`path:line`: ✅ Implemented · ❌ Missing · ➕ Out of scope · ❓ Unclear. Flag any ❌/➕/❓
before staging.

## 2. Gather the changes

```
git status --porcelain   # includes untracked
git diff HEAD            # tracked changes
```

Read untracked files explicitly — they won't show in `git diff`. Read large diffs in sections.
No changes → stop and say so.

## 3. Review the code

Read the changed code; report each finding as `path:line` + what's wrong + a short fix:

- **Bugs** — logic errors, null/undefined, wrong conditions, broken edge cases.
- **Risks** — races, missing error handling, security (injection, leaked secrets, unsafe
  input), resource leaks, breaking changes.
- **Bad practices** — dead/debug code, leftover `TODO`/`console.log`, hardcoded values, duplication.

Flag serious issues prominently and ask whether to proceed. If clean, say so.

## 4. Stage selectively

**Before `git add`, list exactly what will be staged — name every untracked file — and confirm.
Never `git add -A` blindly.** Exclude files that shouldn't be committed even if in scope:
secrets/local config (`.env`), build artifacts, generated indexes, editor junk. Stage the
agreed set explicitly (`git add <path> …`) and state what you staged. **Do not `git commit`.**

## 5. Commit message

Conventional commit from the staged changes:

- Imperative subject ≤ ~72 chars (e.g. `fix: handle empty task id`).
- Body (when warranted) explaining the *why*; reference the task id if resolved.
- **No `Co-Authored-By` / AI-attribution lines.**

Print it in a fenced block, then the ready-to-run `git commit -m "…" -m "…"`. Do **not** run it.

## Guardrails

- Read-only on ClickUp; never `clickup comment add`.
- Stages only; never `git commit`. Never `git add -A` blindly — list first, exclude
  secrets/artifacts/generated files.
- No `Co-Authored-By`/AI-attribution lines.
- On any failure (no token, task not found, CLI error, no changes), stop and report plainly —
  never fabricate.
