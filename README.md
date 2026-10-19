# policy-assistant

Answers questions about internal company policy from a markdown corpus, with citations.

## Run it

No install step. The project has **no dependencies**, and Node 22.6+ runs TypeScript natively
(type stripping), so this works from a fresh clone:

```sh
node --test          # the full suite
node src/cli.ts "how many days of annual leave do I get?"     # needs LLM_API_KEY
node src/server.ts   # POST /ask, GET /health on :8080
python eval/evaluate.py --predictions eval/predictions.example.json
```

The CLI and server need an OpenAI-compatible endpoint:

```sh
LLM_API_KEY=... LLM_BASE_URL=https://api.deepseek.com/v1 LLM_MODEL=deepseek-flash node src/cli.ts "..."
```

The tests do **not** need a key or a network: they use a fake client.

## Shape of the code

```
src/
  config.ts            env parsing with defaults
  llm/client.ts        OpenAI-compatible chat call over fetch
  llm/retry.ts         retry helper for transient failures
  ingest/loader.ts     read the markdown corpus
  ingest/chunker.ts    character chunks with overlap
  retrieve/index.ts    BM25 lexical search
  answer/service.ts    retrieve -> prompt -> answer with citations
  cli.ts, server.ts    two thin entry points
data/policies/         the corpus (three policies)
test/                  node:test suites; 22 tests
eval/evaluate.py       offline metrics: recall@k, refusals, grounding
```

## Decisions worth knowing

- **No dependencies.** `fetch` is the LLM transport and `node:test` is the runner. Both are
  standard, so there is nothing platform-specific to install or pin.
- **Lexical retrieval, not embeddings.** Every score can be justified in a review, and the
  corpus is small. The tradeoff is that a paraphrase with no shared words will miss.
- **The corpus is markdown on disk.** No database, so a policy change is a file change.
- **Python for evaluation only.** Scoring rules change more often than the service; keeping
  them out of the build means a metric change cannot break the server.
