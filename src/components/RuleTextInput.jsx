/**
 * RuleTextInput.jsx
 *
 * Plain-English rule box: type -> parse (LLM via server) -> review -> confirm or discard.
 * The rule is only handed to the parent (onAdd) after the user confirms.
 */

import { useState } from 'react'
import { parseRuleText } from '../adapters/textRuleAdapter.js'
import { describeDiscount, formatRs } from '../engine/format.js'
import ErrorBanner from './ErrorBanner.jsx'

const EXAMPLES = [
  '20% off for Natura Casa brand, stackable with other offers',
  'Rs.100 flat discount on all Flipkart items',
  '10% off if cart value is more than Rs.5,000',
]

const btn = (bg, color = '#fff') => ({
  background: bg, color, border: bg === '#fff' ? '1px solid #CECECE' : 'none', borderRadius: 4,
  padding: '0.5rem 1.1rem', fontSize: 12, fontWeight: 700, cursor: 'pointer',
})

export default function RuleTextInput({ cartItems, rules, onAdd }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null) // { rule, warnings } awaiting confirmation

  async function handleParse(e) {
    e.preventDefault()
    if (!text.trim() || loading) return
    setLoading(true)
    setError('')
    setPending(null)
    const result = await parseRuleText(text.trim(), { cartItems, rules })
    setLoading(false)
    if (result.ok) setPending(result)
    else setError(result.message)
  }

  function confirm() {
    onAdd(pending.rule)
    setPending(null)
    setText('')
  }

  const rule = pending?.rule
  const fields = rule && [
    ['Scope', rule.scope[0].toUpperCase() + rule.scope.slice(1)],
    ['Applies to', rule.scope === 'cart' ? 'Entire cart' : rule.appliesTo],
    ['Type', rule.type === 'percentage' ? 'Percentage' : 'Flat'],
    ['Value', describeDiscount(rule)],
    ['Stackable', rule.stackable ? 'Yes' : 'No'],
    ...(rule.scope === 'cart' ? [['Condition', `Cart total ≥ ${formatRs(rule.minCartValue)}`]] : []),
  ]

  return (
    <div>
      <form onSubmit={handleParse} style={{ display: 'flex', gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder='e.g. "15% off on all Flipkart items"'
          maxLength={300}
          disabled={loading}
          aria-label="Describe a discount rule"
          style={{ flex: 1, padding: '0.55rem 0.7rem', fontSize: 13, border: '1px solid #CECECE', borderRadius: 4 }}
        />
        <button type="submit" disabled={loading || !text.trim()} style={{ ...btn('#131A48'), opacity: loading || !text.trim() ? 0.5 : 1 }}>
          {loading ? 'Reading…' : 'Parse rule'}
        </button>
      </form>

      {!pending && (
        <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>
          Try:{' '}
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)}
              style={{ background: 'none', border: 'none', color: '#FF5800', cursor: 'pointer', fontSize: 11, padding: '0 6px 0 0' }}>
              “{ex}”
            </button>
          ))}
        </div>
      )}

      <ErrorBanner title="Couldn't create a rule" errors={error ? [error] : []} />

      {pending && (
        <div style={{ marginTop: '0.75rem', border: '1px solid #FF5800', borderRadius: 6, padding: '0.8rem 1rem', background: '#fffaf5' }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#131A48', marginBottom: 6 }}>
            Please check this rule ({rule.ruleId}) before adding it
          </div>
          <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '3px 14px', margin: 0, fontSize: 12 }}>
            {fields.map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <dt style={{ color: '#888' }}>{k}</dt>
                <dd style={{ margin: 0, fontWeight: 600, color: '#131A48' }}>{v}</dd>
              </div>
            ))}
          </dl>
          {pending.warnings.map((w) => (
            <div key={w} style={{ fontSize: 12, color: '#8a5a00', background: '#fff4d6', borderRadius: 4, padding: '4px 8px', marginTop: 8 }}>
              ⚠ {w}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" onClick={confirm} style={btn('#FF5800')}>Add rule</button>
            <button type="button" onClick={() => setPending(null)} style={btn('#fff', '#131A48')}>Discard</button>
          </div>
        </div>
      )}
    </div>
  )
}
