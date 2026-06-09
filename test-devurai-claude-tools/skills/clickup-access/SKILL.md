---
name: clickup-access
description: >-
  How to read from ClickUp via the sandboxed `clickup` wrapper shipped with
  this plugin. Use whenever a task needs ClickUp data (task details, comments,
  statuses). Read-only: writing to ClickUp is disabled for now. Covers the CLI
  commands, JSON output shapes, the token/sandbox model, and the safety rules.
---

# ClickUp access (sandboxed CLI)

All ClickUp calls go through the **`clickup`** command — a wrapper shipped in this
plugin's `bin/` (so it's on `PATH` while the plugin is enabled). It runs the triptech
ClickUp CLI inside a hardened, disposable `podman` container. Never call the raw CLI
binary or the ClickUp HTTP API directly; always go through the `clickup` wrapper.

**Read-only mode.** Writing to ClickUp is disabled for now. Use only the read
commands below — never run any command that creates, edits, or deletes data
(comments, tasks, statuses, fields, etc.). If a workflow needs a write, stop and
report it instead of performing it.

## Why the wrapper exists (don't bypass it)

- **No repo access for the binary.** Source is never mounted in, so the tool can't
  read your code. Anything that needs the repo (e.g. resolving a task id from a
  branch name) you do yourself on the **host**, then pass the result in explicitly.
- **Token never touches disk.** `CLICKUP_TOKEN` (personal `pk_...` token) is piped
  into the container via stdin into a tmpfs `HOME`; `--rm` kills the auth config
  with the container. `--cap-drop=ALL`, `no-new-privileges`, read-only rootfs.
- **Do NOT use the CLI's own git/branch auto-detect or its GitHub `link`/PR
  features.** We keep workflows git-host-agnostic and the sandbox repo-blind.

## Preflight

- `CLICKUP_TOKEN` must be set in the environment (never print it). Each developer
  exports their own personal token (`pk_...`) in their shell, e.g.
  `set -x CLICKUP_TOKEN pk_...` (fish) or `export CLICKUP_TOKEN=pk_...` (bash).
  If it's missing, stop and say so.
- First run builds the container image once (`podman` + network needed). Smoke-test
  with `clickup version` — read-only, no task id, writes nothing.

## Commands

Read-only. All commands take `--json` and emit machine-readable JSON.

- `clickup task view <ID> --json` — task details: name, status, the full
  description, subtasks, checklists / acceptance criteria.
- `clickup comment list <ID> --json` — existing comments.
- `clickup version` — smoke-test; writes nothing.

Write commands (e.g. `clickup comment add`, anything that creates/edits/deletes)
are **disabled** — do not run them.

`<ID>` may be a bare id (`86a3xrwkp`) or a custom id (`CU-abc123`, `DEV-42`). Always
pass it explicitly — the wrapper never derives it.

## Resolving a task id (host side, no GitHub)

Do this yourself, never let the CLI guess. Stop at the first that works:

1. **Explicit input** — a URL `https://app.clickup.com/t/abc123` → trailing id; a
   bare/custom id → use as-is.
2. **Branch name** — `git rev-parse --abbrev-ref HEAD`, then extract a `CU-<id>`
   marker or a `[A-Z]+-[0-9]+` custom-id pattern (e.g. `DEV-42`). Note: this fails
   on trunk-based work where HEAD sits on `dev`/`main` — fall back to asking.

If you can't get exactly one id, **ask the human** — never guess. A wrong task id
poisons everything downstream.

## Safety rules

- **Read-only.** Only `task view` / `comment list` / `version` are allowed. Never
  run a write command (`comment add`, or anything that creates/edits/deletes).
- If any call fails (no token, task not found, CLI error), **stop and report
  plainly** — never fabricate task content.
