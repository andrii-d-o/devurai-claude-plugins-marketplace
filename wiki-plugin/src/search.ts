import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { WikiEntry, ScannedFile } from "./indexer.js";
import type { Embedder } from "./embeddings.js";

export interface IndexedEntry {
  id: string;
  title: string;
  body: string;
  embedding: number[];
}

export interface SearchResult {
  id: string;
  title: string;
  body: string;
  score: number;
}

export interface StoredIndex {
  model: string; // embedding-space id; mismatched indexes are rebuilt
  entries: IndexedEntry[];
  files: Record<string, number>; // relativePath -> mtimeMs
}

function isStoredIndex(value: unknown): value is StoredIndex {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["model"] === "string" &&
    Array.isArray(v["entries"]) &&
    typeof v["files"] === "object" &&
    v["files"] !== null
  );
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function searchIndex(
  entries: IndexedEntry[],
  queryEmbedding: number[],
  topK: number,
): SearchResult[] {
  return entries
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      body: entry.body,
      score: cosineSimilarity(entry.embedding, queryEmbedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export async function loadIndex(wikiDir: string): Promise<StoredIndex | null> {
  const indexPath = path.join(wikiDir, ".index.json");
  try {
    const raw = await readFile(indexPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    return isStoredIndex(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveIndex(
  wikiDir: string,
  index: StoredIndex,
): Promise<void> {
  const indexPath = path.join(wikiDir, ".index.json");
  await writeFile(indexPath, JSON.stringify(index), "utf-8");
}

/** Determine which files need re-embedding based on mtime changes. */
export function findStaleFiles(
  scannedFiles: ScannedFile[],
  storedIndex: StoredIndex | null,
): ScannedFile[] {
  if (!storedIndex) return scannedFiles;

  return scannedFiles.filter((file) => {
    const storedMtime = storedIndex.files[file.relativePath];
    return storedMtime === undefined || storedMtime < file.mtimeMs;
  });
}

/** Build or incrementally update the index. */
export async function buildIndex(
  wikiDir: string,
  scannedFiles: ScannedFile[],
  entries: WikiEntry[],
  embedder: Embedder,
  existingIndex: StoredIndex | null,
): Promise<StoredIndex> {
  // Discard a stored index built with a different embedding model — its
  // vectors live in an incompatible space and cosine scores would be garbage.
  const compatibleIndex =
    existingIndex && existingIndex.model === embedder.id ? existingIndex : null;
  const staleFiles = findStaleFiles(scannedFiles, compatibleIndex);
  const staleIds = new Set(staleFiles.map((f) => f.relativePath));

  const kept = compatibleIndex
    ? compatibleIndex.entries.filter((e) => !staleIds.has(e.id))
    : [];

  // Drop entries for files that no longer exist
  const currentIds = new Set(scannedFiles.map((f) => f.relativePath));
  const surviving = kept.filter((e) => currentIds.has(e.id));

  const staleEntries = entries.filter((e) => staleIds.has(e.id));
  const textsToEmbed = staleEntries.map((e) => `${e.title}\n\n${e.body}`);
  const newEmbeddings = await embedder.embedBatch(textsToEmbed);

  const newIndexed: IndexedEntry[] = staleEntries.map((entry, i) => ({
    id: entry.id,
    title: entry.title,
    body: entry.body,
    embedding: newEmbeddings[i]!,
  }));

  const allEntries = [...surviving, ...newIndexed];
  const files: Record<string, number> = {};
  for (const f of scannedFiles) {
    files[f.relativePath] = f.mtimeMs;
  }

  const index: StoredIndex = { model: embedder.id, entries: allEntries, files };
  await saveIndex(wikiDir, index);
  return index;
}
