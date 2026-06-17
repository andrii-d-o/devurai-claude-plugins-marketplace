import {
  pipeline,
  type FeatureExtractionPipeline,
} from "@huggingface/transformers";

export interface Embedder {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

export async function createEmbedder(): Promise<Embedder> {
  const extractor: FeatureExtractionPipeline = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2",
    { dtype: "fp32" },
  );

  async function embed(text: string): Promise<number[]> {
    const output = await extractor(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }

  async function embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embed(text));
    }
    return results;
  }

  return { embed, embedBatch };
}
