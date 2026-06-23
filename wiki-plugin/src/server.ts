import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createEmbedder, type Embedder } from "./embeddings.js";
import { scanWikiFiles, loadEntry } from "./indexer.js";
import { loadIndex, buildIndex, searchIndex, type IndexedEntry } from "./search.js";

/** Truncate entry bodies in search results so a few large entries can't blow
 * up the model's context window. */
const MAX_BODY_CHARS = 1200;

/** Cosine-similarity floor below which a hit is treated as noise rather than a
 * match. Without it the tool always returns top_k entries, so an off-topic
 * query gets back unrelated docs and the model can't tell "here's the answer"
 * from "the wiki doesn't cover this". Tuned for the normalized MiniLM space:
 * on-topic queries land well above it, clearly unrelated ones below. */
const MIN_RELEVANCE_SCORE = 0.3;

function truncateBody(body: string): string {
  if (body.length <= MAX_BODY_CHARS) return body;
  return `${body.slice(0, MAX_BODY_CHARS).trimEnd()}\n\n…[truncated]`;
}

export function createWikiServer(wikiPath: string): McpServer {
  const server = new McpServer({
    name: "wiki",
    version: "0.1.0",
  });

  let embedderPromise: Promise<Embedder> | null = null;
  let cachedEntries: IndexedEntry[] = [];
  let cachedSignature = "";
  let inflight: Promise<IndexedEntry[]> | null = null;

  function getEmbedder(): Promise<Embedder> {
    // Cache the promise (not the resolved value) so concurrent callers share
    // one model load instead of each spawning their own.
    if (!embedderPromise) {
      embedderPromise = createEmbedder().catch((err) => {
        embedderPromise = null; // allow retry on a later call
        throw err;
      });
    }
    return embedderPromise;
  }

  /** Cheap fingerprint of the wiki tree: re-reads/re-embeds only when a file's
   * path or mtime actually changes. */
  function signatureOf(files: { relativePath: string; mtimeMs: number }[]): string {
    return files
      .map((f) => `${f.relativePath}:${f.mtimeMs}`)
      .sort()
      .join("|");
  }

  async function rebuild(): Promise<IndexedEntry[]> {
    const scannedFiles = await scanWikiFiles(wikiPath);
    const signature = signatureOf(scannedFiles);
    // Nothing changed since the last build — reuse the in-memory index without
    // re-reading file contents.
    if (cachedSignature === signature && cachedEntries.length > 0) {
      return cachedEntries;
    }

    const wikiEntries = await Promise.all(scannedFiles.map(loadEntry));
    const existingIndex = await loadIndex(wikiPath);
    const index = await buildIndex(
      wikiPath,
      scannedFiles,
      wikiEntries,
      await getEmbedder(),
      existingIndex,
    );

    cachedEntries = index.entries;
    cachedSignature = signature;
    return cachedEntries;
  }

  async function ensureIndex(): Promise<IndexedEntry[]> {
    if (!existsSync(wikiPath)) {
      return [];
    }
    // Single-flight: concurrent searches share one rebuild, preventing
    // racing writes to .index.json.
    if (inflight) return inflight;
    inflight = rebuild().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  server.tool(
    "wiki_search",
    "Search the project wiki for decisions, patterns, and architectural insights. Returns the most semantically relevant entries.",
    {
      query: z.string().describe("Natural language search query"),
      top_k: z
        .number()
        .int()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Number of results to return"),
    },
    async ({ query, top_k }) => {
      if (!existsSync(wikiPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No wiki directory found. This project has not initialized a wiki. Run /wiki to set one up.",
            },
          ],
        };
      }

      const entries = await ensureIndex();

      if (entries.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Wiki exists but has no entries yet. Run /wiki to populate it.",
            },
          ],
        };
      }

      const queryEmbedding = await (await getEmbedder()).embed(query);
      const ranked = searchIndex(entries, queryEmbedding, top_k);
      const results = ranked.filter((r) => r.score >= MIN_RELEVANCE_SCORE);

      if (results.length === 0) {
        const best = ranked[0]?.score ?? 0;
        return {
          content: [
            {
              type: "text" as const,
              text: `No wiki entries are relevant to this query (best match scored ${best.toFixed(3)}, below the ${MIN_RELEVANCE_SCORE} relevance threshold). The wiki likely does not cover this topic — answer from other sources or say it is undocumented rather than inferring from unrelated entries.`,
            },
          ],
        };
      }

      const formatted = results.map((r) =>
        [
          `## ${r.title}`,
          `File: ${r.id} | Score: ${r.score.toFixed(3)}`,
          "",
          truncateBody(r.body),
        ].join("\n"),
      );

      return {
        content: [
          { type: "text" as const, text: formatted.join("\n\n---\n\n") },
        ],
      };
    },
  );

  return server;
}
