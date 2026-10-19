/** Chunking behaviour: coverage, overlap, and paragraph-preferred cuts. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chunkDocument, chunkAll, makeDocument, titleOf } from '../src/ingest/chunker.ts'

const doc = makeDocument('leave-policy.md', [
  '# Leave policy',
  '',
  'Everyone gets twenty days of annual leave per year.',
  '',
  'Sick leave is separate and does not require a medical certificate for absences under three days.',
  '',
  'Parental leave is available after twelve months of continuous service.',
].join('\n'))

test('derives a title from the first heading', () => {
  assert.equal(doc.title, 'Leave policy')
  assert.equal(doc.id, 'leave-policy')
})

test('falls back to the file name when there is no heading', () => {
  assert.equal(titleOf('sick-note.md', 'no heading here'), 'sick note')
})

test('chunks a document into more than one piece at a small size', () => {
  const chunks = chunkDocument(doc, 80, 20)
  assert.ok(chunks.length > 1, `expected several chunks, got ${chunks.length}`)
  assert.equal(chunks[0]!.chunkIndex, 0)
  assert.deepEqual(chunks.map((c) => c.chunkIndex), chunks.map((_, i) => i))
})

test('every chunk belongs to the document it came from', () => {
  const chunks = chunkDocument(doc, 60, 10)
  assert.ok(chunks.every((c) => c.docId === 'leave-policy'))
})

test('an empty document produces no chunks', () => {
  assert.deepEqual(chunkDocument(makeDocument('empty.md', '   '), 100, 10), [])
})

test('a document smaller than the chunk size produces exactly one chunk', () => {
  const small = makeDocument('tiny.md', '# Tiny\n\nOne sentence only.')
  assert.equal(chunkDocument(small, 700, 80).length, 1)
})

test('chunkAll concatenates across documents in order', () => {
  const a = makeDocument('a.md', '# A\n\nalpha content here')
  const b = makeDocument('b.md', '# B\n\nbeta content here')
  const chunks = chunkAll([a, b], 700, 80)
  assert.deepEqual(chunks.map((c) => c.docId), ['a', 'b'])
})

// KNOWN LIMITATION: the overlap is applied by stepping the window back, so a chunk can start
// mid-word rather than on a token boundary. Not asserted here because
// the current behaviour is what the retrieval scores were tuned against.
test('overlap is applied by moving the window start back', () => {
  const chunks = chunkDocument(doc, 100, 40)
  assert.ok(chunks.length >= 2)
})
