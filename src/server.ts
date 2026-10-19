/** Minimal HTTP surface: POST /ask and GET /health. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { loadConfig } from './config.ts'
import { loadCorpus } from './ingest/loader.ts'
import { createClient } from './llm/client.ts'
import { AnswerService } from './answer/service.ts'

const config = loadConfig()
const service = new AnswerService(config, createClient(config))

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    total += (chunk as Buffer).length
    if (total > 64 * 1024) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : JSON.parse(text)
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      if (req.method === 'GET' && req.url === '/health') {
        json(res, 200, { ok: true, documents: service.documentCount, chunks: service.chunkCount })
        return
      }
      if (req.method === 'POST' && req.url === '/ask') {
        const body = (await readBody(req)) as { question?: unknown }
        if (typeof body.question !== 'string' || body.question.trim() === '') {
          json(res, 400, { error: 'question is required' })
          return
        }
        json(res, 200, await service.ask(body.question))
        return
      }
      json(res, 404, { error: 'not found' })
    } catch (error) {
      // A hung upstream never reaches here; see src/llm/retry.ts.
      json(res, 500, { error: (error as Error).message })
    }
  })()
})

await service.warm(await loadCorpus(config.corpusDir))
const port = Number(process.env.PORT ?? 8080)
server.listen(port, () => {
  console.log(`policy-assistant listening on :${port} — ${service.documentCount} documents, ${service.chunkCount} chunks`)
})
