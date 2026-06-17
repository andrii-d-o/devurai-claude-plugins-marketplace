// Smoke test: build an index over sample entries and run a few searches.
// Replaces the heavy vitest suite for quick manual verification.
//   npx tsx scripts/smoke.ts
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEmbedder } from "../src/embeddings.js";
import { scanWikiFiles, loadEntry } from "../src/indexer.js";
import { buildIndex, searchIndex } from "../src/search.js";

const SAMPLES: Record<string, string> = {
  "architecture/database.md": `---
title: "Database: chose Postgres over SQLite"
tags: [database, architecture]
date: 2026-03-15
---

We needed row-level locking for concurrent writers, which SQLite doesn't
support well. Trade-off: deployment complexity for correctness.`,
  "decisions/auth-flow.md": `---
title: "Auth: JWT with short-lived access tokens"
tags: [auth, security]
date: 2026-03-20
---

Access tokens expire after 15 minutes. JWT lets us scale the API
horizontally without shared session storage.`,
  "features/search.md": `---
title: "Full-text search via pg_trgm"
tags: [search, postgres]
date: 2026-04-01
---

Search uses PostgreSQL's pg_trgm extension for trigram-based fuzzy matching.
This avoids adding Elasticsearch as a dependency.`,
};

const QUERIES = [
  "which database did we choose and why",
  "how does authentication work, tokens, sessions",
  "fuzzy text search implementation",
];

async function main() {
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-smoke-"));
  try {
    for (const [rel, content] of Object.entries(SAMPLES)) {
      const full = path.join(dir, rel);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, content, "utf-8");
    }

    console.log("Loading embedder (first run downloads ~80MB model)...");
    const embedder = await createEmbedder();
    const files = await scanWikiFiles(dir);
    const entries = await Promise.all(files.map(loadEntry));
    const index = await buildIndex(dir, files, entries, embedder, null);
    console.log(`Indexed ${index.entries.length} entries.\n`);

    let ok = true;
    for (const q of QUERIES) {
      const qe = await embedder.embed(q);
      const results = searchIndex(index.entries, qe, 3);
      const top = results[0]!;
      console.log(`Query: "${q}"`);
      for (const r of results) {
        console.log(`  ${r.score.toFixed(3)}  ${r.id}`);
      }
      console.log("");
      if (top.score < 0.2) ok = false;
    }

    console.log(ok ? "SMOKE PASS" : "SMOKE WARN: low top scores");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
