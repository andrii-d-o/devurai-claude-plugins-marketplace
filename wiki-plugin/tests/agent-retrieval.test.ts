import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createWikiServer } from "../src/server.js";

// ---------------------------------------------------------------------------
// End-to-end retrieval as the *agent* sees it.
//
// The agent never calls searchIndex() directly — it calls the `wiki_search`
// MCP tool. This test drives that exact path: a real MCP client talks to a
// real server over an in-memory transport, against a temp wiki built from a
// distractor corpus. We assert the two behaviours that matter for an agent:
//   1. when the wiki covers the question, the right entry comes back; and
//   2. when it doesn't, the tool says so explicitly instead of returning
//      unrelated entries the model might treat as an answer.
// ---------------------------------------------------------------------------

interface Doc {
  id: string; // relative path under the wiki
  title: string;
  body: string;
}

// Topic clusters with near-neighbours so retrieval has to separate intent,
// not just topic: postgres-vs-sqlite vs connection-pooling (both "database"),
// jwt vs oauth vs password-hashing (all "auth"), pg_trgm vs elasticsearch.
const CORPUS: Doc[] = [
  {
    id: "decisions/postgres-vs-sqlite.md",
    title: "Database: chose Postgres over SQLite",
    body: "We needed row-level locking for concurrent writers, which SQLite handles poorly. We accepted extra deployment complexity in exchange for correctness under load. Postgres also gives JSONB columns and a mature extension ecosystem.",
  },
  {
    id: "architecture/connection-pooling.md",
    title: "Connection pooling with PgBouncer",
    body: "Each app instance opened too many Postgres connections, exhausting the server limit. We put PgBouncer in transaction-pooling mode in front of the database so thousands of clients share a small pool of backend connections.",
  },
  {
    id: "decisions/auth-jwt.md",
    title: "Auth: JWT with short-lived access tokens",
    body: "Access tokens expire after 15 minutes. Refresh tokens live server-side and rotate on each use. JWT lets us scale the API horizontally without shared session storage.",
  },
  {
    id: "decisions/oauth-google.md",
    title: "Social login via Google OAuth",
    body: "Users can sign in with their Google account through the OAuth 2.0 authorization-code flow. We map the Google subject id to a local user row on first login and never store the user's Google password.",
  },
  {
    id: "security/password-hashing.md",
    title: "Password hashing with Argon2id",
    body: "Stored passwords are hashed with Argon2id using a per-user salt and a tuned memory cost. We migrated off bcrypt because Argon2 resists GPU cracking better at our parameter budget.",
  },
  {
    id: "features/fulltext-pgtrgm.md",
    title: "Full-text search via pg_trgm",
    body: "Search uses Postgres' pg_trgm trigram matching for fuzzy lookups, ranked by similarity above a 0.3 threshold. This let us avoid running a separate search cluster.",
  },
  {
    id: "decisions/elasticsearch-rejected.md",
    title: "Why we did not adopt Elasticsearch",
    body: "Elasticsearch would have given richer relevance tuning, but operating a separate JVM cluster, keeping it in sync, and the memory footprint were not worth it for our query volume.",
  },
  {
    id: "architecture/redis-cache.md",
    title: "Caching hot reads in Redis",
    body: "Frequently read, rarely changed records are cached in Redis with a short TTL and invalidated on write. This cut median read latency and took pressure off the primary database.",
  },
  {
    id: "ops/rate-limiting.md",
    title: "API rate limiting with a token bucket",
    body: "Each API key gets a token-bucket allowance refilled per second. When the bucket empties we return HTTP 429 with a Retry-After header so clients can back off gracefully.",
  },
  {
    id: "ops/kubernetes-deploy.md",
    title: "Deploying on Kubernetes",
    body: "Services run as Deployments behind an ingress, with rolling updates and readiness probes so traffic only reaches pods that have finished warming up.",
  },
  {
    id: "ops/observability-logging.md",
    title: "Structured logging and tracing",
    body: "Every request carries a correlation id threaded through structured JSON logs and distributed traces, so a single failing request can be followed across services.",
  },
  {
    id: "ops/ci-pipeline.md",
    title: "CI pipeline runs tests on every push",
    body: "Each push triggers lint, type-check and the test suite in parallel; a green run is required before a branch can merge to main.",
  },
];

// Paraphrased queries that avoid the target's keywords, so a hit means semantic
// retrieval rather than word overlap. Topic-sharing pairs (postgres vs pooling,
// jwt vs oauth) check that intent, not just topic, is matched.
const GOLD: { query: string; expected: string }[] = [
  { query: "which relational engine did we pick and why not the embedded one", expected: "decisions/postgres-vs-sqlite.md" },
  { query: "too many open db connections, how did we cap them", expected: "architecture/connection-pooling.md" },
  { query: "how long is a login token valid before it expires", expected: "decisions/auth-jwt.md" },
  { query: "let people sign in with their existing google identity", expected: "decisions/oauth-google.md" },
  { query: "how are user secrets stored so they can't be cracked easily", expected: "security/password-hashing.md" },
  { query: "fuzzy text matching without a dedicated search server", expected: "features/fulltext-pgtrgm.md" },
  { query: "reasons we avoided running a separate search cluster", expected: "decisions/elasticsearch-rejected.md" },
  { query: "speed up repeated reads of data that rarely changes", expected: "architecture/redis-cache.md" },
  { query: "stop a single client from hammering the api too fast", expected: "ops/rate-limiting.md" },
  { query: "rolling out new versions of services without downtime", expected: "ops/kubernetes-deploy.md" },
  { query: "follow one request as it moves across services in the logs", expected: "ops/observability-logging.md" },
  { query: "what must be green before merging a branch", expected: "ops/ci-pipeline.md" },
];

