import { existsSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createEmbedder, type Embedder } from "./embeddings.js";
import { scanWikiFiles, loadEntry } from "./indexer.js";
import { loadIndex, buildIndex, searchIndex, type IndexedEntry } from "./search.js";

export function createWikiServer(wikiPath: string): McpServer {
  const server = new McpServer({
    name: "wiki",
    version: "0.1.0",
  });

  let embedder: Embedder | null = null;
  let cachedEntries: IndexedEntry[] = [];
  let lastIndexTime = 0;

  async function getEmbedder(): Promise<Embedder> {
    if (!embedder) {
      embedder = await createEmbedder();
    }
    return embedder;
  }

  async function ensureIndex(): Promise<IndexedEntry[]> {
    if (!existsSync(wikiPath)) {
      return [];
    }

    const now = Date.now();
    // Re-check files at most every 5 seconds
    if (cachedEntries.length > 0 && now - lastIndexTime < 5000) {
      return cachedEntries;
    }

    const scannedFiles = await scanWikiFiles(wikiPath);
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
    lastIndexTime = now;
    return cachedEntries;
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
      const results = searchIndex(entries, queryEmbedding, top_k);

      const formatted = results.map((r) =>
        [
          `## ${r.title}`,
          `File: ${r.id} | Score: ${r.score.toFixed(3)}`,
          "",
          r.body,
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
