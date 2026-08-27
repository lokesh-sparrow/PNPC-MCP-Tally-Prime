---
name: tally-doc-import
description: This skill should be used when the user wants to turn a client's raw documents — invoices, purchase bills, bank statements, credit/debit notes, cash receipts — into TallyPrime vouchers via PNPC-MCP-Tally-Prime, e.g. "process this client's document folder", "import these invoices into Tally", "draft vouchers from this bank statement". Reads mixed-format documents (PDF, scans, Excel/CSV) and drafts vouchers through this connector's own item-line, VAT/GST-aware create_* tools, gated by preview_write/confirm_write so nothing posts without review.
---

# Tally Document Import

Turn a folder of a client's real paperwork into TallyPrime vouchers, using
PNPC-MCP-Tally-Prime's own tools. This skill only classifies documents and
drafts calls — it never builds Tally XML by hand and never posts directly.
Every draft goes through `preview_write` first; nothing reaches Tally until
`confirm_write` is called on an explicitly approved batch.

## Prerequisites

Before starting:

1. Call `get_health_check`. If `gatewayReachable` is false or `readOnlyMode`
   is true, stop and tell the user — read-only mode blocks every write this
   skill drafts (including via `confirm_write`; `preview_write` itself still
   works even in read-only mode, since it never posts).
2. If a company other than the currently-open one is needed, call
   `set_company(companyName)` before anything else in this session — every
   lookup and write below applies to whichever company is active.
3. Confirm whether the client is on **UAE VAT** or **India GST** — the field
   name differs (`vatRatePercent`/`vatLedger` vs. the GST equivalent handled
   the same way; see `references/gst-and-ledgers.md`) and it changes which
   summary tool (`get_vat_liability_summary` vs `get_gst_liability_summary`)
   is useful for verification afterward.
4. Have a folder path containing the client's documents for the period.

## Workflow

### 1. Locate and read the documents

List the folder and group files by extension: PDF, JPG/PNG (scans/photos),
XLSX/XLS/CSV, and anything else.

- Read PDFs and images directly — Claude reads these natively, no OCR step.
- Read CSV files directly.
- For XLSX files, run `python scripts/xlsx_to_csv.py <file>` to get a
  plain-text table. **Self-troubleshooting:** this script reads the *raw*
  cell value, not its display formatting — a date column prints as a raw
  serial number (e.g. `45852`, not `14-07-2026`) and a percentage as a
  decimal fraction (e.g. `0.05`, not `5%`). Treat any suspicious integer
  next to a header like "Date" as a formatted value and either convert it
  (`date = EXCEL_EPOCH + serial days`, where `EXCEL_EPOCH` is 30-12-1899)
  or cross-check it against the source document — never post it as-is.
  If the script fails with `ModuleNotFoundError` or "python is not
  recognized", Python 3 isn't installed — this is the *only* place in this
  connector that needs Python; the connector itself and every other part
  of this skill work without it. Ask the user to install Python 3, or ask
  them to re-export the file as CSV instead (any spreadsheet app can do
  this), which sidesteps the script entirely.
- A file that can't be read or classified isn't skipped silently — carry it
  into the final batch summary (step 5) as **unprocessed**, with why.

### 2. Classify each document and extract the transaction

Decide which TallyPrime voucher type each document maps to. Full worked
examples (exact tool call, exact arguments) are in
`references/voucher-mapping.md` — consult it before drafting a document
type not already handled in this session.

| Client's document | Tool to call |
|---|---|
| Sales invoice | `create_sales_invoice` |
| Purchase bill | `create_purchase_invoice` |
| Bank line — money in | `create_voucher` (Receipt) |
| Bank line — money out | `create_voucher` (Payment) |
| Cash expense receipt | `create_voucher` (Payment) |
| Credit note | `create_credit_note` |
| Debit note | `create_debit_note` |
| Bank ↔ cash transfer | `create_voucher` (Contra) |
| Accountant's own adjustment | `create_voucher` (Journal) |

Extract, per transaction: date, party name, invoice/reference number, line
items (stock item, qty, rate — for real item-invoice tools), tax rate per
line, total, and a one-line narration.

**Date format is `DD-MM-YYYY`** — this connector's convention throughout,
not ISO. Indian/UAE documents are already `DD/MM/YYYY`; never assume US
`MM/DD/YYYY` ordering. When the day/month order is genuinely ambiguous
(e.g. `03/04/2026`), don't guess — flag it in the batch review table
(step 5) so the user resolves it.

**Do not compute the tax amount yourself.** `create_sales_invoice` and
`create_purchase_invoice` take `vatRatePercent` (per item, or once at the
top level as a default) and compute the correct grouped tax amount
internally — grouping same-rate lines, rounding, and totaling the party
amount for you. Pass the rate from the document; don't pre-multiply it out
into a manual tax line the way a flat ledger-only voucher tool would force
you to.