// Plausible-sounding but genuinely undocumented questions. The tool must report
// "not relevant", not hand back the least-bad infra doc.
const OUT_OF_SCOPE = [
  "what is the best chocolate cake recipe",
  "tomorrow's weather forecast for the coast",
  "how do I renew my passport",
];

// Pull the entry ids out of a wiki_search response in rank order. The server
// formats each hit as "File: <id> | Score: <n>", so the order of these lines
// is the ranking the agent sees.
function rankedIds(responseText: string): string[] {
  return [...responseText.matchAll(/^File:\s*(\S+)\s*\|/gm)].map((m) => m[1]!);
}

interface Scorecard {
  recallAt1: number;
  recallAt3: number;
  recallAt5: number;
  mrr: number; // mean reciprocal rank within the returned window, 0 if absent
  abstentionRate: number; // fraction of out-of-scope queries correctly refused
}

async function writeCorpus(dir: string): Promise<void> {
  for (const doc of CORPUS) {
    const file = path.join(dir, doc.id);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `---\ntitle: "${doc.title}"\n---\n\n${doc.body}\n`, "utf-8");
  }
}

describe("Agent retrieval via the wiki_search MCP tool", () => {
  let wikiDir: string;
  let client: Client;
  let card: Scorecard;
  let goldRanks: { expected: string; query: string; rank: number }[]; // rank 1-based, 0 = absent
  let misses: string[];

  // Call the tool exactly as the agent would and return its text payload.
  async function search(query: string, topK = 5): Promise<string> {
    const res = (await client.callTool({
      name: "wiki_search",
      arguments: { query, top_k: topK },
    })) as { content: { type: string; text: string }[] };
    return res.content.map((c) => c.text).join("\n");
  }

  beforeAll(async () => {
    wikiDir = await mkdtemp(path.join(tmpdir(), "wiki-eval-"));
    await writeCorpus(wikiDir);

    const server = createWikiServer(wikiDir);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);

    client = new Client({ name: "test-agent", version: "0.0.0" });
    await client.connect(clientTransport);

    // Warm the index/model once so the scored pass below stays fast.
    await search("warmup query to trigger indexing");

    // Single pass over the gold set: record where the expected doc landed.
    goldRanks = [];
    for (const { query, expected } of GOLD) {
      const ids = rankedIds(await search(query, 5));
      const idx = ids.indexOf(expected); // 0-based, -1 if absent
      goldRanks.push({ expected, query, rank: idx + 1 });
    }
    misses = goldRanks
      .filter((g) => g.rank === 0)
      .map((g) => `${g.expected} ⇐ "${g.query}"`);

    // Out-of-scope pass: did the tool correctly refuse?
    let refused = 0;
    for (const query of OUT_OF_SCOPE) {
      if (/no wiki entries are relevant/i.test(await search(query, 5))) refused++;
    }

    const n = GOLD.length;
    const recallAt = (k: number) =>
      goldRanks.filter((g) => g.rank >= 1 && g.rank <= k).length / n;
    card = {
      recallAt1: recallAt(1),
      recallAt3: recallAt(3),
      recallAt5: recallAt(5),
      mrr: goldRanks.reduce((s, g) => s + (g.rank ? 1 / g.rank : 0), 0) / n,
      abstentionRate: refused / OUT_OF_SCOPE.length,
    };

    // eslint-disable-next-line no-console
    console.log(
      `\nAgent retrieval scorecard (${n} gold queries, ${CORPUS.length} docs):\n` +
        `  Recall@1:   ${(card.recallAt1 * 100).toFixed(1)}%\n` +
        `  Recall@3:   ${(card.recallAt3 * 100).toFixed(1)}%\n` +
        `  Recall@5:   ${(card.recallAt5 * 100).toFixed(1)}%\n` +
        `  MRR@5:      ${card.mrr.toFixed(3)}\n` +
        `  Abstention: ${(card.abstentionRate * 100).toFixed(1)}% (${OUT_OF_SCOPE.length} out-of-scope)\n` +
        (misses.length ? `  misses:\n   - ${misses.join("\n   - ")}\n` : "  misses: none\n"),
    );
  }, 180_000);

  afterAll(async () => {
    await client?.close();
    if (wikiDir) await rm(wikiDir, { recursive: true, force: true });
  });

  it("exposes the wiki_search tool to the agent", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("wiki_search");
  });

  it("distinguishes near-neighbour intent (jwt expiry, not oauth)", async () => {
    const text = await search("how long is a login token valid before it expires", 1);
    expect(text).toContain("decisions/auth-jwt.md");
    expect(text).not.toContain("oauth-google");
  });

  it("ranks the right entry first for most queries (Recall@1)", () => {
    expect(card.recallAt1).toBeGreaterThanOrEqual(0.6);
  });

  it("places the right entry in the top 3 (Recall@3)", () => {
    expect(card.recallAt3).toBeGreaterThanOrEqual(0.8);
  });

  it("surfaces the right entry within the returned window (Recall@5)", () => {
    expect(card.recallAt5).toBeGreaterThanOrEqual(0.85);
  });

  it("ranks correct entries highly on average (MRR@5)", () => {
    expect(card.mrr).toBeGreaterThanOrEqual(0.7);
  });

  it("refuses every out-of-scope query without dumping entries", async () => {
    expect(card.abstentionRate).toBe(1);
    // Spot-check that a refusal leaks no doc ids the model could misread.
    const text = await search(OUT_OF_SCOPE[0]!, 5);
    for (const doc of CORPUS) expect(text).not.toContain(doc.id);
  });
}, 180_000);
