---
description: Verify the current branch's diff against its ClickUp task and print a summary (read-only)
argument-hint: "[task id / URL] [working|last-commit|branch to force diff mode]"
allowed-tools: Bash(git *), Bash(clickup *)
---

Compare what a ClickUp task asks for against what the code actually implements, walk the
developer through the gaps, and print a summary. **Read-only on ClickUp** — never writes back.

Follow the **`clickup-access`** skill for every ClickUp call (wrapper, commands, token model,
safety). `$ARGUMENTS` may hold a task id/URL and/or a diff-mode keyword (`working`,
`last-commit`, `branch`); anything that isn't a keyword is the id/URL.

## 1. Resolve the task id

Per `clickup-access`, stop at the first that works: explicit `$ARGUMENTS`, then the branch
name (`CU-<id>` or `[A-Z]+-[0-9]+`). Can't get exactly one id → **ask**, never guess.
(In trunk-based work the branch won't help; rely on the argument or the developer.)

## 2. Fetch the task

`clickup task view <ID> --json` — read name, status, the full description, and any
checklists/acceptance criteria; show a short header. An empty description is itself a finding.
Optionally `clickup comment list <ID> --json` to avoid repeating a prior summary.

## 3. Compute the diff

Base branch: first existing of `dev`, `develop`, `main`, `master` (prefer `origin/<base>`).
Use the mode forced by `$ARGUMENTS`, else auto-detect:

- **branch** (HEAD on a feature branch) → `git diff <base>...HEAD` — only what this branch changed.
- **trunk** (HEAD on a base branch) → dirty tree: `git status --porcelain` + `git diff HEAD`
  (read untracked files explicitly); clean tree: `git show HEAD`.

State the base, the mode, and why. If the chosen diff is empty, say so and offer the other
mode. Flag any uncommitted/untracked changes you excluded. Read large diffs in sections.

## 4. Map requirements

Each requirement / acceptance-criterion → one status, citing `path:line`:
✅ Implemented · ❌ Missing · ➕ Out of scope · ❓ Unclear/partial.
Don't invent requirements or assume code outside the diff.

## 5. Walk the developer through it

Numbered list. For each ❌/➕/❓ ask: **fix** / **skip** / **comment** (capture the note text).
List ✅ items too. Collect all decisions before printing.

## 6. Print the summary (local only)

Markdown, one line per requirement: status, decision, note. Include base, branch, diff mode,
and any excluded work. **Print to console only — do NOT post to ClickUp** (writing is disabled).

## Guardrails

- Read-only on ClickUp; never `clickup comment add`.
- Verification only — never edit code.
- Id resolution stays on the host; don't use the CLI's GitHub/branch features.
- On any failure (no token, task not found, CLI error), stop and report plainly — never fabricate.
