# Wiki Plugin

A Claude Code plugin that maintains a project-scoped wiki of decisions, patterns,
and architectural insights, with semantic search via a local-embedding MCP server.

> **Experimental.** This is the MCP/semantic-search variant. It ships heavy
> dependencies (`@huggingface/transformers` + a local ~80MB embedding model) and
> runs a persistent MCP process per session. See "Cost" below.

## Components

| Component | What it does |
|---|---|
| `/wiki:init` | Bootstrap a project wiki |
| `/wiki:cognite` | Capture insights — natural language arguments for different sources |
| `/wiki:ask` | Query the wiki — ask questions, get synthesized answers |
| `wiki_search` MCP tool | Semantic search over wiki entries (local embeddings, cosine similarity) |
| SessionStart hook | Injects wiki awareness into every session (silent if no `wiki/`) |
| `wiki` skill | Tells Claude when and how to use the wiki |

## How it works

1. The wiki is **opt-in per project**: nothing happens until a `wiki/` directory
   exists. Run `/wiki:init` to bootstrap it.
2. The MCP server (`src/`) scans `wiki/`, embeds each entry locally, caches the
   vectors in `wiki/.index.json` (gitignored), and answers `wiki_search` queries
   by cosine similarity.
3. The SessionStart hook lists wiki topics into context so Claude remembers to use it.

## Wiki structure (per project)

```
wiki/
├── <folders>/       # Created dynamically based on project needs
│   └── *.md         # One file per insight, decision, or pattern
├── README.md        # Human-facing explanation
├── GUIDE.md         # Scope and style conventions for this project's wiki
└── .index.json      # Vector index cache (gitignored)
```

Folders are not fixed — they're created organically as entries are written. The
structure adapts to each project.

## Commands

```
/wiki:init                             # Bootstrap wiki in current project

/wiki:cognite                          # On branch: capture changes since merge-base
                                       # On main: asks what to process

/wiki:cognite commits since friday     # Scan recent commits
/wiki:cognite last 10 commits          # Scan specific count
/wiki:cognite latest                   # Walk back until wiki is current
/wiki:cognite sessions from this week  # Mine past conversations (verified against code)
/wiki:cognite overall                  # Snapshot current project state
/wiki:cognite main                     # Diff current branch against main

/wiki:ask why did we choose postgres?  # Search wiki and synthesize an answer
/wiki:ask how does auth work?          # Interactive Q&A over wiki entries
```

## Cost (why this is the "heavy" variant)

- ~300-500MB of `node_modules` (transformers + onnxruntime native binaries)
- ~80MB embedding model downloaded on first use to `~/.cache/huggingface/`
- A persistent Node MCP process per session in any project that has `wiki/`

For small wikis a keyword/grep approach is far lighter; semantic search earns its
weight only as the wiki grows to hundreds of entries.

## Development

```bash
cd wiki-plugin
npm install
npm test          # run the vitest suite
npm run smoke     # build a temp index and run sample searches
npm run dev       # start the MCP server on stdio
```
