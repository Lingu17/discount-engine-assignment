/**
 * csvAdapter.js — input adapter: CSV text -> DiscountRule[] / CartItem[]
 *
 * Reads the CSV with papaparse, renames the columns to the field names used
 * in schema.js, and lets the shared validators decide what is valid.
 * Bad rows are skipped and reported; good rows still load.
 *
 * rules.csv columns: rule_id, scope, applies_to, type, value, stackable, min_cart_value (optional)
 * cart.csv columns:  item_id, product, brand, platform, base_price
 */

import Papa from 'papaparse'
import { validateRule, validateCartItem } from '../engine/schema.js'

function readCsv(csvText, requiredColumns) {
  const { data: rows, errors, meta } = Papa.parse(String(csvText ?? '').trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  if (rows.length === 0) return { rows: [], fatal: 'The file is empty.' }

  const missingCols = requiredColumns.filter((c) => !meta.fields.includes(c))
  if (missingCols.length > 0) {
    return { rows: [], fatal: `Missing column(s): ${missingCols.join(', ')}. Expected: ${requiredColumns.join(', ')}.` }
  }

  // Row-level papaparse problems (e.g. wrong number of cells) are reported per row.
  const rowProblems = new Map(errors.filter((e) => e.row !== undefined).map((e) => [e.row, e.message]))
  return { rows, rowProblems, fatal: null }
}

function convertRows(csvText, requiredColumns, toRaw, validate) {
  const { rows, rowProblems, fatal } = readCsv(csvText, requiredColumns)
  if (fatal) return { data: [], errors: [fatal] }

  const data = []
  const errors = []
  rows.forEach((row, i) => {
    const rowNum = i + 2 // +1 for header, +1 for 1-based numbering
    if (rowProblems.has(i)) {
      errors.push(`Row ${rowNum}: ${rowProblems.get(i)}`)
      return
    }
    const result = validate(toRaw(row))
    if (result.ok) data.push(result.value)
    else errors.push(`Row ${rowNum}: ${result.errors.join('; ')}`)
  })
  return { data, errors }
}

export function parseRulesCSV(csvText) {
  return convertRows(
    csvText,
    ['rule_id', 'scope', 'applies_to', 'type', 'value', 'stackable'],
    (row) => ({
      ruleId: row.rule_id,
      scope: row.scope,
      appliesTo: row.applies_to,
      type: row.type,
      value: row.value,
      stackable: row.stackable,
      minCartValue: row.min_cart_value,
    }),
    validateRule,
  )
}

export function parseCartCSV(csvText) {
  return convertRows(
    csvText,
    ['item_id', 'product', 'brand', 'platform', 'base_price'],
    (row) => ({
      itemId: row.item_id,
      product: row.product,
      brand: row.brand,
      platform: row.platform,
      basePrice: row.base_price,
    }),
    validateCartItem,
  )
}
