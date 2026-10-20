// The embedding model scripts use (Insert Embedding, Perform Semantic Find, RAG): any OpenAI-compatible
// /embeddings endpoint. Presets name the two local servers people run, so `--ai-embed-url ollama` is enough.

import { guardedFetch } from '../../scripts/src/net-guard.ts';

export interface EmbedEndpoint { url: string; model: string; key?: string }

export const EMBED_PRESETS: Record<string, { url: string; model: string; name: string; start: string }> = {
  ollama: { url: 'http://localhost:11434/v1', model: 'nomic-embed-text', name: 'Ollama', start: 'ollama pull nomic-embed-text' },
  lmstudio: { url: 'http://localhost:1234/v1', model: 'text-embedding-nomic-embed-text-v1.5', name: 'LM Studio', start: 'load an embedding model in LM Studio and start its local server' },
};

/** The endpoint to use from `--ai-embed-url` / `--ai-embed-model` (a preset name or a URL), or throws saying what to fix. */
export function resolveEmbedEndpoint(url: string | undefined, model: string | undefined, key?: string): EmbedEndpoint | undefined {
  if (!url && !model) return undefined;
  const preset = url ? EMBED_PRESETS[url.toLowerCase()] : undefined;
  if (!url) throw new Error('serve: --ai-embed-model needs --ai-embed-url (ollama, lmstudio, or an OpenAI-compatible endpoint like http://localhost:11434/v1)');
  if (!preset && !model) throw new Error('serve: --ai-embed-url and --ai-embed-model go together (an OpenAI-compatible /embeddings endpoint and its model); ollama and lmstudio need no model');
  if (!preset && !/^https?:\/\//.test(url)) throw new Error('serve: --ai-embed-url needs ollama, lmstudio or an http(s) URL, like http://localhost:11434/v1');
  return { url: preset?.url ?? url, model: model ?? preset!.model, ...(key ? { key } : {}) };
}

export const embeddingsUrl = (e: EmbedEndpoint) => `${e.url.replace(/\/+$/, '')}/embeddings`;

/** One request to the endpoint: the raw response. */
export function embedRequest(e: EmbedEndpoint, texts: string[], signal: AbortSignal): Promise<Response> {
  return guardedFetch(embeddingsUrl(e), {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', ...(e.key ? { authorization: `Bearer ${e.key}` } : {}) },
    body: JSON.stringify({ model: e.model, input: texts, encoding_format: 'float' }),
  }, { policy: { private: true }, timeoutMs: 5 * 60_000, maxBytes: 256 * 1024 * 1024 });
}

/** Asks the endpoint to embed one word: how many numbers each vector has, or why it can't. */
export async function probeEmbedding(e: EmbedEndpoint, timeoutMs = 15_000): Promise<{ dimensions: number; ms: number }> {
  const started = performance.now();
  let res: Response;
  try {
    res = await embedRequest(e, ['hello'], AbortSignal.timeout(timeoutMs));
  } catch (err) {
    const timedOut = (err as Error).name === 'TimeoutError';
    throw new Error(timedOut ? `no answer from ${embeddingsUrl(e)} in ${Math.round(timeoutMs / 1000)} s` : `can't reach ${embeddingsUrl(e)} (${((err as { cause?: Error }).cause ?? err as Error).message})`);
  }
  const body = await res.json().catch(() => ({})) as { data?: { embedding?: unknown }[]; error?: { message?: string } | string };
  if (!res.ok) {
    const said = typeof body.error === 'string' ? body.error : body.error?.message;
    throw new Error(`${embeddingsUrl(e)} said ${said ?? `HTTP ${res.status}`}`);
  }
  const v = body.data?.[0]?.embedding;
  if (!Array.isArray(v) || !v.length || v.some((x) => typeof x !== 'number')) throw new Error(`${embeddingsUrl(e)} answered, but not with a vector (is ${e.model} an embedding model?)`);
  return { dimensions: v.length, ms: Math.round(performance.now() - started) };
}
