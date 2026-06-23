---
description: List all commands and skills shipped with the test-devurai-claude-tools plugin
allowed-tools: []
---

Print a concise reference of every command and skill bundled in the
**test-devurai-claude-tools** plugin. No tools needed — output only.

---

## Commands

### `/prepare-commit [task-id/URL]`
Aligns uncommitted changes with a ClickUp task, reviews the code for bugs,
stages everything, and prints a ready-to-copy conventional commit message.
Does **not** run `git commit`. ClickUp alignment is optional — skipped if no
task id can be resolved.

### `/verify-task [task-id/URL] [working|last-commit|branch]`
Compares what a ClickUp task requires against what the current diff actually
implements. Produces a requirement-by-requirement status table
(✅ Implemented · ❌ Missing · ➕ Out of scope · ❓ Unclear) and walks you
through each discrepancy. Fully read-only — nothing is written back to ClickUp.

### `/whats-here`
Shows this reference. Lists every command and skill in the plugin with a short
description of what each one does.

---

## Skills

### `clickup-access`
Documents the sandboxed `clickup` wrapper: available CLI commands, JSON output
shapes, how the token is kept off disk, and the read-only safety rules. Loaded
automatically by `verify-task` and `prepare-commit`; also useful when writing
any new workflow that needs ClickUp data.

---

All ClickUp operations are **read-only**. Writing to ClickUp (comments, task
edits, status changes) is disabled across the entire plugin.
