/**
 * Lexical retrieval.
 *
 * A small BM25 implementation over whitespace tokens. This is intentionally the "cheap,
 * explainable" baseline: no embeddings, no vector store, so every score can be justified in
 * a review.
 *
 * INCOMPLETE: `idf` uses the plain inverse document frequency rather than the BM25
 * saturation form, and stopwords are not removed. Both are noted as follow-ups rather than
 * quietly approximated, because they change ranking on short policy documents.
 */
import type { Chunk } from '../ingest/chunker.ts'

export type Scored = { chunk: Chunk; score: number }

const TOKEN = /[a-z0-9']+/g

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(TOKEN) ?? []).filter((t) => t.length > 1)
}

export class LexicalIndex {
  #chunks: Chunk[]
  #docFreq = new Map<string, number>()
  #chunkTokens: string[][]
  #avgLength = 0

  constructor(chunks: Chunk[]) {
    this.#chunks = chunks
    this.#chunkTokens = chunks.map((c) => tokenize(c.text))

    for (const tokens of this.#chunkTokens) {
      for (const term of new Set(tokens)) {
        this.#docFreq.set(term, (this.#docFreq.get(term) ?? 0) + 1)
      }
    }
    const total = this.#chunkTokens.reduce((n, t) => n + t.length, 0)
    this.#avgLength = this.#chunkTokens.length === 0 ? 0 : total / this.#chunkTokens.length
  }

  get size(): number {
    return this.#chunks.length
  }

  /** Plain inverse document frequency. See the module note. */
  idf(term: string): number {
    const n = this.#chunks.length
    const df = this.#docFreq.get(term) ?? 0
    if (df === 0) return 0
    return Math.log(n / df)
  }

  search(query: string, topK: number, k1 = 1.5, b = 0.75): Scored[] {
    const terms = tokenize(query)
    if (terms.length === 0 || this.#chunks.length === 0) return []

    const scored: Scored[] = this.#chunks.map((chunk, i) => {
      const tokens = this.#chunkTokens[i]!
      const length = tokens.length
      const counts = new Map<string, number>()
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1)

      let score = 0
      for (const term of terms) {
        const tf = counts.get(term) ?? 0
        if (tf === 0) continue
        const numerator = tf * (k1 + 1)
        const denominator = tf + k1 * (1 - b + b * (length / (this.#avgLength || 1)))
        score += this.idf(term) * (numerator / denominator)
      }
      return { chunk, score }
    })

    return scored
      .filter((s) => s.score > 0)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, Math.max(1, topK))
  }
}
