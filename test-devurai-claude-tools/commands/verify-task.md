---
description: Verify the current branch's diff against its ClickUp task and post a summary comment
argument-hint: "[task id / URL] [working|last-commit|branch to force diff mode]"
allowed-tools: Bash(git *), Bash(clickup *)
---

You are running the **task↔code verification** workflow. Goal: compare what a ClickUp
task asks for against what the code actually implements, walk the developer through the
discrepancies, and post a summary comment back to ClickUp.

ClickUp access (the `clickup` wrapper, CLI commands, JSON shapes, token model,
and safety rules) is documented in the **`clickup-access`** skill — read and follow it
for every ClickUp call. This file covers only the verification workflow on top of it.

Argument passed by the user (may be empty): `$ARGUMENTS`
It may contain a task id/URL and/or an explicit diff-mode keyword
(`working`, `last-commit`, `branch`). Anything that isn't a mode keyword is the id/URL.

## Step 0 — Preflight

Do the `clickup-access` preflight: ensure `CLICKUP_TOKEN` is set in the environment,
then `clickup version` to confirm the sandbox works (first run builds the image).

## Step 1 — Resolve the ClickUp task id (host side, no GitHub)

Follow the id-resolution rules in `clickup-access`. In short, stop at the first that works:

1. **Explicit argument** — id/URL from `$ARGUMENTS` (strip any mode keyword first).
2. **Branch name** — `git rev-parse --abbrev-ref HEAD`, extract a `CU-<id>` marker or a
   `[A-Z]+-[0-9]+` custom-id pattern.

If neither yields exactly one id — **ask the developer**, never guess. Note: in
trunk-based work (Step 3, mode B) HEAD sits on a base branch, so branch-name detection
won't help and the id must come from the argument or the developer.

## Step 2 — Fetch the task

`clickup task view <ID> --json` and read: name, status, the **full
description**, and any checklists/acceptance criteria. Show the developer a short header.
If the description is empty, say so — an empty spec is itself a finding. Optionally
`clickup comment list <ID> --json` to avoid duplicating a prior summary.

## Step 3 — Compute the diff (pick the mode)

First pick a **base branch**: first existing of `dev`, `develop`, `main`, `master`
(`git rev-parse --verify <name>`); prefer `origin/<base>` if more current.

Then choose the **diff mode**. If `$ARGUMENTS` forces one (`working`/`last-commit`/
`branch`), use it. Otherwise **auto-detect** from repo state:

- **Mode A — branch** (HEAD is on a feature branch, i.e. *not* a base branch):
  the developer made a dedicated branch for this task.
  ```
  git diff <base>...HEAD --stat
  git diff <base>...HEAD
  ```
  Three-dot (merge-base) diff — only what THIS branch changed.

- **Mode B — trunk** (HEAD *is* a base branch, e.g. work done directly on `develop`):
  there's no feature branch, so `<base>...HEAD` is meaningless. Verify the actual edits:
  - **Working tree dirty** → check the uncommitted work (the usual "before I commit"
    case):
    ```
    git status --porcelain        # includes untracked files
    git diff HEAD                  # staged + unstaged tracked changes
    ```
    Untracked files won't appear in `git diff` — list them from `status` and read the
    relevant ones explicitly. Never let them fall through silently.
  - **Working tree clean** → the task was finished in a commit (the "±one commit on
    develop" case); verify the latest commit:
    ```
    git show HEAD --stat
    git show HEAD
    ```

**Always state which base, which mode, and why** you chose it. If the chosen mode's diff
is empty, say so and offer the other mode — don't silently report "nothing implemented".
Also, whatever the mode, if there are **uncommitted/untracked** changes you did *not*
include, flag them — they won't reach a PR and the developer should know they're excluded.
If the diff is large, read it in sections; never truncate silently.

## Step 4 — Analyze discrepancies

Map each task requirement / acceptance-criterion to exactly one status:

- ✅ **Implemented** — present in the diff and matches intent.
- ❌ **Missing** — required, absent from the diff.
- ➕ **Out of scope** — in the diff, not asked for (scope creep / stray change).
- ❓ **Unclear / partial** — touched but ambiguous, incomplete, or possibly wrong.

Cite file paths and line ranges (`path/to/file.ts:42-58`). Don't invent requirements the
task doesn't state; don't assume code outside the diff.

## Step 5 — Walk the developer through it

Numbered list. For each ❌/➕/❓ item, ask the developer to choose:

- **fix** — they'll change the code (note it; do not edit unless asked).
- **skip** — intentionally not doing / acceptable as-is.
- **comment** — leave a note on the task; capture the note text.

List ✅ items too (no decision needed) so the summary is complete. Collect all decisions
before posting; allow free-form notes per item.

## Step 6 — Post the summary comment

Build a Markdown summary: one line per requirement with status, decision, and any note.
Include base branch, current branch, **and the diff mode used** for traceability; if any
uncommitted work was excluded, note that too. **Confirm with the developer before
posting** (this writes to ClickUp), then:

```
clickup comment add <ID> "<SUMMARY MARKDOWN>"
```

Report the result (the JSON response) and print the summary locally too.

## Guardrails

- Read-only on ClickUp until Step 6 — `comment add` is the only write, gated on explicit
  confirmation (see `clickup-access`).
- Never edit code here; this is verification, not implementation.
- Don't use the CLI's GitHub `link`/PR features or its branch auto-detect — id resolution
  stays on the host (Step 1).
- If any step fails (no token, task not found, CLI error), stop and report plainly —
  never fabricate task content or a successful post.