### 3. Resolve ledgers — reuse what exists, draft what's missing

For every ledger name a transaction touches (party, sales/purchase ledger
per item, bank/cash, expense head), call `get_ledgers(query: name)` first.

- If a close match comes back, use Tally's **exact** name from that match —
  never invent a slightly different spelling of an existing ledger, even a
  cosmetic one (extra space, different capitalization) — Tally treats it as
  a different ledger.
- If nothing close enough comes back (an empty or clearly-unrelated result),
  draft a new ledger via `preview_write(toolName: "create_ledger", args: {...})`.
  Parent-group and naming conventions (which group a new customer, VAT
  ledger, or expense head belongs under) are in
  `references/gst-and-ledgers.md`.

### 4. Draft every voucher through preview_write

For each transaction, call `preview_write` with the exact `toolName` from
the table in step 2 and the arguments that tool normally takes — see
`references/voucher-mapping.md` for a filled-in example of every voucher
type's args shape, including `create_voucher`'s sign convention (below).

**`create_voucher`'s convention:** either pass `debitLedger`, `creditLedger`,
`amount` (a plain positive number — no sign-flipping needed) for a simple
two-leg voucher, or `entries: [{ledgerName, type: "debit"|"credit", amount, billName?, billType?}]`
for three or more legs (e.g. one payment split across several expense
heads). All entry amounts are positive; `type` states direction explicitly.

**Settling a Receipt/Payment against a specific outstanding invoice**, not
just posting the net ledger effect: pass `debitBillName`/`creditBillName`
with `billType: "Agst Ref"` and the invoice's own reference number — this
only works if the party ledger has `maintainBillWise: true` (check with
`get_ledgers`, or set it when the ledger is created/altered). If a bank
line clearly settles a specific invoice in this batch but the ledger isn't
bill-wise, still draft the Receipt/Payment on the net ledger, and flag in
the batch table (step 5) that bill-wise matching will need doing manually
in Tally afterward.

**Self-troubleshooting for `preview_write` itself:**
- `'<toolName>' isn't a previewable write tool` — the `toolName` is
  misspelled, or isn't one of the create_*/update_*/delete_*/
  set_bill_of_materials tools. Re-check the table in step 2.
- A refusal quoting a voucher-type collision — `preview_write` runs the
  same pre-check the real tool would (for `update_*`/`delete_voucher`
  toolNames only; not relevant for drafting new documents, which are
  always `create_*`). See `docs/TROUBLESHOOTING.md` in the main connector
  repo if this comes up while correcting an already-posted batch.
- Godown missing on a company with multi-godown tracking silently makes
  the *eventual* `confirm_write` fail with a blank `EXCEPTIONS:1` — this
  isn't caught at preview time, since preview only builds XML, it doesn't
  send it. If the client's company uses multiple godowns, always pass a
  `godown` per item now, at draft time, rather than discovering the gap
  after review when `confirm_write` fails.

### 5. Present one consolidated batch for review — confirm nothing yet

Build a single table covering the whole batch: source file, tool called,
date, party, amount, tax rate, narration, and the `previewId` for each. List
any new-ledger previews above the voucher table, since those must be
confirmed first (step 6) — a voucher referencing a ledger that doesn't
exist yet in Tally will fail.

Show this table before calling `confirm_write` on anything. **This is the
one required checkpoint in this whole skill.** If a correction is needed,
call `preview_write` again with the fix — the old `previewId` simply goes
unused (each is single-use, valid 15 minutes, and only takes effect if
confirmed).

### 6. Confirm only what's approved, in the right order

Call `confirm_write(previewId)` for each approved new-ledger preview
**first**, then each approved voucher preview — a voucher posted before a
ledger it references exists will fail. Confirm and report each one
individually; one failure doesn't hide inside an overall "done." If a
`confirm_write` fails (e.g. the preview expired — 15 minutes — or a
collision was found), don't retry blindly: re-`preview_write` that one item
fresh and show the user before confirming again.

### 7. Verify

Ask about the Day Book (`get_vouchers`), Trial Balance
(`get_trial_balance`), a party's outstanding balance (`get_bills_receivable`/
`get_bills_payable`), or — depending on step 0's VAT/GST answer —
`get_vat_liability_summary`/`get_gst_liability_summary` for the period, to
confirm the batch landed the way expected.

## What this skill deliberately does not do

- It doesn't guess a party it can't confidently match — a bank line naming
  nobody identifiable in the batch is flagged **unresolved** in the review
  table, never silently posted against a guessed ledger.
- It doesn't post anything without the review step in section 5 — there is
  no fast path that skips straight to `confirm_write`.
- It doesn't invent a new ledger for a name that's a near-miss of an
  existing one — always resolve via `get_ledgers(query: ...)` first.
