/**
 * textRuleAdapter.js — input adapter: plain-English text -> DiscountRule
 *
 * 1. Sends the text to /api/parse-rule (the server holds the LLM key).
 * 2. Treats the LLM's answer as an untrusted draft and checks it:
 *    - it must pass the same validateRule() as CSV rules,
 *    - every number in it must appear in the user's text (no invented values),
 *    - a brand/platform that matches nothing in the cart gives a warning.
 * Nothing is added to the rules here; the UI asks the user to confirm first.
 */

import { validateRule } from '../engine/schema.js'
import { formatRs } from '../engine/format.js'

const EXAMPLE = 'Try something like "15% off Flipkart items" or "10% off orders above Rs.5,000".'

/** All numbers written in the text: "Rs.5,000" -> 5000, "5k" -> 5000, "20%" -> 20. */
export function numbersInText(text) {
  return [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/gi)].map(
    ([, n, k]) => Number(n.replace(/,/g, '')) * (k ? 1000 : 1),
  )
}

/** Next free ID after the highest existing one: RULE-04 -> RULE-05. */
export function nextRuleId(rules) {
  const max = Math.max(0, ...rules.map((r) => Number(/(\d+)$/.exec(r.ruleId)?.[1] ?? 0)))
  return `RULE-${String(max + 1).padStart(2, '0')}`
}

/**
 * Pure check of an LLM draft. Returns
 *   { ok: true, rule, warnings }  or  { ok: false, message }
 */
export function interpretDraft(draft, text, { cartItems = [], rules = [] } = {}) {
  if (draft?.status !== 'ok') {
    return { ok: false, message: `${draft?.reason || 'That description is too vague to become a rule.'} ${EXAMPLE}` }
  }

  const result = validateRule({ ...draft, ruleId: nextRuleId(rules) })
  if (!result.ok) {
    return { ok: false, message: `Couldn't build a complete rule: ${result.errors.join('; ')}. ${EXAMPLE}` }
  }
  const rule = result.value

  const written = numbersInText(text)
  const invented = [rule.value, rule.minCartValue].filter((n) => n !== null && !written.includes(n))
  if (invented.length > 0) {
    return {
      ok: false,
      message: `The AI suggested ${invented.join(' and ')}, but that number isn't in your text, so we didn't guess. Please write the exact amount.`,
    }
  }

  const warnings = []
  if (rule.scope === 'cart') {
    if (/more than|above|over|exceed/i.test(text)) {
      warnings.push(`Read as "cart total of ${formatRs(rule.minCartValue)} or more" — the same ≥ check every cart offer uses.`)
    }
  } else {
    const field = rule.scope // "brand" or "platform"
    const match = cartItems.find((item) => item[field].toLowerCase() === rule.appliesTo.toLowerCase())
    if (match) rule.appliesTo = match[field] // use the cart's spelling
    else warnings.push(`No item in the current cart has ${field} "${rule.appliesTo}", so this rule won't change any price yet.`)
  }

  return { ok: true, rule, warnings }
}

/** Calls the server, then interpretDraft(). Never throws. */
export async function parseRuleText(text, { cartItems = [], rules = [] } = {}, fetchImpl = fetch) {
  const unique = (values) => [...new Set(values)]
  let response, payload
  try {
    response = await fetchImpl('/api/parse-rule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        brands: unique(cartItems.map((i) => i.brand)),
        platforms: unique(cartItems.map((i) => i.platform)),
      }),
    })
    payload = await response.json()
  } catch {
    return { ok: false, message: 'Could not reach the server. Check your connection and try again.' }
  }
  if (!response.ok) return { ok: false, message: payload?.error ?? 'Something went wrong. Please try again.' }
  return interpretDraft(payload.draft, text, { cartItems, rules })
}
