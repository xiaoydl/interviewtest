/**
 * Retry behaviour.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withRetry, isRetryable, backoffDelay } from '../src/llm/retry.ts'

const noSleep = async () => {}

test('returns the result without retrying when the task succeeds', async () => {
  let calls = 0
  const result = await withRetry(async () => {
    calls += 1
    return 'ok'
  }, { sleep: noSleep })

  assert.equal(result, 'ok')
  assert.equal(calls, 1)
})

test('retries a retryable failure and returns the later success', async () => {
  let calls = 0
  const result = await withRetry(async (attempt) => {
    calls += 1
    if (attempt < 3) {
      const error = new Error('upstream boom') as Error & { status?: number }
      error.status = 503
      throw error
    }
    return `ok after ${attempt}`
  }, { sleep: noSleep })

  assert.equal(result, 'ok after 3')
  assert.equal(calls, 3)
})

test('does not retry a permanent failure', async () => {
  let calls = 0
  await assert.rejects(
    () => withRetry(async () => {
      calls += 1
      const error = new Error('bad request') as Error & { status?: number }
      error.status = 400
      throw error
    }, { sleep: noSleep }),
    /bad request/,
  )
  assert.equal(calls, 1)
})

// --- a persistent failure -------------------------------------------------------
test('keeps retrying a persistent failure until the caller gives up', async () => {
  let calls = 0
  const controller = new AbortController()

  const run = withRetry(async () => {
    calls += 1
    if (calls >= 5) controller.abort() // the test's only escape hatch; the helper has none
    const error = new Error('upstream boom') as Error & { status?: number }
    error.status = 503
    throw error
  }, {
    sleep: async () => {
      if (controller.signal.aborted) throw new Error('test aborted the loop')
    },
  })

  await assert.rejects(() => run, /test aborted the loop/)
  assert.equal(calls, 5, 'the helper made 5 attempts with no maxRetries of 3 honoured')
})

test('classifies transient and permanent failures', () => {
  const withStatus = (status: number) => Object.assign(new Error('x'), { status })
  assert.equal(isRetryable(withStatus(429)), true)
  assert.equal(isRetryable(withStatus(503)), true)
  assert.equal(isRetryable(withStatus(400)), false)
  assert.equal(isRetryable(withStatus(401)), false)
  assert.equal(isRetryable(new Error('fetch failed')), true)
})

test('backs off exponentially', () => {
  assert.equal(backoffDelay(1, 100), 100)
  assert.equal(backoffDelay(2, 100), 200)
  assert.equal(backoffDelay(3, 100), 400)
})
