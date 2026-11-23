/** Formats whole rupees the Indian way: 5932 -> "Rs.5,932". */
export function formatRs(amount) {
  return `Rs.${Math.round(amount).toLocaleString('en-IN')}`
}

/** "15% off" or "Rs.150 off" */
export function describeDiscount(rule) {
  return rule.type === 'percentage' ? `${rule.value}% off` : `${formatRs(rule.value)} off`
}

/** "Amazon India offer" / "Natura Casa offer" / "Cart offer" */
export function offerName(rule) {
  return rule.scope === 'cart' ? 'Cart offer' : `${rule.appliesTo} offer`
}

/** "Amazon India offer: 15% off" */
export function describeRule(rule) {
  return `${offerName(rule)}: ${describeDiscount(rule)}`
}
