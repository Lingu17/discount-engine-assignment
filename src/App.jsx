/**
 * App.jsx
 *
 * Holds the session state (rules, cart) and connects the input adapters to
 * the engine. Every input path produces the same DiscountRule / CartItem
 * shapes, so the engine call below never changes when a new input is added:
 *
 *   rules: CSV upload (csvAdapter)   or  plain English (textRuleAdapter)
 *   cart:  CSV upload (csvAdapter)   or  PDF upload (pdfCartAdapter)
 *                         ↓
 *               calculateCart(cartItems, rules)
 */

import { useMemo, useState } from 'react'
import FileUploader from './components/FileUploader.jsx'
import DataTable from './components/DataTable.jsx'
import ErrorBanner from './components/ErrorBanner.jsx'
import RuleTextInput from './components/RuleTextInput.jsx'
import { parseRulesCSV, parseCartCSV } from './adapters/csvAdapter.js'
import { parsePdfCart } from './adapters/pdfCartAdapter.js'
import { calculateCart } from './engine/discountEngine.js'
import { describeDiscount, formatRs } from './engine/format.js'

// ── Column definitions ───────────────────────────────────────────

const capitalise = (v) => v.charAt(0).toUpperCase() + v.slice(1)

const RULES_COLUMNS = [
  { key: 'ruleId',    label: 'Rule ID' },
  { key: 'scope',     label: 'Scope',      render: capitalise },
  { key: 'appliesTo', label: 'Applies To', render: (v, row) => (row.scope === 'cart' ? 'Entire cart' : v) },
  { key: 'type',      label: 'Type',       render: capitalise },
  { key: 'value',     label: 'Value',      render: (v, row) => describeDiscount(row) },
  { key: 'minCartValue', label: 'Condition', render: (v) => (v === null ? '—' : `Cart total ≥ ${formatRs(v)}`) },
  { key: 'stackable', label: 'Stackable',  render: (v) => (v ? 'Yes' : 'No') },
]

const CART_COLUMNS = [
  { key: 'itemId',    label: 'Item' },
  { key: 'product',   label: 'Product' },
  { key: 'brand',     label: 'Brand' },
  { key: 'platform',  label: 'Platform' },
  { key: 'basePrice', label: 'Base Price', render: formatRs },
]

const STATUS = {
  max:     { text: 'Max discount',     color: '#1e5c2c', bg: '#e3f4e7' },
  stacked: { text: 'Stacked',          color: '#1a3a8a', bg: '#e4ebfb' },
  applied: { text: 'Discount applied', color: '#1e5c2c', bg: '#e3f4e7' },
  none:    { text: 'No offer',         color: '#666',    bg: '#eee' },
}

const RESULTS_COLUMNS = [
  { key: 'itemId',    label: 'Item' },
  { key: 'product',   label: 'Product' },
  { key: 'basePrice', label: 'Base Price', render: formatRs },
  {
    key: 'finalPrice',
    label: 'Final Price',
    render: (v, row) => (
      <span style={{ fontWeight: 700, color: row.totalDiscount > 0 ? '#1e5c2c' : '#131A48' }}>{formatRs(v)}</span>
    ),
  },
  {
    key: 'totalDiscount',
    label: 'You Save',
    render: (v) => (v > 0 ? <span style={{ color: '#1e5c2c', fontWeight: 600 }}>{formatRs(v)}</span> : <span style={{ color: '#888' }}>—</span>),
  },
  {
    key: 'reasoning',
    label: 'Offer Applied',
    wrap: true,
    render: (v, row) => <span style={{ color: row.status === 'none' ? '#888' : '#131A48', fontStyle: row.status === 'none' ? 'italic' : 'normal' }}>{v}</span>,
  },
  {
    key: 'status',
    label: 'Status',
    render: (v) => <span style={S.tag(STATUS[v].color, STATUS[v].bg)}>{STATUS[v].text}</span>,
  },
]

// ── Styles ───────────────────────────────────────────────────────

