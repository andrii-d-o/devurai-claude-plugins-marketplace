# Wiki Plugin

A Claude Code plugin that maintains a project-scoped wiki of decisions, patterns,
and architectural insights, with semantic search via a local-embedding MCP server.

> **Experimental.** This is the MCP/semantic-search variant. It ships heavy
> dependencies (`@huggingface/transformers` + a local ~80MB embedding model) and
> runs a persistent MCP process per session. See "Cost" below.

## Components

| Component | What it does |
|---|---|
| `/wiki` command | Capture insights — natural language arguments for different sources |
| `wiki_search` MCP tool | Semantic search over wiki entries (local embeddings, cosine similarity) |
| SessionStart hook | Injects wiki awareness into every session (silent if no `wiki/`) |
| `wiki` skill | Tells Claude when and how to use the wiki |

## How it works

1. The wiki is **opt-in per project**: nothing happens until a `wiki/` directory
   exists. The first `/wiki` run creates it.
2. The MCP server (`src/`) scans `wiki/`, embeds each entry locally, caches the
   vectors in `wiki/.index.json` (gitignored), and answers `wiki_search` queries
   by cosine similarity.
3. The SessionStart hook lists wiki topics into context so Claude remembers to use it.

## Wiki structure (per project)

```
wiki/
├── architecture/    # System design, infrastructure choices
├── decisions/       # Specific choices with rationale
├── features/        # Feature descriptions and approach
├── patterns/        # Code patterns and conventions
├── ideas/           # Future work and proposals
└── .index.json      # Vector index cache (gitignored)
```

## /wiki usage

```
/wiki                          # On branch: capture changes since merge-base
                               # On main: asks what to process
                               # First run: bootstraps wiki

/wiki commits since friday     # Scan recent commits
/wiki last 10 commits          # Scan specific count
/wiki latest                   # Walk back until wiki is current
/wiki sessions from this week  # Mine past conversations (verified against code)
/wiki overall                  # Snapshot current project state
/wiki main                     # Diff current branch against main
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
npm run smoke     # build a temp index and run sample searches
npm run dev       # start the MCP server on stdio
```
