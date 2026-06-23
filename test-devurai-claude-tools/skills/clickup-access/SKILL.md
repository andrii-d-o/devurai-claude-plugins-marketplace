---
name: clickup-access
description: >-
  How to read from ClickUp via the sandboxed `clickup` wrapper shipped with
  this plugin. Use whenever a task needs ClickUp data (task details, comments,
  statuses). Read-only: writing to ClickUp is disabled for now. Covers the CLI
  commands, JSON output shapes, the token/sandbox model, and the safety rules.
---

# ClickUp access (sandboxed CLI)

All ClickUp calls go through the **`clickup`** wrapper (shipped in this plugin's `bin/`, so
it's on `PATH` while the plugin is enabled). It runs the triptech ClickUp CLI inside a
disposable, hardened `podman` container. Never call the raw CLI binary or the ClickUp HTTP
API directly.

**Read-only.** Writing is disabled. Use only `task view` / `comment list` / `version`. If a
workflow needs a write, stop and report it.

## Why the wrapper (don't bypass it)

- **Repo-blind.** Source is never mounted in, so the tool can't read your code. Anything that
  needs the repo (e.g. a task id from a branch name) you do on the **host** and pass in.
- **Token off disk.** `CLICKUP_TOKEN` (`pk_...`) is piped via stdin into a tmpfs `HOME`; `--rm`
  kills the auth config with the container. `--cap-drop=ALL`, `no-new-privileges`, read-only rootfs.
- **No CLI git/GitHub features** — keep workflows git-host-agnostic and the sandbox repo-blind.

## Preflight

`CLICKUP_TOKEN` must be set in the environment (never print it) — each developer exports their
own `pk_...` token. If missing, stop and say so. First run builds the image once (`podman` +
network); smoke-test with `clickup version`.

## Commands (read-only, all take `--json`)

- `clickup task view <ID> --json` — name, status, full description, subtasks, checklists.
- `clickup comment list <ID> --json` — existing comments.
- `clickup version` — smoke test.

`<ID>` may be bare (`86a3xrwkp`) or custom (`CU-abc123`, `DEV-42`); always pass it explicitly —
the wrapper never derives it. Write commands (`comment add`, anything that creates/edits/deletes)
are **disabled**.

## Resolving a task id (host side, no GitHub)

Do this yourself; stop at the first that works:

1. **Explicit input** — URL `…/t/abc123` → trailing id; bare/custom id → as-is.
2. **Branch name** — `git rev-parse --abbrev-ref HEAD`, extract `CU-<id>` or `[A-Z]+-[0-9]+`.
   (Fails on trunk-based work — fall back to asking.)

Can't get exactly one id → **ask**, never guess. A wrong id poisons everything downstream.

## Safety

- Read-only: only `task view` / `comment list` / `version`. Never a write command.
- On any failure (no token, task not found, CLI error), stop and report plainly — never fabricate.
