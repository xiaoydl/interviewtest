/** Read the markdown corpus from disk. */
import { readdir, readFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { makeDocument, type Document } from './chunker.ts'

export async function loadCorpus(dir: string): Promise<Document[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    throw new Error(`corpus directory is not readable: ${dir} (${(error as Error).message})`)
  }

  const files = entries
    .filter((e) => e.isFile() && extname(e.name).toLowerCase() === '.md')
    .map((e) => e.name)
    .sort()

  const docs: Document[] = []
  for (const name of files) {
    const full = join(dir, name)
    // Strip a UTF-8 BOM. Editors on Windows add one silently, and it breaks `^#` heading
    // detection in titleOf() — the first line then starts with U+FEFF rather than '#'.
    const text = (await readFile(full, 'utf8')).replace(/^\uFEFF/, '')
    docs.push(makeDocument(full, text))
  }
  return docs
}
