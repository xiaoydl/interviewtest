/** Retrieval and end-to-end service behaviour, with a fake LLM. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LexicalIndex, tokenize } from '../src/retrieve/index.ts'
import { makeDocument, chunkAll } from '../src/ingest/chunker.ts'
import { AnswerService } from '../src/answer/service.ts'
import { loadConfig } from '../src/config.ts'
import type { LlmClient } from '../src/llm/client.ts'

const docs = [
  makeDocument('leave.md', '# Leave\n\nEveryone gets twenty days of annual leave per year. Unused leave carries over for three months.'),
  makeDocument('expenses.md', '# Expenses\n\nClaims must be submitted within thirty days. Receipts are required above twenty dollars.'),
  makeDocument('security.md', '# Security\n\nLaptops must be encrypted. Report a lost device within one hour.'),
]
const chunks = chunkAll(docs, 700, 80)

function fakeClient(reply = 'Twenty days, per the leave policy [Leave].'): LlmClient {
  return {
    async complete() {
      return { text: reply, usage: { promptTokens: 10, completionTokens: 8 }, attempts: 1 }
    },
  }
}

test('tokenize lowercases and drops single characters', () => {
  assert.deepEqual(tokenize('The ANNUAL a leave!'), ['the', 'annual', 'leave'])
})

test('retrieval ranks the policy that mentions the question terms first', () => {
  const index = new LexicalIndex(chunks)
  const top = index.search('how many days of annual leave', 3)
  assert.ok(top.length > 0)
  assert.equal(top[0]!.chunk.docId, 'leave')
})

test('retrieval returns nothing for terms absent from the corpus', () => {
  const index = new LexicalIndex(chunks)
  assert.deepEqual(index.search('cryptocurrency staking', 3), [])
})

test('an offensive question returns a refusal without calling the model', async () => {
  const service = new AnswerService(loadConfig({}), fakeClient())
  await service.warm(docs)
  const answer = await service.ask('cryptocurrency staking rewards')
  assert.equal(answer.attempts, 0, 'the model must not be called when nothing was retrieved')
  assert.equal(answer.citations.length, 0)
  assert.match(answer.answer, /could not find/i)
})

test('a retrievable question is answered with citations', async () => {
  const service = new AnswerService(loadConfig({}), fakeClient())
  await service.warm(docs)
  const answer = await service.ask('how much annual leave do I get')
  assert.match(answer.answer, /twenty days/i)
  assert.ok(answer.citations.length > 0)
  assert.equal(answer.citations[0]!.docId, 'leave')
})

test('the prompt carries every retrieved chunk with its document title', async () => {
  const service = new AnswerService(loadConfig({}), fakeClient())
  await service.warm(docs)
  const index = new LexicalIndex(chunks)
  const retrieved = index.search('lost device', 2).map((r) => r.chunk)
  const messages = service.buildPrompt('what do I do about a lost device', retrieved)
  const user = messages[1]!.content
  assert.match(user, /Security/)
  assert.match(user, /QUESTION/)
})

test('an empty question is rejected before any work is done', async () => {
  const service = new AnswerService(loadConfig({}), fakeClient())
  await service.warm(docs)
  await assert.rejects(() => service.ask('   '), /question is empty/)
})

test('asking before warm() is a programming error, not a 500 at runtime', async () => {
  const service = new AnswerService(loadConfig({}), fakeClient())
  await assert.rejects(() => service.ask('anything'), /warm\(\)/)
})
