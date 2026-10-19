#!/usr/bin/env node
/**
 * Ask one question from the command line. Development convenience, not part of the API.
 *
 * Runs offline with LLM_FAKE=1: the point of that flag is that a fresh clone can be confirmed
 * working before anyone has a key, which is exactly what you want in the ten minutes before a
 * pairing session. It answers with a canned string so retrieval, chunking and the prompt path
 * are all still exercised.
 */
import { loadConfig } from './config.ts'
import { loadCorpus } from './ingest/loader.ts'
import { createClient, type LlmClient } from './llm/client.ts'
import { AnswerService } from './answer/service.ts'

const question = process.argv.slice(2).join(' ').trim()
if (question === '') {
  console.error('usage: node src/cli.ts "your question"')
  console.error('       LLM_FAKE=1 node src/cli.ts "..."   (no API key needed)')
  process.exit(2)
}

const fake = process.env.LLM_FAKE === '1'

/** A stand-in that proves the wiring without a network call. */
function fakeClient(): LlmClient {
  return {
    async complete(messages) {
      const user = messages.at(-1)?.content ?? ''
      const context = /CONTEXT\n([\s\S]*?)\n\nQUESTION/.exec(user)?.[1] ?? ''
      // Skip the section heading and blank lines so the quote is policy text, not the title.
      const line = context
        .split('\n')
        .map((l) => l.trim())
        .find((l) => l !== '' && !l.startsWith('#') && !l.startsWith('[')) ?? '(nothing retrieved)'
      return {
        text: `[fake] I would answer from the policy text: ${line.slice(0, 140)}`,
        usage: { promptTokens: 0, completionTokens: 0 },
        attempts: 1,
      }
    },
  }
}

const config = loadConfig()
const service = new AnswerService(config, fake ? fakeClient() : createClient(config))

try {
  await service.warm(await loadCorpus(config.corpusDir))
  const result = await service.ask(question)
  if (fake) console.log('(fake LLM — no network call, LLM_API_KEY not read)\n')
  console.log(result.answer)
  if (result.citations.length > 0) {
    console.log('\nsources:')
    for (const c of result.citations) console.log(`  - ${c.title} (chunk ${c.chunkIndex})`)
  }
  if (result.attempts > 1) console.log(`\n(retried ${result.attempts - 1} time(s))`)
} catch (error) {
  // No retry ceiling means this is where a dead upstream eventually lands — or, today,
  // where it never lands.
  console.error(`failed: ${(error as Error).message}`)
  process.exit(1)
}
