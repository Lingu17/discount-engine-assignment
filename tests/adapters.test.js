import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { validateRule, parseMoney } from '../src/engine/schema.js'
import { parseRulesCSV, parseCartCSV } from '../src/adapters/csvAdapter.js'
import { interpretDraft, numbersInText, nextRuleId, parseRuleText } from '../src/adapters/textRuleAdapter.js'
import { readPdfTextItems, parseCartFromTextItems } from '../src/adapters/pdfCartAdapter.js'
import { handleParseRule } from '../server/parseRuleHandler.js'

const cart = parseCartCSV(readFileSync('sample-data/cart.csv', 'utf8')).data
const rules = parseRulesCSV(readFileSync('sample-data/rules.csv', 'utf8')).data

describe('schema', () => {
  it('parses Indian money formats', () => {
    expect(parseMoney('Rs.1,299')).toBe(1299)
    expect(parseMoney('₹ 2,499.00')).toBe(2499)
    expect(parseMoney('TBD')).toBeNaN()
  })

  it('rejects invalid rules with clear reasons', () => {
    const base = { ruleId: 'R', scope: 'brand', appliesTo: 'X', type: 'percentage', value: 10 }
    expect(validateRule({ ...base, value: 150 }).errors[0]).toMatch(/more than 100%/)
    expect(validateRule({ ...base, value: 0 }).ok).toBe(false)
    expect(validateRule({ ...base, scope: 'cart' }).errors[0]).toMatch(/minimum cart value/)
    expect(validateRule({ ...base, appliesTo: '' }).ok).toBe(false)
  })
})

describe('CSV adapter', () => {
  it('loads the sample rules including the cart rule', () => {
    expect(rules).toHaveLength(4)
    expect(rules[3]).toMatchObject({ scope: 'cart', minCartValue: 4000 })
  })

  it('skips bad rows and keeps good ones', () => {
    const { data, errors } = parseCartCSV('item_id,product,brand,platform,base_price\nA,X,B,P,100\nB,Y,B,P,abc')
    expect(data).toHaveLength(1)
    expect(errors[0]).toMatch(/^Row 3: base price/)
  })
})

describe('text rule adapter', () => {
  const ctx = { cartItems: cart, rules }

  it('turns the brief examples into rules', () => {
    const a = interpretDraft({ status: 'ok', scope: 'brand', appliesTo: 'natura casa', type: 'percentage', value: 20, stackable: true },
      '20% off for Natura Casa brand, stackable with other offers', ctx)
    expect(a.rule).toMatchObject({ ruleId: 'RULE-05', appliesTo: 'Natura Casa', value: 20, stackable: true })
    expect(a.warnings).toEqual([])

    const c = interpretDraft({ status: 'ok', scope: 'cart', type: 'percentage', value: 10, minCartValue: 5000 },
      '10% off if cart value is more than Rs.5,000', ctx)
    expect(c.rule).toMatchObject({ scope: 'cart', minCartValue: 5000 })
    expect(c.warnings[0]).toMatch(/or more/)
  })

  it('reports vague input as unresolvable', () => {
    const r = interpretDraft({ status: 'unresolvable', reason: 'Please say how much discount and the minimum order value.' },
      'Give a discount for big orders', ctx)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/how much discount/)
  })

  it('rejects numbers the AI invented', () => {
    const r = interpretDraft({ status: 'ok', scope: 'cart', type: 'percentage', value: 10, minCartValue: 5000 },
      'Give a discount for big orders', ctx)
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/isn't in your text/)
  })

  it('rejects an invalid AI answer instead of crashing', () => {
    expect(interpretDraft({ status: 'ok', scope: 'cart', type: 'percentage', value: 10 }, '10% off', ctx).ok).toBe(false)
    expect(interpretDraft(null, 'x', ctx).ok).toBe(false)
  })

  it('warns when the brand is not in the cart', () => {
    const r = interpretDraft({ status: 'ok', scope: 'brand', appliesTo: 'Ikea', type: 'flat', value: 100 }, 'Rs.100 off Ikea', ctx)
    expect(r.ok).toBe(true)
    expect(r.warnings[0]).toMatch(/No item in the current cart has brand "Ikea"/)
  })

  it('reads numbers and IDs', () => {
    expect(numbersInText('10% off above Rs.5,000 or 5k')).toEqual([10, 5000, 5000])
    expect(nextRuleId(rules)).toBe('RULE-05')
  })

  it('shows the server error message when the call fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'AI busy' }) })
    expect(await parseRuleText('10% off', ctx, fetchImpl)).toEqual({ ok: false, message: 'AI busy' })
  })
})

describe('PDF adapter', () => {
  const parse = async (file) =>
    parseCartFromTextItems(await readPdfTextItems(new Uint8Array(readFileSync(`sample-data/${file}`)), pdfjs))

  it('reads the cart PDF from the brief', async () => {
    const { data, errors } = await parse('cart.pdf')
    expect(errors).toEqual([])
    expect(data).toEqual(cart)
  })

  it('skips malformed rows with reasons, across pages', async () => {
    const { data, errors } = await parse('cart-messy.pdf')
    expect(data.map((i) => i.product)).toEqual(['Cushion Cover', 'Ceramic Vase', 'Desk Organiser'])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatch(/Bed Sheet Set.*missing brand/)
    expect(errors[1]).toMatch(/Wall Shelf.*TBD/)
  })

  it('explains a scanned PDF with no text', async () => {
    const { data, errors } = await parse('cart-scanned.pdf')
    expect(data).toEqual([])
    expect(errors[0]).toMatch(/scanned image/)
  })
})

describe('server handler', () => {
  const env = { ANTHROPIC_API_KEY: 'test-key' }
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const claude = (text, stop_reason = 'end_turn') => json({
    id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason,
    content: text === null ? [] : [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 },
  })
  const call = (fetchImpl) => handleParseRule({ method: 'POST', body: { text: '10% off' }, env, fetchImpl, maxRetries: 0 })

  it('validates input before calling the AI', async () => {
    expect((await handleParseRule({ method: 'GET', env })).status).toBe(405)
    expect((await handleParseRule({ method: 'POST', body: { text: ' ' }, env })).status).toBe(400)
    expect((await handleParseRule({ method: 'POST', body: { text: 'x' }, env: {} })).status).toBe(503)
  })

  it('returns the draft and sends the key as a header, not in the URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(claude('{"status":"ok","value":10}'))
    expect(await call(fetchImpl)).toEqual({ status: 200, body: { draft: { status: 'ok', value: 10 } } })
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain('test-key')
  })

  it('turns a safety refusal into an unresolvable draft', async () => {
    const res = await call(vi.fn().mockResolvedValue(claude(null, 'refusal')))
    expect(res.body.draft.status).toBe('unresolvable')
  })

  it('handles provider errors and unreadable output', async () => {
    const overloaded = vi.fn().mockResolvedValue(json({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, 529))
    expect((await call(overloaded)).body.error).toMatch(/busy/)
    expect((await call(vi.fn().mockResolvedValue(claude('not json')))).status).toBe(502)
  })
})