const S = {
  page:    { minHeight: '100vh', background: '#f7f7f9', fontFamily: 'Arial, sans-serif' },
  header:  { background: '#131A48', padding: '0.85rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logoTxt: { fontFamily: 'Georgia, serif', fontSize: 17, fontWeight: 700, color: '#fff', letterSpacing: '-0.02em' },
  logoSpan:{ color: '#FF5800' },
  headerSub: { fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.07em' },
  main:    { maxWidth: 1000, margin: '0 auto', padding: '1.8rem 1.5rem' },
  section: { background: '#fff', border: '1px solid #CECECE', borderRadius: 6, padding: '1.2rem 1.4rem', marginBottom: '1.2rem', minWidth: 0 },
  sectionTitle: { fontFamily: 'Georgia, serif', fontWeight: 700, fontSize: 14, color: '#131A48', marginBottom: '0.7rem', paddingBottom: 6, borderBottom: '2px solid #FF5800', display: 'inline-block' },
  hint:    { fontSize: 11, color: '#888', marginBottom: 4 },
  btn: (enabled) => ({
    background: enabled ? '#FF5800' : '#CECECE', color: '#fff', border: 'none', borderRadius: 4,
    padding: '0.65rem 2rem', fontSize: 13, fontWeight: 700, cursor: enabled ? 'pointer' : 'not-allowed',
    letterSpacing: '0.04em', textTransform: 'uppercase',
  }),
  totals:  { marginTop: '0.75rem', borderTop: '2px solid #131A48', fontSize: 13, color: '#131A48' },
  totalRow: (bg) => ({ display: 'flex', justifyContent: 'space-between', gap: '1rem', padding: '0.55rem 0.6rem', background: bg }),
  tag: (color, bg) => ({
    display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '1px 6px', whiteSpace: 'nowrap',
    borderRadius: 20, background: bg, color, textTransform: 'uppercase', letterSpacing: '0.04em',
  }),
}

/** Banner content for an upload: "Cart not updated" if nothing loaded, else "2 rows skipped". */
function describeIssues(data, errors, what) {
  if (errors.length === 0) return null
  const title = data.length === 0 ? `${what} not updated` : `${errors.length} row${errors.length > 1 ? 's' : ''} skipped`
  return { title, errors }
}

// ── Component ────────────────────────────────────────────────────

export default function App() {
  const [rules, setRules] = useState([])
  const [rulesIssues, setRulesIssues] = useState(null)
  const [rulesFileName, setRulesFileName] = useState('')

  const [cartItems, setCartItems] = useState([])
  const [cartIssues, setCartIssues] = useState(null)
  const [cartFileName, setCartFileName] = useState('')
  const [cartBusy, setCartBusy] = useState(false)

  const [showResults, setShowResults] = useState(false)

  // The engine re-runs automatically whenever the rules or the cart change.
  const summary = useMemo(() => calculateCart(cartItems, rules), [cartItems, rules])
  const canCalculate = rules.length > 0 && cartItems.length > 0

  // ── Handlers ──
  // Every adapter returns { data, errors }. A file with no valid rows keeps the
  // previous data, so one bad upload never wipes the session.

  async function handleRulesFile(file) {
    const { data, errors } = parseRulesCSV(await file.text())
    setRulesIssues(describeIssues(data, errors, 'Rules'))
    if (data.length === 0) return
    setRules(data)
    setRulesFileName(file.name)
  }

  async function handleCartFile(file) {
    const isPdf = file.name.toLowerCase().endsWith('.pdf')
    setCartBusy(true)
    const { data, errors } = isPdf ? await parsePdfCart(await file.arrayBuffer()) : parseCartCSV(await file.text())
    setCartBusy(false)
    setCartIssues(describeIssues(data, errors, 'Cart'))
    if (data.length === 0) return
    setCartItems(data)
    setCartFileName(file.name)
    if (isPdf && rules.length > 0) setShowResults(true) // PDF upload re-runs the engine straight away
  }

  function handleAddRule(rule) {
    setRules((current) => [...current, rule])
    if (cartItems.length > 0) setShowResults(true)
  }

  // ── Render ──

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={S.logoTxt}>O<span style={S.logoSpan}>pp</span>tra</div>
        <div style={S.headerSub}>Discount Engine</div>
      </div>

      <div style={S.main}>
        <div style={S.section}>
          <div style={S.sectionTitle}>Discount Rules</div>
          <FileUploader
            label="rules.csv"
            description="Upload your discount rules CSV"
            accept=".csv"
            onFile={handleRulesFile}
            hasData={rules.length > 0}
            fileName={rulesFileName || 'Rules added by text'}
          />
          <ErrorBanner {...rulesIssues} />
          {rules.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={S.hint}>{rules.length} rule{rules.length > 1 ? 's' : ''} active</div>
              <DataTable columns={RULES_COLUMNS} rows={rules} />
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Cart Items</div>
          <FileUploader
            label="cart.csv or cart.pdf"
            description="Upload your cart as a CSV or PDF"
            accept=".csv,.pdf"
            onFile={handleCartFile}
            hasData={cartItems.length > 0}
            fileName={cartFileName}
            busy={cartBusy}
          />
          <ErrorBanner {...cartIssues} />
          {cartItems.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={S.hint}>{cartItems.length} item{cartItems.length > 1 ? 's' : ''} in cart</div>
              <DataTable columns={CART_COLUMNS} rows={cartItems} />
            </div>
          )}
        </div>

        <div style={S.section}>
          <div style={S.sectionTitle}>Add a Rule in Plain English</div>
          <RuleTextInput cartItems={cartItems} rules={rules} onAdd={handleAddRule} />
        </div>

        <div style={{ textAlign: 'center', marginBottom: '1.2rem' }}>
          <button style={S.btn(canCalculate)} onClick={() => setShowResults(true)} disabled={!canCalculate}>
            Calculate Discounts
          </button>
          {!canCalculate && <div style={{ ...S.hint, marginTop: 6 }}>Add rules and a cart to calculate</div>}
        </div>

        {showResults && canCalculate && (
          <div style={S.section}>
            <div style={S.sectionTitle}>Cart Summary</div>
            <DataTable columns={RESULTS_COLUMNS} rows={summary.items} />

            <div style={S.totals}>
              <div style={S.totalRow()}>
                <span>Cart total before offer</span>
                <strong>{formatRs(summary.subtotal)}</strong>
              </div>
              {summary.cartOffer && (
                <div style={S.totalRow('#fffbea')}>
                  <span>{summary.cartOffer.reasoning} <span style={{ color: '#888' }}>({summary.cartOffer.appliedRules.join(' + ')})</span></span>
                  <strong style={{ color: '#1e5c2c' }}>−{formatRs(summary.cartOffer.saving)}</strong>
                </div>
              )}
              {summary.nextCartOffer && (
                <div style={{ ...S.totalRow(), color: '#8a5a00', fontSize: 12 }}>
                  Add {formatRs(summary.nextCartOffer.amountNeeded)} more to get {describeDiscount(summary.nextCartOffer.rule)} your whole cart.
                </div>
              )}
              <div style={{ ...S.totalRow('#e8f4ea'), fontSize: 16 }}>
                <strong>Final Cart Total</strong>
                <strong>{formatRs(summary.finalTotal)}</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
