# Ledger conventions and VAT/GST notes

## Which tax regime?

This connector supports both **UAE VAT** and **India GST** as parallel,
separate concepts — check which applies before drafting anything tax-bearing:

- **UAE VAT**: use `vatRatePercent`/`vatLedger` on invoice items (as shown
  in `voucher-mapping.md`). Verify a period afterward with
  `get_vat_liability_summary`.
- **India GST**: the same `vatRatePercent`/`vatLedger` fields carry the
  GST rate and ledger — this connector's item-invoice tools don't have
  separate `gstRatePercent` fields, the VAT-named fields are reused for
  GST too. If the client is registered for GST with CGST+SGST (intra-state)
  or IGST (inter-state) split into separate ledgers rather than one
  combined rate, draft one item line's tax through `vatLedger` per
  distinct ledger it should hit, or use `entries`-style multi-leg posting
  via `create_voucher` for the tax legs on a non-item voucher. Verify a
  period afterward with `get_gst_liability_summary`.
- Don't assume — ask, or check the company's existing ledgers
  (`get_ledgers(query: "vat")` or `get_ledgers(query: "gst")`) for which
  regime is already set up before drafting the first voucher.

## New party ledger (customer/supplier)

```json
{
  "toolName": "create_ledger",
  "args": {
    "name": "Bright Horizon Traders",
    "parent": "Sundry Debtors",
    "maintainBillWise": true,
    "trn": "1000XXXXXXXXX003",
    "address": ["Unit 4, Al Quoz Industrial Area 3"],
    "state": "Dubai",
    "country": "United Arab Emirates"
  }
}
```

- `parent`: `Sundry Debtors` for a customer (something that owes the
  client money), `Sundry Creditors` for a supplier (something the client
  owes). Both must already exist as groups in the company — they do by
  default in a fresh TallyPrime company.
- `maintainBillWise: true` whenever the client will want to settle
  Receipts/Payments against specific invoices later (see
  `voucher-mapping.md`'s bill-wise note) — set it now rather than
  discovering the gap when a Receipt won't bill-match.
- `trn` is the party's Tax Registration Number, when the document shows
  one — worth capturing even if not immediately used, since it's
  needed for VAT return purposes later.

## New sales/purchase ledger

Usually a company already has generic `Sales - Local`/`Purchase - Local`
(or similarly named) ledgers — check with `get_ledgers(query: "sales")` /
`get_ledgers(query: "purchase")` before creating a new one. Only draft a
new one if the client's chart of accounts genuinely separates revenue/cost
by category (e.g. `Sales - Export` vs `Sales - Local`) and the document
clearly indicates which.

```json
{
  "toolName": "create_ledger",
  "args": { "name": "Sales - Local", "parent": "Sales Accounts" }
}
```

## New VAT/GST ledger

```json
{
  "toolName": "create_ledger",
  "args": { "name": "Output VAT", "parent": "Duties & Taxes" }
}
```

`Input VAT`/`Output VAT` (or the GST equivalents) both go under
`Duties & Taxes`. Don't assume this is the *only* place they'll be found in
a real company file, though — `get_vat_liability_summary`'s own
implementation note (see the main connector's README) found that real
companies scatter these across other groups too; that's a read-tool
concern, not something to worry about when *creating* a new one, but worth
knowing if a search for an existing VAT ledger by group alone comes up
empty.

## New expense ledger

```json
{
  "toolName": "create_ledger",
  "args": { "name": "Courier Charges", "parent": "Indirect Expenses" }
}
```

Match the parent group to what the expense actually is — `Direct Expenses`
for something tied to production/cost of goods, `Indirect Expenses` for
general overhead (rent, utilities, courier, bank charges).

## Self-troubleshooting

- **`create_ledger` (via `preview_write`, then `confirm_write`) fails** —
  the `parent` group name must match Tally's own spelling *exactly*
  (case- and whitespace-sensitive). Confirm with `get_groups` if unsure
  rather than guessing a plausible-looking name.
- **A ledger search (`get_ledgers(query: ...)`) returns nothing close, but
  you're fairly sure it exists** — the fuzzy matcher checks exact match,
  prefix, substring, then a loose subsequence fallback; it won't catch a
  name that's genuinely unrelated in spelling to what the document shows
  (e.g. a trading name vs. the legal entity name on file). Try a shorter
  or different fragment of the name before concluding it doesn't exist.
