/**
 * Answer orchestration: retrieve, prompt, return an answer with citations.
 */
import { chunkAll } from '../ingest/chunker.ts'
import { LexicalIndex } from '../retrieve/index.ts'
import type { Chunk } from '../ingest/chunker.ts'
import type { Document } from '../ingest/chunker.ts'
import type { LlmClient, ChatMessage } from '../llm/client.ts'
import type { Config } from '../config.ts'

export type Answer = {
  question: string
  answer: string
  citations: Array<{ docId: string; title: string; chunkIndex: number }>
  retrieved: Chunk[]
  usage: { promptTokens: number; completionTokens: number } | null
  attempts: number
}

const SYSTEM = [
  'You answer questions about internal company policy using ONLY the supplied context.',
  'Cite the document title for every factual claim, in brackets.',
  'If the context does not contain the answer, say so plainly and name what is missing.',
  'Keep answers under 150 words.',
].join(' ')

export class AnswerService {
  #config: Config
  #client: LlmClient
  #index: LexicalIndex | null = null
  #docs: Document[] = []

  constructor(config: Config, client: LlmClient) {
    this.#config = config
    this.#client = client
  }

  /** Rebuild the index from the given documents. Called once per process today. */
  async warm(docs: Document[]): Promise<void> {
    this.#docs = docs
    const chunks = chunkAll(docs, this.#config.chunkSize, this.#config.chunkOverlap)
    this.#index = new LexicalIndex(chunks)
  }

  get documentCount(): number {
    return this.#docs.length
  }

  get chunkCount(): number {
    return this.#index?.size ?? 0
  }

  buildPrompt(question: string, retrieved: Chunk[]): ChatMessage[] {
    const context = retrieved
      .map((c, i) => {
        const doc = this.#docs.find((d) => d.id === c.docId)
        return `[${i + 1}] ${doc?.title ?? c.docId} (chunk ${c.chunkIndex})\n${c.text}`
      })
      .join('\n\n')

    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `CONTEXT\n${context}\n\nQUESTION\n${question}` },
    ]
  }

  async ask(question: string): Promise<Answer> {
    if (this.#index === null) throw new Error('AnswerService.warm() must be called before ask()')

    const trimmed = question.trim()
    if (trimmed === '') throw new Error('question is empty')

    const retrieved = this.#index.search(trimmed, this.#config.topK)

    if (retrieved.length === 0) {
      return {
        question: trimmed,
        answer: 'I could not find anything in the policy set that covers that.',
        citations: [],
        retrieved: [],
        usage: null,
        attempts: 0,
      }
    }

    const result = await this.#client.complete(this.buildPrompt(trimmed, retrieved.map((r) => r.chunk)), {
      maxTokens: 400,
    })

    const citations = retrieved.map((r) => {
      const doc = this.#docs.find((d) => d.id === r.chunk.docId)
      return { docId: r.chunk.docId, title: doc?.title ?? r.chunk.docId, chunkIndex: r.chunk.chunkIndex }
    })

    return {
      question: trimmed,
      answer: result.text.trim(),
      citations,
      retrieved: retrieved.map((r) => r.chunk),
      usage: result.usage,
      attempts: result.attempts,
    }
  }
}
