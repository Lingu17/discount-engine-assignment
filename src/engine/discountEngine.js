/**
 * discountEngine.js
 *
 * Pure discount calculation logic. No UI, no I/O, no knowledge of where the
 * rules or cart came from (CSV, text, PDF...). It only accepts the validated
 * shapes defined in schema.js (DiscountRule, CartItem).
 *
 * Money rule: every discount step is rounded to whole rupees, which is what
 * the expected results in the brief use (e.g. 15% of 1,299 = 194.85 -> 195).
 *
 * Output shapes:
 *
 * DiscountResult (one per cart item) {
 *   itemId, product, brand, platform, basePrice,
 *   finalPrice:    number
 *   totalDiscount: number
 *   appliedRules:  string[]   — rule IDs, in the order applied
 *   skippedRules:  string[]   — matching non-stackable rules that lost
 *   status:        "none" | "applied" | "max" | "stacked"
 *   reasoning:     string     — customer-readable explanation
 * }
 *
 * CartSummary (whole cart) {
 *   items:         DiscountResult[]
 *   subtotal:      number     — sum of item final prices (before cart offer)
 *   cartOffer:     null | { appliedRules, skippedRules, saving, reasoning }
 *   finalTotal:    number
 *   nextCartOffer: null | { rule, amountNeeded }  — closest cart offer not yet reached
 * }
 */

import { describeRule, formatRs, describeDiscount } from './format.js'

const normalise = (s) => String(s ?? '').trim().toLowerCase()

/** Returns true if an item-level rule (brand/platform) applies to this cart item. */
export function ruleMatchesItem(item, rule) {
  if (rule.scope === 'brand') return normalise(item.brand) === normalise(rule.appliesTo)
  if (rule.scope === 'platform') return normalise(item.platform) === normalise(rule.appliesTo)
  return false // cart rules never match a single item
}

/**
 * Rupee discount a rule gives on a given price (whole rupees).
 * Uses the price passed in, not the original base price — important for stacking.
 * Never returns more than the price itself, so a Rs.500-off rule on a Rs.300
 * item makes it free (Rs.0) instead of negative.
 */
export function calculateDiscountAmount(price, rule) {
  let amount = 0
  if (rule.type === 'percentage') amount = Math.round((price * rule.value) / 100)
  if (rule.type === 'flat') amount = rule.value
  return Math.max(0, Math.min(amount, price))
}

/**
 * The core selection logic, shared by items and the cart:
 *   1. Among non-stackable rules, apply the single one with the biggest rupee saving.
 *   2. Apply every stackable rule on top, one after another, on the reduced price.
 * Ties keep the rule that was listed first, so results are predictable.
 */
export function pickAndApply(price, rules) {
  const nonStackable = rules.filter((r) => !r.stackable)
  const stackable = rules.filter((r) => r.stackable)

  const ranked = nonStackable
    .map((rule, index) => ({ rule, index, saving: calculateDiscountAmount(price, rule) }))
    .sort((a, b) => b.saving - a.saving || a.index - b.index)

  const winner = ranked[0]?.rule ?? null
  const skipped = ranked.slice(1).map((r) => r.rule)

  let current = price
  const steps = []
  for (const rule of winner ? [winner, ...stackable] : stackable) {
    const saving = calculateDiscountAmount(current, rule)
    current -= saving
    steps.push({ rule, saving })
  }

  return { finalPrice: current, steps, winner, skipped }
}

/** Applies the matching brand/platform rules to one cart item. */
export function applyDiscounts(item, rules) {
  const base = {
    itemId: item.itemId,
    product: item.product,
    brand: item.brand,
    platform: item.platform,
    basePrice: item.basePrice,
  }

  const matching = rules.filter((r) => ruleMatchesItem(item, r))
  if (matching.length === 0) {
    return {
      ...base,
      finalPrice: item.basePrice,
      totalDiscount: 0,
      appliedRules: [],
      skippedRules: [],
      status: 'none',
      reasoning: 'No offers available',
    }
  }

  const { finalPrice, steps, winner, skipped } = pickAndApply(item.basePrice, matching)

  let reasoning = steps.map((s) => describeRule(s.rule)).join(' + ')
  if (winner && skipped.length > 0) {
    // Tell the customer why they got this offer and not the other one.
    reasoning += ` (better than ${skipped.map(describeRule).join(', ')})`
  }

  let status = 'applied'
  if (steps.length > 1) status = 'stacked'
  else if (skipped.length > 0) status = 'max'

  return {
    ...base,
    finalPrice,
    totalDiscount: item.basePrice - finalPrice,
    appliedRules: steps.map((s) => s.rule.ruleId),
    skippedRules: skipped.map((r) => r.ruleId),
    status,
    reasoning,
  }
}

/** Runs applyDiscounts across every item in the cart. */
export function processCart(cartItems, rules) {
  return cartItems.map((item) => applyDiscounts(item, rules))
}

/** Sums the final prices across all item results. */
export function cartTotal(results) {
  return results.reduce((sum, r) => sum + r.finalPrice, 0)
}

/**
 * Applies cart-level rules to the subtotal (sum of item final prices).
 * A cart rule is eligible when subtotal >= minCartValue ("meets or exceeds",
 * as the brief says). Eligible cart rules use the same pick-the-biggest /
 * stack-the-stackable logic as items.
 */
export function applyCartRules(subtotal, rules) {
  const cartRules = rules.filter((r) => r.scope === 'cart')
  const eligible = cartRules.filter((r) => subtotal >= r.minCartValue)

  // The closest offer the customer has not reached yet ("add Rs.X more...").
  const nextRule = cartRules
    .filter((r) => subtotal < r.minCartValue)
    .sort((a, b) => a.minCartValue - b.minCartValue)[0]
  const nextCartOffer = nextRule
    ? { rule: nextRule, amountNeeded: nextRule.minCartValue - subtotal }
    : null

  if (eligible.length === 0) {
    return { cartOffer: null, finalTotal: subtotal, nextCartOffer }
  }

  const { finalPrice, steps, skipped } = pickAndApply(subtotal, eligible)
  const saving = subtotal - finalPrice

  return {
    cartOffer: {
      appliedRules: steps.map((s) => s.rule.ruleId),
      skippedRules: skipped.map((r) => r.ruleId),
      saving,
      // e.g. "Cart offer: 10% off — Rs.593 saved"
      reasoning: `Cart offer: ${steps.map((s) => describeDiscount(s.rule)).join(' + ')} — ${formatRs(saving)} saved`,
    },
    finalTotal: finalPrice,
    nextCartOffer,
  }
}

/** Full pipeline: item-level discounts first, then the cart offer on the subtotal. */
export function calculateCart(cartItems, rules) {
  const items = processCart(cartItems, rules)
  const subtotal = cartTotal(items)
  return { items, subtotal, ...applyCartRules(subtotal, rules) }
}
