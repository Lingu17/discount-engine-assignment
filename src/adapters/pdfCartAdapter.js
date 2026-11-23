/**
 * pdfCartAdapter.js — input adapter: cart PDF -> CartItem[]
 *
 * Reads the PDF's text in the browser (pdfjs-dist, no server), rebuilds the
 * table rows from text positions, and validates each row with the same
 * validateCartItem() the CSV upload uses.
 *
 * Expected table columns: Product, Brand, Platform, Base Price.
 * Anything above the header (order number, date) is ignored. Rows that cannot
 * become a valid item are skipped and reported with the reason.
 */

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { validateCartItem } from '../engine/schema.js'

const HEADERS = ['product', 'brand', 'platform', 'price']
const Y_TOLERANCE = 3 // text within 3pt vertically is on the same line

/** Returns every text piece in the PDF as { page, x, y, width, str }. */
export async function readPdfTextItems(data, pdfjs) {
  const pdf = await pdfjs.getDocument({ data }).promise
  const items = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent()
    for (const it of content.items) {
      if (it.str?.trim()) items.push({ page: p, x: it.transform[4], y: it.transform[5], width: it.width, str: it.str })
    }
  }
  return items
}

/**
 * Some PDFs store a whole table row as one string ("Cushion Cover   Natura Casa ...").
 * Split such strings at runs of 2+ spaces and estimate each piece's x position.
 */
function splitWideItems(items) {
  return items.flatMap((it) => {
    const charWidth = it.width / it.str.length
    return [...it.str.matchAll(/\S+(?: \S+)*/g)].map((m) => ({ ...it, x: it.x + m.index * charWidth, str: m[0] }))
  })
}

/** Groups text pieces into lines (top to bottom), each line sorted left to right. */
function toLines(items) {
  const sorted = [...items].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  const lines = []
  for (const it of sorted) {
    const line = lines.at(-1)
    if (line && line.page === it.page && Math.abs(line.y - it.y) <= Y_TOLERANCE) line.cells.push(it)
    else lines.push({ page: it.page, y: it.y, cells: [it] })
  }
  lines.forEach((l) => l.cells.sort((a, b) => a.x - b.x))
  return lines
}

const lineText = (line) => line.cells.map((c) => c.str).join(' ')
const isHeader = (line) => HEADERS.every((h) => lineText(line).toLowerCase().includes(h))
const isDecoration = (line) => /^[\s─━—\-=_|]+$/.test(lineText(line))
const isTotal = (line) => /^(sub)?total\b/i.test(lineText(line).trim())

const fail = (message) => ({ data: [], errors: [message] })

/** Pure: text pieces -> { data: CartItem[], errors: string[] } (same shape as the CSV adapter) */
export function parseCartFromTextItems(rawItems) {
  if (rawItems.length === 0) {
    return fail('This PDF has no readable text — it may be a scanned image. Please upload a text-based PDF or a CSV.')
  }

  const lines = toLines(splitWideItems(rawItems))
  const header = lines.find(isHeader)
  if (!header) {
    return fail('Could not find a table with the columns Product, Brand, Platform, Base Price.')
  }

  // Column start positions come from the header words, left to right.
  const columnX = HEADERS.map((h) => header.cells.find((c) => c.str.toLowerCase().includes(h)).x)

  const data = []
  const errors = []
  for (const line of lines.slice(lines.indexOf(header) + 1)) {
    if (isHeader(line) || isDecoration(line) || isTotal(line)) continue // repeated header on page 2, rules, totals

    const cols = ['', '', '', '']
    for (const cell of line.cells) {
      // A cell belongs to the column whose header starts closest to it.
      const distances = columnX.map((x) => Math.abs(cell.x - x))
      const col = distances.indexOf(Math.min(...distances))
      cols[col] = `${cols[col]} ${cell.str}`.trim()
    }

    const result = validateCartItem({
      itemId: `ITEM-${String(data.length + 1).padStart(2, '0')}`,
      product: cols[0],
      brand: cols[1],
      platform: cols[2],
      basePrice: cols[3],
    })
    if (result.ok) data.push(result.value)
    else errors.push(`"${lineText(line)}": ${result.errors.join('; ')}`)
  }

  if (data.length === 0 && errors.length === 0) return fail('The table has no item rows.')
  return { data, errors }
}

/** Browser entry point: ArrayBuffer of a PDF -> { data, errors }. Never throws. */
export async function parsePdfCart(arrayBuffer) {
  try {
    const pdfjs = await import('pdfjs-dist') // loaded only when a PDF is uploaded
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    return parseCartFromTextItems(await readPdfTextItems(arrayBuffer, pdfjs))
  } catch (err) {
    console.error('PDF read failed:', err)
    return fail('Could not open this PDF. It may be damaged or password-protected.')
  }
}
