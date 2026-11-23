// Generates the sample cart PDFs in sample-data/. Run: npm run sample-pdfs
import { writeFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

async function makePdf(file, drawPages) {
  const doc = await PDFDocument.create()
  const fonts = { mono: await doc.embedFont(StandardFonts.Courier), sans: await doc.embedFont(StandardFonts.Helvetica) }
  for (const draw of drawPages) draw(doc.addPage([595, 842]), fonts)
  writeFileSync(file, await doc.save())
  console.log('wrote', file)
}

// 1. cart.pdf — the exact layout from the brief: monospaced text, one string per row.
const briefRows = [
  'Order #OP-9921  |  Date: 15 Jan 2025',
  '',
  'Product          Brand          Platform       Base Price',
  '──────────────────────────────────────────────────────────'.replace(/─/g, '-'),
  'Cushion Cover    Natura Casa    Amazon India   Rs.1,299',
  'Bed Sheet Set    Natura Casa    Flipkart       Rs.849',
  'Wall Shelf       LivSpace Pro   Amazon India   Rs.599',
  'Ceramic Vase     LivSpace Pro   Noon           Rs.2,499',
  'Cutting Board    Nordic Basics  Amazon India   Rs.449',
  'Desk Organiser   Nordic Basics  Flipkart       Rs.899',
]
await makePdf('sample-data/cart.pdf', [
  (page, { mono }) => briefRows.forEach((t, i) => page.drawText(t, { x: 40, y: 780 - i * 16, size: 10, font: mono })),
])

// 2. cart-messy.pdf — separate cells, bad rows, a total line and a second page with the header repeated.
const cols = [40, 190, 320, 450]
const row = (page, font, y, cells) => cells.forEach((t, i) => t && page.drawText(t, { x: cols[i], y, size: 10, font }))
await makePdf('sample-data/cart-messy.pdf', [
  (page, { sans }) => {
    page.drawText('Order #OP-9922 | Date: 16 Jan 2025', { x: 40, y: 790, size: 11, font: sans })
    row(page, sans, 750, ['Product', 'Brand', 'Platform', 'Base Price'])
    row(page, sans, 730, ['Cushion Cover', 'Natura Casa', 'Amazon India', 'Rs.1,299'])
    row(page, sans, 712, ['Bed Sheet Set', '', 'Flipkart', 'Rs.849']) // missing brand
    row(page, sans, 694, ['Wall Shelf', 'LivSpace Pro', 'Amazon India', 'TBD']) // bad price
    row(page, sans, 676, ['Ceramic Vase', 'LivSpace Pro', 'Noon', 'Rs.2,499'])
  },
  (page, { sans }) => {
    row(page, sans, 790, ['Product', 'Brand', 'Platform', 'Base Price'])
    row(page, sans, 770, ['Desk Organiser', 'Nordic Basics', 'Flipkart', 'Rs.899'])
    row(page, sans, 740, ['Total', '', '', 'Rs.5,546'])
  },
])

// 3. cart-scanned.pdf — no text layer at all (like a scanned image).
await makePdf('sample-data/cart-scanned.pdf', [
  (page) => page.drawRectangle({ x: 40, y: 600, width: 500, height: 180, color: rgb(0.85, 0.85, 0.85) }),
])
