/**
 * schema.js
 *
 * The contract between input adapters and the discount engine.
 *
 * Every way of getting data into the app (CSV upload, plain-English text,
 * PDF upload, and any future input) must turn its raw input into a
 * DiscountRule or CartItem by calling one of these validators. The engine
 * only ever sees objects that have passed through here, so it never needs to
 * know where the data came from.
 *
 * Each validator returns either { ok: true, value } or { ok: false, errors }.
 * Errors are short, plain-English strings that can be shown to a user.
 */

const SCOPES = ['brand', 'platform', 'cart']
const TYPES = ['percentage', 'flat']

const isBlank = (v) => v === undefined || v === null || String(v).trim() === ''

/** Turns "Rs.1,299", "₹1,299.00", " 1299 " or 1299 into 1299. Returns NaN if not a number. */
export function parseMoney(input) {
  if (typeof input === 'number') return input
  if (isBlank(input)) return NaN
  const cleaned = String(input)
    .trim()
    .replace(/^(rs\.?|inr|₹)\s*/i, '')
    .replace(/,/g, '')
  // Only accept a plain number after removing the currency prefix and commas.
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : NaN
}

/** Accepts true/false, yes/no, 1/0 (any case). Returns undefined if unrecognised. */
function parseBoolean(input) {
  if (typeof input === 'boolean') return input
  const s = String(input ?? '').trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(s)) return true
  if (['false', 'no', 'n', '0'].includes(s)) return false
  return undefined
}

/**
 * Validates a loosely-typed rule (from CSV, LLM, ...) and returns a clean
 * DiscountRule:
 *
 * DiscountRule {
 *   ruleId:       string
 *   scope:        "brand" | "platform" | "cart"
 *   appliesTo:    string        — brand/platform name; "" for cart rules
 *   type:         "percentage" | "flat"
 *   value:        number        — 15 means 15% for percentage; rupees for flat
 *   stackable:    boolean
 *   minCartValue: number | null — only for cart rules: cart total must be >= this
 * }
 */
export function validateRule(raw) {
  const errors = []
  const scope = String(raw.scope ?? '').trim().toLowerCase()
  const type = String(raw.type ?? '').trim().toLowerCase()
  const appliesTo = String(raw.appliesTo ?? '').trim()
  const value = parseMoney(raw.value)
  const minCartValue = isBlank(raw.minCartValue) ? null : parseMoney(raw.minCartValue)
  const stackable = isBlank(raw.stackable) ? false : parseBoolean(raw.stackable)

  if (isBlank(raw.ruleId)) errors.push('rule ID is missing')

  if (!SCOPES.includes(scope)) {
    errors.push(`scope must be brand, platform or cart (got "${raw.scope ?? ''}")`)
  }
  if (!TYPES.includes(type)) {
    errors.push(`type must be percentage or flat (got "${raw.type ?? ''}")`)
  }

  if (Number.isNaN(value) || value <= 0) {
    errors.push(`discount value must be a number above 0 (got "${raw.value ?? ''}")`)
  } else if (type === 'percentage' && value > 100) {
    errors.push(`a percentage discount cannot be more than 100% (got ${value}%)`)
  }

  if (stackable === undefined) {
    errors.push(`stackable must be true or false (got "${raw.stackable}")`)
  }

  if (scope === 'brand' || scope === 'platform') {
    if (!appliesTo) errors.push(`a ${scope} rule needs the ${scope} name it applies to`)
    if (minCartValue !== null) errors.push('only cart rules can have a minimum cart value')
  }

  if (scope === 'cart') {
    if (minCartValue === null) {
      errors.push('a cart rule needs a minimum cart value (e.g. "on orders of Rs.4,000 or more")')
    } else if (Number.isNaN(minCartValue) || minCartValue < 0) {
      errors.push(`minimum cart value must be a number of 0 or more (got "${raw.minCartValue}")`)
    }
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      ruleId: String(raw.ruleId).trim(),
      scope,
      appliesTo: scope === 'cart' ? '' : appliesTo,
      type,
      value,
      stackable,
      minCartValue: scope === 'cart' ? minCartValue : null,
    },
  }
}

/**
 * Validates a loosely-typed cart line and returns a clean CartItem:
 *
 * CartItem {
 *   itemId:    string
 *   product:   string
 *   brand:     string
 *   platform:  string
 *   basePrice: number — whole rupees
 * }
 */
export function validateCartItem(raw) {
  const errors = []
  const missing = ['itemId', 'product', 'brand', 'platform'].filter((k) => isBlank(raw[k]))
  if (missing.length > 0) errors.push(`missing ${missing.join(', ')}`)

  const basePrice = parseMoney(raw.basePrice)
  if (isBlank(raw.basePrice)) {
    errors.push('missing base price')
  } else if (Number.isNaN(basePrice) || basePrice <= 0) {
    errors.push(`base price must be a number above 0 (got "${raw.basePrice}")`)
  }

  if (errors.length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      itemId: String(raw.itemId).trim(),
      product: String(raw.product).trim(),
      brand: String(raw.brand).trim(),
      platform: String(raw.platform).trim(),
      basePrice: Math.round(basePrice),
    },
  }
}
