# Opptra Discount Engine

A checkout pricing engine: it picks the best offer for each cart item, applies a cart-level offer on top, and explains every price in plain language.

**Live demo:** _LIVE_URL_

Sample files to try are in [`sample-data/`](sample-data): `rules.csv`, `cart.csv`, `cart.pdf`, plus edge cases (`cart-messy.pdf`, `cart-scanned.pdf`, `cart-below-threshold.csv`).

## Run locally (3 steps)

```bash
npm install
cp .env.example .env    # then paste a free Gemini key from https://aistudio.google.com/apikey (only needed for the text-rule box)
npm run dev             # open http://localhost:5173
```

Tests: `npm test` (27 tests: engine, validation, CSV, text-rule and PDF adapters, server handler).

## What was built

| Brief | What it does |
|---|---|
| Foundation | Base engine verified against the expected table (1,104 / 629 / 509 / 2,499 / 382 / 809 → Rs.5,932) and deployed. |
| Task 1 — Cart-level offer | Cart rules (`scope: cart`, `min_cart_value`) are applied **after** item discounts, shown as their own row (`Cart offer: 10% off — Rs.593 saved`), and hidden when the threshold isn't met. Final total: Rs.5,339. |
| Task 2 — Plain-English rules | Type a rule → an LLM turns it into a `DiscountRule` → the app validates it → you see every field and **Add** or **Discard** → the cart re-prices instantly. Vague input ("Give a discount for big orders") gets a clear "please add …" message. |
| Task 3 — PDF cart upload | Upload a cart PDF (Product, Brand, Platform, Base Price) → it is read in the browser, replaces the cart, and the engine re-runs with the current rules. Bad rows are skipped and listed with the reason. |

> Note: the brief's *How We'll Evaluate This* section calls the text-rule task "Task 1" and the PDF task "Task 2" (it seems to count from the first new input). In this README they follow the build section's numbering: Task 2 = text rules, Task 3 = PDF.

## How it's structured

The engine never knows where data came from. Each input is an **adapter** that turns raw input into the same two shapes, checked by one shared validator.

```
 rules.csv ──┐                                  ┌── cart.csv
 plain text ─┤→ validateRule()  validateCartItem() ←┤── cart.pdf
             └──────────→  calculateCart(cart, rules)  ←────────┘
```

```
src/engine/       pure logic, no UI
  discountEngine.js   item + cart discount selection
  schema.js           DiscountRule / CartItem validators (the contract)
  format.js           "Rs.5,932", "15% off" labels
src/adapters/     one file per input type
  csvAdapter.js       CSV → rules / cart
  textRuleAdapter.js  plain English → rule (calls the API, then validates)
  pdfCartAdapter.js   PDF → cart (pdfjs-dist, in the browser)
server/parseRuleHandler.js   calls Gemini; shared by Vercel and the dev server
api/parse-rule.js            Vercel serverless function (keeps the API key off the browser)
```

**Adding a fourth input** (say, an Excel cart) = one new adapter that calls `validateCartItem()`. Nothing in `src/engine/` changes.

## Decisions and trade-offs

**Engine**
- **Threshold check is `≥`**, as the brief says ("meets or exceeds"). "More than Rs.5,000" is read as "Rs.5,000 or more" too, and the confirmation card says so out loud, so there is one consistent rule instead of two operators. Rs.3,999 → no offer, and the customer sees "Add Rs.1 more to get 10% off your whole cart."
- **Threshold is checked against prices after item discounts** (the brief's rule), so a Rs.4,400 cart with a 10% item offer (→ Rs.3,960) does *not* get the cart offer.
- **Several cart rules** use exactly the same logic as items: the biggest rupee saving wins, stackable ones go on top. One function (`pickAndApply`) does both, so they can't drift apart.
- **Flat discount bigger than the price** makes the item Rs.0, never negative.
- **Rounding**: every discount step is rounded to whole rupees (15% of 1,299 = 194.85 → 195), which is what the expected results use.
- **Ties** between equally good rules keep the one listed first, so results are predictable.

**Plain-English rules (LLM)**
- **The LLM only reads text; it never calculates prices.** Prices come from plain code that is tested. CSV and PDF parsing don't use an LLM either — they have a fixed structure, so code is cheaper, faster and always gives the same answer.
- **The API key stays on the server** (Vercel function). The browser never sees it.
- **The AI's answer is treated as untrusted.** Gemini is asked for JSON in a fixed schema (temperature 0), and then the app checks it with the same `validateRule()` used for CSV (type, value > 0, percent ≤ 100, cart rule needs a minimum value, …).
- **No invented numbers**: every number in the parsed rule must appear in what the user typed. If the AI "helpfully" guesses 10% for "big orders", the rule is rejected and the user is asked to state the amount.
- **Unknown brand/platform is a warning, not an error** — a rule for a brand not in this cart is still valid for future carts, but the user is told it won't change any price yet. Matching names are snapped to the cart's spelling ("natura casa" → "Natura Casa").
- Gemini was chosen for its free tier, so reviewers trying the demo cost nothing. The provider sits behind one small function and is easy to swap.

**PDF upload**
- Parsed **in the browser** (no server needed, the file never leaves the user's machine). The PDF library is loaded only when a PDF is uploaded, so the page stays fast.
- Columns are found from the header row's positions, so it works whether the PDF stores each cell separately or each row as one string (like the brief's example). Text above the header (order number, date), separator lines, "Total" lines and repeated headers on later pages are ignored.
- **Malformed rows are skipped and listed with the reason** (`Skipped "Wall Shelf … TBD": base price must be a number above 0`). The good rows still load.
- **Scanned PDFs** (no text layer) get a clear message asking for a text PDF or CSV. I chose not to add OCR: it is slow, error-prone on prices, and a wrong price at checkout is worse than asking for a better file.
- **A file with no valid rows never wipes the current cart** (same for rules). One bad upload shouldn't lose the user's session.

**Other**
- The repo's `sample-data/rules.csv` was missing RULE-04 and the `min_cart_value` column shown in the brief; both were added.
- After the first **Calculate Discounts**, results update automatically whenever rules or the cart change.

## Where I'd do it differently (proposed alternative)

**Make the confirmation step an editable form instead of confirm/discard.** Today, if the AI gets one field wrong (say, stackable), the user must discard and retype the whole sentence, hoping for a different answer. Better: show the parsed rule as a small pre-filled form (scope, name dropdown from the cart, type, value, stackable, threshold). The user fixes the one wrong field and clicks Add. The LLM becomes a *shortcut for filling the form*, not the only way in — and the same form works with no LLM at all if the API is down.

On the PDF assumption: in production I'd ask for the platforms' order exports (CSV/JSON/API) as the main cart source. A PDF is a print format and loses structure; it's fine as a fallback, which is how it's treated here.

## What I'd do next

1. The editable confirmation form above.
2. Show *why* an offer was not applied ("Flipkart 10% didn't apply — this item is on Amazon India").
3. Rule start/end dates and per-rule limits (max discount Rs.X), which real campaigns need.
4. Use paise (integers) internally if rules ever need fractional rupees.
5. Rate limiting on the API route before sharing the demo widely.
