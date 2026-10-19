/**
 * Markdown corpus loading and chunking.
 *
 * Chunking is character-based with overlap, which is crude but predictable and keeps the
 * retrieval scores comparable between chunks. Paragraph boundaries are preferred when one
 * falls near the target size.
 */

export type Document = {
  /** Stable id derived from the file name, used in citations. */
  id: string
  title: string
  source: string
  text: string
}

export type Chunk = {
  docId: string
  chunkIndex: number
  text: string
}

export function titleOf(source: string, text: string): string {
  const heading = text.match(/^#\s+(.+)$/m)
  if (heading?.[1]) return heading[1].trim()
  return source.replace(/\.md$/i, '').replace(/[-_]/g, ' ')
}

export function makeDocument(source: string, text: string): Document {
  const base = source.split(/[\\/]/).pop() ?? source
  return {
    id: base.replace(/\.md$/i, ''),
    title: titleOf(source, text),
    source,
    text,
  }
}

/**
 * Split one document into overlapping chunks.
 *
 * @param doc the document to split
 * @param size target characters per chunk
 * @param overlap characters repeated at the start of the next chunk
 */
export function chunkDocument(doc: Document, size: number, overlap: number): Chunk[] {
  const text = doc.text.trim()
  if (text === '') return []

  const step = Math.max(1, size - Math.max(0, overlap))
  const chunks: Chunk[] = []

  for (let start = 0; start < text.length; start += step) {
    let end = Math.min(text.length, start + size)

    // Prefer a paragraph break in the last third of the window, so a chunk does not end
    // mid-sentence when a clean cut is available.
    if (end < text.length) {
      const window = text.slice(start + Math.floor(size * 0.66), end)
      const brk = window.lastIndexOf('\n\n')
      if (brk >= 0) end = start + Math.floor(size * 0.66) + brk
    }

    const piece = text.slice(start, end).trim()
    if (piece !== '') chunks.push({ docId: doc.id, chunkIndex: chunks.length, text: piece })
    if (end >= text.length) break
  }

  return chunks
}

export function chunkAll(docs: Document[], size: number, overlap: number): Chunk[] {
  return docs.flatMap((doc) => chunkDocument(doc, size, overlap))
}
