# devurai Claude Code tools (plugin marketplace)

A private [Claude Code plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)
for devurai's internal Claude Code tooling. Install once, get the commands and skills in
every repo you work in.

Currently ships one plugin, **`test-devurai-claude-tools`**, with:

- **`/verify-task`** — checks whether the current branch's diff actually implements its
  ClickUp task, walks you through the discrepancies, and prints a summary locally.
  Read-only on ClickUp (writing is disabled for now).
- **`clickup-access`** skill — how to talk to ClickUp through the sandboxed `clickup`
  wrapper (used by `/verify-task`, reusable by future tools).

## Prerequisites

- **Claude Code**.
- **podman** — the ClickUp CLI runs inside a hardened container (first call builds the
  image once; needs network).
- **A personal ClickUp API token** (`pk_...`): ClickUp → Settings → Apps → *API Token*.
  Export it in your shell (each dev uses their own; it's never committed):
  ```fish
  set -x CLICKUP_TOKEN pk_xxxxxxxx        # fish
  ```
  ```bash
  export CLICKUP_TOKEN=pk_xxxxxxxx        # bash/zsh
  ```
- **Git access** to this private repo (the marketplace is just this git repo — access is
  controlled by your permissions on it).

## Install

In Claude Code:

```
/plugin marketplace add andrii-d-o/devurai-claude-plugins-marketplace
/plugin install test-devurai-claude-tools@devurai-claude-plugins-marketplace
```

The command and skill are then available in any repo you open.

### Or: enable it automatically per-project

To make a specific repo pull this plugin without each dev running the commands above,
commit a `.claude/settings.json` to that repo:

```json
{
  "extraKnownMarketplaces": {
    "devurai-claude-plugins-marketplace": {
      "source": { "source": "github", "repo": "andrii-d-o/devurai-claude-plugins-marketplace" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "test-devurai-claude-tools@devurai-claude-plugins-marketplace": true
  }
}
```

When a teammate opens that repo (and trusts the workspace), the marketplace registers and
the plugin activates automatically. Repos without this file are unaffected — this is how
you scope the tooling to only the projects that want it.

## Usage — `/verify-task`

From inside a git repo on the feature branch you want to check:

```
/verify-task            # auto-detect the ClickUp id from the branch name
/verify-task DEV-42     # explicit id
/verify-task https://app.clickup.com/t/abc123
```

It resolves the task id (from the argument or the branch name, on the host — no GitHub),
fetches the task's description + checklists, diffs the branch against its base
(`dev` → `develop` → `main` → `master`), classifies each requirement
(✅ implemented / ❌ missing / ➕ out of scope / ❓ unclear), asks you **fix / skip /
comment** per item, and prints a Markdown summary locally. It does **not** write back to
ClickUp — the workflow is read-only for now.

> Tip: embed the task id in branch names (e.g. `feature/DEV-42-add-login`) so auto-detect
> works reliably.

## Updating

The marketplace is a git repo, so updates are just commits to it.

- **As a maintainer:** push your changes to `devurai/test-claude-plugin`. The plugin has
  no pinned `version`, so every commit is treated as a new version (commit-SHA
  versioning) — nothing to bump.
- **As a user:** `autoUpdate: true` (above) pulls updates at startup and prompts a
  `/reload-plugins`. Manually: `/plugin marketplace update devurai-claude-plugins-marketplace` then
  `/plugin install test-devurai-claude-tools@devurai-claude-plugins-marketplace`.

## Security

ClickUp access goes through [`bin/clickup`](test-devurai-claude-tools/bin/clickup), which
runs the [triptechtravel/clickup-cli](https://github.com/triptechtravel/clickup-cli)
**built from source at a pinned, security-reviewed commit**
inside a disposable `podman` container:

- **No repo mount** — the binary physically cannot read your source.
- **Token via stdin into a tmpfs HOME** — never written to host disk; dies with the
  `--rm` container.
- `--cap-drop=ALL`, `--security-opt no-new-privileges`, `--read-only` rootfs.
- Built from a **pinned commit** (`17625f64`); re-review the diff before bumping it in
  [Containerfile](test-devurai-claude-tools/Containerfile).

Tear down the image anytime: `podman rmi triptech-clickup:local`.

## Repo layout

```
.claude-plugin/marketplace.json          # marketplace catalog (this repo = the marketplace)
test-devurai-claude-tools/               # the plugin
├── .claude-plugin/plugin.json           # plugin manifest
├── commands/verify-task.md              # /verify-task slash command
├── skills/clickup-access/SKILL.md       # reusable ClickUp-access skill
├── bin/clickup                          # sandboxed ClickUp CLI wrapper (on PATH when enabled)
└── Containerfile                        # builds the CLI from source, pinned + reviewed
```

## Adding more tools

Drop new commands into `test-devurai-claude-tools/commands/<name>.md` and new skills into
`test-devurai-claude-tools/skills/<name>/SKILL.md` — both are auto-discovered, no manifest
edits needed. Commit and push; users pick them up on the next update.
