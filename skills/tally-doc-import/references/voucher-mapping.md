# Voucher mapping — worked examples

Every example below is the exact `args` object to pass as `preview_write`'s
`args`, with `toolName` set to the tool named in the heading. Field names
match this connector's real schemas — see `docs/TOOLS.md` in the main repo
for the authoritative, complete list including every optional field.

All dates are `DD-MM-YYYY`. All amounts are plain positive numbers — none
of these tools use a signed-number convention.

## Sales invoice → `create_sales_invoice`

```json
{
  "date": "14-07-2026",
  "partyLedger": "Bright Horizon Traders",
  "items": [
    {
      "stockItem": "Widget A",
      "qty": 10,
      "rate": 250,
      "unit": "Nos",
      "salesLedger": "Sales - Local",
      "vatRatePercent": 5
    }
  ],
  "narration": "Invoice INV-2026-041",
  "voucherNumber": "INV-2026-041"
}
```

- `vatRatePercent` can be set per item (as above) or once at the top level
  (`"vatRatePercent": 5` alongside `"vatLedger": "Output VAT"`) if every
  line shares the same rate — the tool groups same-rate lines and computes
  one tax total per rate automatically. Don't compute the tax amount
  yourself.
- Pass `voucherNumber` as the document's own invoice number when it has
  one — this also works around a confirmed-live gotcha where item-invoice
  types can silently stop auto-numbering via the gateway (symptom: a blank
  `EXCEPTIONS:1` with no error text on `confirm_write`).
- **Self-troubleshooting:** if `confirm_write` comes back with
  `Cannot be deleted!` when correcting an already-posted invoice later,
  that's a known Tally quirk when the *same* party ledger/stock item
  appears on both a Sales and a Purchase invoice — a Company Data →
  Rewrite in Tally clears it; it isn't a permanent lock.

## Purchase bill → `create_purchase_invoice`

Same shape as the sales invoice, with `purchaseLedger` per item instead of
`salesLedger`:

```json
{
  "date": "12-07-2026",
  "partyLedger": "Skyline Industrial Ltd",
  "items": [
    { "stockItem": "Raw Material B", "qty": 50, "rate": 40, "unit": "Kg", "purchaseLedger": "Purchase - Local", "vatRatePercent": 5 }
  ],
  "narration": "Bill SIL-778",
  "voucherNumber": "SIL-778"
}
```

## Bank line, money in → `create_voucher` (Receipt)

```json
{
  "voucherType": "Receipt",
  "date": "31-07-2026",
  "debitLedger": "RAK Bank",
  "creditLedger": "Bright Horizon Traders",
  "amount": 2625,
  "narration": "Payment received against INV-2026-041"
}
```

- To settle a *specific* outstanding invoice rather than just posting the
  net ledger effect, add `creditBillName: "INV-2026-041"` and
  `creditBillType: "Agst Ref"` — only works if `Bright Horizon Traders` has
  `maintainBillWise: true` (check with `get_ledgers`, or set it via
  `create_ledger`'s `oldName` alter path if it isn't already on).
- If the ledger isn't bill-wise, or which invoice this settles is genuinely
  unclear from the bank statement, still draft the Receipt on the net
  amount and flag "needs manual bill-matching in Tally" in the batch
  review table — don't guess which invoice it settles.

## Bank line, money out → `create_voucher` (Payment)

Same shape as the Receipt above, with `voucherType: "Payment"` and the
debit/credit ledgers swapped (debit the expense/vendor, credit the bank).

## Cash expense receipt → `create_voucher` (Payment)

```json
{
  "voucherType": "Payment",
  "date": "18-07-2026",
  "debitLedger": "Courier Charges",
  "creditLedger": "Cash",
  "amount": 85,
  "narration": "Courier receipt, unregistered supplier — no VAT"
}
```

Usually no VAT leg — an unregistered/cash supplier typically doesn't charge
recoverable tax. If the receipt does show tax from a registered supplier,
treat it like a purchase bill (`create_purchase_invoice`) instead if it has
line items, or add a third leg via `entries` if it's a single non-item
expense with a VAT component.

## Credit note (sales return) → `create_credit_note`

Same shape as `create_sales_invoice`. `billType` defaults to `'Agst Ref'` —
returning 5 units increases book quantity by 5 (this tool's sign
convention mirrors the return, not the original sale).

```json
{
  "date": "20-07-2026",
  "partyLedger": "Bright Horizon Traders",
  "items": [
    { "stockItem": "Widget A", "qty": 2, "rate": 250, "unit": "Nos", "salesLedger": "Sales - Local", "vatRatePercent": 5 }
  ],
  "narration": "Credit note CN-2026-005 — damaged goods returned",
  "voucherNumber": "CN-2026-005"
}
```

## Debit note (purchase return) → `create_debit_note`

Same shape as `create_purchase_invoice`, `billType` defaults to
`'Agst Ref'`. Returning 3 units decreases book quantity by 3.

## Bank ↔ cash transfer → `create_voucher` (Contra)

```json
{
  "voucherType": "Contra",
  "date": "05-07-2026",
  "debitLedger": "Cash",
  "creditLedger": "RAK Bank",
  "amount": 1000,
  "narration": "Cash withdrawal for petty cash"
}
```

No tax — this is an internal transfer between the client's own accounts,
never a real income/expense event.

## Accountant's own adjustment → `create_voucher` (Journal)

```json
{
  "voucherType": "Journal",
  "date": "31-07-2026",
  "debitLedger": "Depreciation",
  "creditLedger": "Accumulated Depreciation - Equipment",
  "amount": 1200,
  "narration": "Monthly depreciation, per fixed asset schedule"
}
```

No tax — a reclassification/accrual, not a transaction with an external
party.

## A multi-leg voucher (e.g. one payment split across several expense heads)

Use `entries` instead of `debitLedger`/`creditLedger`/`amount`:

```json
{
  "voucherType": "Payment",
  "date": "31-07-2026",
  "entries": [
    { "ledgerName": "RAK Bank", "type": "credit", "amount": 950 },
    { "ledgerName": "Office Rent", "type": "debit", "amount": 700 },
    { "ledgerName": "Utilities", "type": "debit", "amount": 250 }
  ],
  "narration": "July rent + utilities, single bank transfer"
}
```

All `entries` must balance (sum of debits = sum of credits) — `create_voucher`
refuses otherwise, and `preview_write` surfaces that refusal before anything
is confirmed.
