/**
 * Retry helper for the LLM call: retries transient failures with exponential backoff.
 */

export type RetryOptions = {
  /** Called on every attempt, 1-based. */
  onAttempt?: (attempt: number, error: Error) => void
  /** Injectable so tests do not wait in real time. */
  sleep?: (ms: number) => Promise<void>
  baseDelayMs?: number
}

/** Errors worth trying again: overload, rate limit, transient network. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const status = (error as Error & { status?: number }).status
  if (status === undefined) {
    // No status means the request never completed: socket reset, DNS, timeout.
    return /fetch failed|socket|ECONNRESET|ETIMEDOUT|network/i.test(error.message)
  }
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

export function backoffDelay(attempt: number, baseDelayMs = 250): number {
  return baseDelayMs * 2 ** (attempt - 1)
}

/**
 * Run `task`, retrying failures that are worth retrying.
 */
export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const base = options.baseDelayMs ?? 250

  let attempt = 1
  for (;;) {
    try {
      return await task(attempt)
    } catch (error) {
      if (!isRetryable(error)) throw error
      options.onAttempt?.(attempt, error as Error)
      await sleep(backoffDelay(attempt, base))
      attempt += 1
    }
  }
}
