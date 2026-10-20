// The model Perform Semantic Find by image uses to turn a picture into a vector. Providers sit behind one interface,
// so another one (Jina CLIP, ...) is one entry in IMAGE_EMBED_PROVIDERS and nothing else changes. Voyage multimodal is
// the first. The records' stored vectors must come from the same model, or the comparison means nothing.

export interface ImageInput { mime: string; data: Uint8Array }

export interface ImageEmbedProvider {
  /** The name given to --ai-image-embed. */
  id: string;
  name: string;
  defaultModel: string;
  /** A vector for each image, in order. */
  embed(request: { model: string; key: string; images: ImageInput[]; signal: AbortSignal }): Promise<number[][]>;
}

export interface ImageEmbedEndpoint { provider: ImageEmbedProvider; model: string; key: string }

const voyage: ImageEmbedProvider = {
  id: 'voyage',
  name: 'Voyage multimodal',
  defaultModel: 'voyage-multimodal-3',
  async embed({ model, key, images, signal }) {
    const res = await fetch('https://api.voyageai.com/v1/multimodalembeddings', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        input_type: 'query',
        inputs: images.map((i) => ({ content: [{ type: 'image_base64', image_base64: `data:${i.mime};base64,${Buffer.from(i.data).toString('base64')}` }] })),
      }),
    });
    const body = await res.json().catch(() => ({})) as { data?: { index?: number; embedding?: unknown }[]; detail?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(`Voyage said: ${body.detail ?? body.error?.message ?? `HTTP ${res.status}`}`);
    const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
    if (rows.length !== images.length || rows.some((v) => !Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'number'))) throw new Error('Voyage gave no usable vectors');
    return rows as number[][];
  },
};

const jina: ImageEmbedProvider = {
  id: 'jina',
  name: 'Jina CLIP',
  defaultModel: 'jina-clip-v2',
  async embed({ model, key, images, signal }) {
    const res = await fetch('https://api.jina.ai/v1/embeddings', {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: images.map((i) => ({ image: Buffer.from(i.data).toString('base64') })) }),
    });
    const body = await res.json().catch(() => ({})) as { data?: { index?: number; embedding?: unknown }[]; detail?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(`Jina said: ${body.detail ?? body.error?.message ?? `HTTP ${res.status}`}`);
    const rows = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding);
    if (rows.length !== images.length || rows.some((v) => !Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'number'))) throw new Error('Jina gave no usable vectors');
    return rows as number[][];
  },
};

export const IMAGE_EMBED_PROVIDERS: Record<string, ImageEmbedProvider> = { voyage, jina };

/** The image embedding model from `--ai-image-embed` (a provider name), its model and key; undefined when not asked for. */
export function resolveImageEmbed(provider: string | undefined, model: string | undefined, key: string | undefined): ImageEmbedEndpoint | undefined {
  if (!provider) {
    if (model) throw new Error('serve: --ai-image-embed-model needs --ai-image-embed (voyage)');
    return undefined;
  }
  const p = IMAGE_EMBED_PROVIDERS[provider.toLowerCase()];
  if (!p) throw new Error(`serve: --ai-image-embed takes ${Object.keys(IMAGE_EMBED_PROVIDERS).join(', ')}, not ${provider}`);
  if (!key) throw new Error(`serve: --ai-image-embed ${p.id} needs its API key in TABULARIUS_AI_IMAGE_EMBED_KEY`);
  return { provider: p, model: model ?? p.defaultModel, key };
}
