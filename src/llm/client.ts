/**
 * Minimal OpenAI-compatible chat client over fetch.
 *
 * Deliberately not the vendor SDK: the wire shape is what matters here and it is the same
 * one the SDK produces. Swapping in `openai` later is a drop-in at this boundary.
 */
import { withRetry } from './retry.ts'
import type { Config } from '../config.ts'

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

export type ChatResponse = {
  text: string
  usage: { promptTokens: number; completionTokens: number } | null
  /** Attempts used by the retry helper, for the logs. */
  attempts: number
}

export type LlmClient = {
  complete(messages: ChatMessage[], options?: { maxTokens?: number }): Promise<ChatResponse>
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export function createClient(config: Config, fetchImpl: typeof fetch = fetch): LlmClient {
  return {
    async complete(messages, options = {}) {
      let attempts = 0
      const result = await withRetry(
        async (attempt) => {
          attempts = attempt
          return await callOnce(config, messages, options.maxTokens ?? 400, fetchImpl)
        },
        { baseDelayMs: config.retryBaseDelayMs },
      )
      return { ...result, attempts }
    },
  }
}

async function callOnce(
  config: Config,
  messages: ChatMessage[],
  maxTokens: number,
  fetchImpl: typeof fetch,
): Promise<Omit<ChatResponse, 'attempts'>> {
  if (config.apiKey === '') throw new Error('LLM_API_KEY is not set')

  const response = await fetchImpl(`${config.llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.llmModel, messages, max_tokens: maxTokens, temperature: 0.2 }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new HttpError(response.status, `llm ${response.status}: ${body.slice(0, 200)}`)
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    text: payload.choices?.[0]?.message?.content ?? '',
    usage: payload.usage
      ? {
          promptTokens: payload.usage.prompt_tokens ?? 0,
          completionTokens: payload.usage.completion_tokens ?? 0,
        }
      : null,
  }
}
