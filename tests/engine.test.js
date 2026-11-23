import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { calculateCart, calculateDiscountAmount } from '../src/engine/discountEngine.js'
import { parseRulesCSV, parseCartCSV } from '../src/adapters/csvAdapter.js'

const rules = parseRulesCSV(readFileSync('sample-data/rules.csv', 'utf8')).data
const cart = parseCartCSV(readFileSync('sample-data/cart.csv', 'utf8')).data
const item = (basePrice, brand = 'B', platform = 'P') => ({ itemId: 'I', product: 'X', brand, platform, basePrice })
const rule = (o) => ({ ruleId: 'R', scope: 'platform', appliesTo: 'P', type: 'percentage', value: 10, stackable: false, minCartValue: null, ...o })
const cartRule = (o) => rule({ scope: 'cart', appliesTo: '', minCartValue: 4000, ...o })

describe('sample data from the brief', () => {
  const summary = calculateCart(cart, rules)

  it('matches the expected item prices and statuses', () => {
    expect(summary.items.map((r) => r.finalPrice)).toEqual([1104, 629, 509, 2499, 382, 809])
    expect(summary.items.map((r) => r.status)).toEqual(['max', 'stacked', 'applied', 'none', 'applied', 'applied'])
    expect(summary.items[3].reasoning).toBe('No offers available')
  })

  it('applies the cart offer after item discounts', () => {
    expect(summary.subtotal).toBe(5932)
    expect(summary.cartOffer.saving).toBe(593)
    expect(summary.cartOffer.reasoning).toBe('Cart offer: 10% off — Rs.593 saved')
    expect(summary.finalTotal).toBe(5339)
  })
})

describe('cart offer threshold', () => {
  it('does not apply at Rs.3,999 and says how much more is needed', () => {
    const s = calculateCart([item(3999)], [cartRule()])
    expect(s.cartOffer).toBeNull()
    expect(s.finalTotal).toBe(3999)
    expect(s.nextCartOffer.amountNeeded).toBe(1)
  })

  it('applies at exactly Rs.4,000 (meets or exceeds)', () => {
    expect(calculateCart([item(4000)], [cartRule()]).finalTotal).toBe(3600)
  })

  it('checks the threshold against prices AFTER item discounts', () => {
    // 4,400 - 10% item discount = 3,960, which is below 4,000
    const s = calculateCart([item(4400)], [rule({ value: 10 }), cartRule()])
    expect(s.subtotal).toBe(3960)
    expect(s.cartOffer).toBeNull()
  })

  it('picks the biggest saving when several cart rules qualify', () => {
    const s = calculateCart([item(10000)], [
      cartRule({ ruleId: 'C1', value: 5 }),
      cartRule({ ruleId: 'C2', type: 'flat', value: 800, minCartValue: 8000 }),
      cartRule({ ruleId: 'C3', value: 15, minCartValue: 20000 }), // not reached
    ])
    expect(s.cartOffer.appliedRules).toEqual(['C2'])
    expect(s.cartOffer.skippedRules).toEqual(['C1'])
    expect(s.finalTotal).toBe(9200)
  })
})

describe('item edge cases', () => {
  it('never lets a flat discount make a price negative', () => {
    expect(calculateDiscountAmount(300, rule({ type: 'flat', value: 500 }))).toBe(300)
    expect(calculateCart([item(300)], [rule({ type: 'flat', value: 500 })]).items[0].finalPrice).toBe(0)
  })

  it('applies a stackable rule on its own when no non-stackable rule matches', () => {
    const s = calculateCart([item(1000)], [rule({ stackable: true })])
    expect(s.items[0].finalPrice).toBe(900)
  })

  it('matches brand and platform names case-insensitively', () => {
    const s = calculateCart([item(1000, 'Natura Casa')], [rule({ scope: 'brand', appliesTo: ' natura casa ' })])
    expect(s.items[0].finalPrice).toBe(900)
  })
})
