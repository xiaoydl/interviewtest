/**
 * Configuration, read from the environment with sane defaults.
 *
 * There are no dependencies in this project on purpose: it runs on Node 22.6+ with native
 * TypeScript, so `npm install` is not needed to run or test it. The LLM is reached over the
 * OpenAI-compatible HTTP API with `fetch`, which is the same shape the SDK exposes.
 */

import { fileURLToPath } from 'node:url'

export type Config = {
  /** OpenAI-compatible endpoint base, no trailing slash. */
  llmBaseUrl: string
  llmModel: string
  apiKey: string
  /** Budget for attempts against the LLM endpoint. */
  maxRetries: number
  /** Base backoff in milliseconds, doubled each attempt. */
  retryBaseDelayMs: number
  /** Documents are chunked to roughly this many characters. */
  chunkSize: number
  chunkOverlap: number
  /** How many chunks to feed the model. */
  topK: number
  /** Directory holding the markdown corpus. */
  corpusDir: string
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    llmBaseUrl: (env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    llmModel: env.LLM_MODEL ?? 'deepseek-flash',
    apiKey: env.LLM_API_KEY ?? '',
    // Intended cap. The retry helper ignores it today and loops until success.
    maxRetries: int(env.LLM_MAX_RETRIES, 3),
    retryBaseDelayMs: int(env.LLM_RETRY_BASE_MS, 250),
    chunkSize: int(env.CHUNK_SIZE, 700),
    chunkOverlap: int(env.CHUNK_OVERLAP, 80),
    topK: int(env.TOP_K, 4),
    // fileURLToPath, NOT URL.pathname: pathname keeps the leading slash and percent-encodes
    // spaces, so on Windows it produces `/C:/...` and resolves to `C:\C:\...`. That made the
    // corpus unreadable on a fresh clone until CORPUS_DIR was set by hand.
    corpusDir: env.CORPUS_DIR ?? fileURLToPath(new URL('../data/policies', import.meta.url)),
  }
}
