import { pipeline } from "@huggingface/transformers";

// Narrowed view of the feature-extraction pipeline. The library's own
// FeatureExtractionPipeline type expands to a union too complex for tsc
// (TS2590); we only depend on these two output shapes.
type EmbeddingTensor = { data: Float32Array; tolist(): number[][] };
type Extractor = (
  input: string | string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<EmbeddingTensor>;

/** Identifies the embedding space. Bump when the model or dtype changes so
 * stale on-disk indexes (with incompatible vectors) are rebuilt instead of
 * silently mixed. */
export const MODEL_ID = "Xenova/all-MiniLM-L6-v2@fp32";

/** Max texts per forward pass. Keeps memory bounded on large wikis. */
const BATCH_SIZE = 32;

export interface Embedder {
  /** Identifies the embedding space; persisted with the index. */
  id: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export async function createEmbedder(): Promise<Embedder> {
  const extractor = (await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
    { dtype: "fp32" },
  )) as unknown as Extractor;

  async function embed(text: string): Promise<number[]> {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data);
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const chunk = texts.slice(i, i + BATCH_SIZE);
      const output = await extractor(chunk, { pooling: "mean", normalize: true });
      results.push(...output.tolist());
    }
    return results;
  }

  return { id: MODEL_ID, embed, embedBatch };
}
