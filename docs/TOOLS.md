# Tool Reference

All dates are `DD-MM-YYYY` unless stated otherwise.

## Read tools

| Tool | Args | Returns |
|---|---|---|
| `get_ledgers` | — | All ledgers: name, parent group, closing balance |
| `get_stock_items` | — | All stock items: name, parent group, closing balance |
| `get_groups` | — | All account groups: name, parent |
| `get_voucher_types` | — | All configured voucher types: name, parent |
| `get_cost_centres` | — | All cost centres: name, parent |
| `get_vouchers` | `from`, `to` | Day Book entries in the date range |
| `get_ledger_vouchers` | `ledgerName`, `from`, `to` | Voucher entries posted to one ledger |
| `get_company_info` | — | Currently open company details |
| `get_profit_and_loss` | `from`, `to` | P&L statement |
| `get_balance_sheet` | `asOf` | Balance Sheet as of a date |
| `get_trial_balance` | `from`, `to` | Trial Balance |
| `get_stock_summary` | `asOf` | Stock Summary as of a date |
| `get_bills_receivable` | `asOf` | Outstanding receivables as of a date |
| `get_bills_payable` | `asOf` | Outstanding payables as of a date |

## Write tools

| Tool | Args | Effect |
|---|---|---|
| `create_ledger` | `name`, `oldName?`, `parent`, `openingBalance?`, `maintainBillWise?`, `trn?`, `email?`, `website?`, `phone?`, `mobile?`, `billCreditPeriod?`, `creditLimit?`, `address?`, `state?`, `country?`, `pincode?`, `mailingName?`, `addressApplicableFrom?`, `extraFields?` | Creates a new ledger, or (if `oldName` is passed) alters/renames an existing one. `maintainBillWise` is required for bill-wise `create_voucher` allocation to work. Address fields use Tally's `LEDMAILINGDETAILS.LIST` (a date-versioned list — `addressApplicableFrom` defaults to today if omitted, and is required internally for the address to actually persist; confirmed live). `country`/`state` are plain free text with no validation against a master list — match the company's existing convention rather than a formal name. `extraFields` (object) passes through any other native Tally ledger field by exact XML tag name — not validated. |
| `create_group` | `name`, `oldName?`, `parent` | Creates a new account group, or (if `oldName` is passed) renames/reparents an existing one instead. `parent: "Primary"` maps to an empty `<PARENT>` tag — Tally rejects the literal string "Primary" as a real group name. |
| `create_stock_group` | `name`, `parent` | Creates a new Stock Group (`<STOCKGROUP>` — distinct from `create_group`'s account `<GROUP>`). This is the category `create_stock_item`'s `group` field references; required before filing a stock item under a brand-new category. |
| `create_stock_item` | `name`, `group`, `unit`, `openingBalance?`, `openingRate?`, `description?`, `rateOfVat?`, `ignoreNegativeStock?`, `extraFields?` | Creates a new stock item. Same `"Primary"` handling as `create_group`. `extraFields` is the same escape hatch as on `create_ledger`. |
| `create_unit` | `symbol`, `formalName?`, `decimalPlaces?` (default 0) | Creates a simple Unit of Measure (`<UNIT>`, `ISSIMPLEUNIT=Yes`). Only simple units — not compound units like "Box of 12 Nos". Required before referencing a unit that doesn't exist yet (fails with `Unit does not exist!` otherwise). |
| `create_godown` | `name`, `parent?` | Creates a Godown/Location. Pass the parent's plain name, not a dotted path — `"MAIN LOCATION.DUBAI"` is invalid, `parent: "MAIN LOCATION"` + `name: "DUBAI"` is correct (confirmed live). |
| `create_cost_category` | `name`, `allocateToRevenue?` (default true), `allocateToNonRevenue?` (default true) | Creates a Cost Category (`<COSTCATEGORY>`) — a grouping of cost centres. |
| `create_cost_centre` | `name`, `category?`, `parent?` | Creates a Cost Centre (`<COSTCENTRE>`) for tagging voucher entries via `create_voucher`'s `debitCostCentre`/`creditCostCentre`/`costCentre` fields. `category` defaults to Tally's "Primary Cost Category" if omitted. |
| `create_voucher` | `voucherType`, `date`, `narration?`, `debitLedger`/`creditLedger`/`amount` (2-leg) or `entries?` (N legs), `debitBillName?`, `debitBillType?`, `creditBillName?`, `creditBillType?` | Creates a voucher (Payment, Receipt, Journal, Contra, ...) with 2 or more ledger lines. Pass `entries: [{ledgerName, amount, type: "debit"|"credit", billName?, billType?, costCentre?, costCategory?}]` for 3+ legs (e.g. one payment split across several expense ledgers) — validated client-side to balance before it ever reaches Tally. `debitBillType`/`creditBillType` is `"New Ref"` (open a new bill) or `"Agst Ref"` (settle an existing one by exact bill reference name) — only takes effect if the ledger has `maintainBillWise` enabled. |
| `create_stock_journal` | `date`, `narration?`, `sourceItem`, `sourceQty`, `sourceRate`, `destItem`, `destQty`, `destRate`, `unit`, `godown?`, `voucherNumber?` | Creates a Stock Journal voucher moving inventory from one item to another. Inventory-only (no ledger legs). Uses Tally's real native schema — separate `INVENTORYENTRIESIN.LIST` (destination) / `INVENTORYENTRIESOUT.LIST` (source), not the single-list pattern other voucher types use. |
| `create_sales_invoice` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `godown?`, `batchName?`, `discountPercent?`, `vatLedger?`, `vatRatePercent?`), `vatLedger?`, `vatRatePercent?`, `billName?`, `billType?`, `voucherNumber?` | Creates a real item-invoice Sales voucher — `ALLINVENTORYENTRIES.LIST` per stock item line (each with its own nested `ACCOUNTINGALLOCATIONS.LIST` to a Sales ledger, optional per-line `DISCOUNT` and `BATCHALLOCATIONS.LIST`), plus one `LEDGERENTRIES.LIST` VAT line **per distinct (vatLedger, vatRatePercent) pair** across all items — so a multi-rate invoice gets multiple tax lines, each correctly summed. Reverse-engineered from a real manually-created invoice. **Confirmed live:** if the company has multi-godown tracking enabled, omitting `godown` on an item line fails silently (`CREATED:0`, `EXCEPTIONS:1`, no error text). **Also confirmed live:** some Tally configurations stop auto-numbering item-invoice vouchers via the XML gateway entirely — the real error ("Voucher No. is missing") only surfaces through Tally's own Import Data UI, not the gateway response. If creation fails with a blank `EXCEPTIONS:1`, pass `voucherNumber` explicitly (check `get_vouchers` for the next free number of that type). **Dual-role deletion caveat:** a ledger or stock item used in only a Sales invoice, or only a Purchase invoice, deletes cleanly afterward. Using the **same** master in *both* a Sales and a Purchase item-invoice leaves it permanently returning `Cannot be deleted!` via the API, even at zero balance — not a permanent lock, **Company Data → Rewrite** inside Tally clears it (confirmed live). When deleting a voucher and a master it referenced together, delete the voucher first and confirm success before deleting the master — doing both in one parallel batch can race (confirmed live). |
| `update_sales_invoice` | Same fields as `create_sales_invoice`, plus required `voucherNumber` | Replaces an existing Sales invoice's item lines, party, and narration in place (`ACTION="Alter"`) instead of delete+recreate. Matched by date + voucher number. |
| `create_purchase_invoice` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `purchaseLedger`, `godown?`, `batchName?`, `discountPercent?`, `vatLedger?`, `vatRatePercent?`), `vatLedger?`, `vatRatePercent?`, `billName?`, `billType?`, `voucherNumber?` | Buying-side mirror of `create_sales_invoice` — same shape with the debit/credit convention flipped (inward stock + expense/input-VAT increase = `ISDEEMEDPOSITIVE=Yes` + negative amount; creditor liability increase = `No` + positive amount). Verified live against a real Purchase Accounts + Input VAT ledger, including a live-verified Stock Summary check (buy 100, sell 40 of the same item → closing balance 60, exactly right). Same multi-rate-tax-group, godown, voucherNumber, and dual-role deletion caveats as `create_sales_invoice` apply. |
| `update_purchase_invoice` | Same fields as `create_purchase_invoice`, plus required `voucherNumber` | Replaces an existing Purchase invoice's item lines in place. |
| `create_credit_note` | Same shape as `create_sales_invoice`; `billType` defaults to `"Agst Ref"` (vs. Sales's `"New Ref"`) | Creates a Sales-return Credit Note (`VCHTYPE="Credit Note"`). Sign convention mirrors Purchase's (structurally a reverse Sales entry). **Extrapolated** from that proven convention, not reverse-engineered from a real manually-created example — verify live after use. Same godown/dual-role caveats apply. |
| `update_credit_note` | Same fields as `create_credit_note`, plus required `voucherNumber` | Replaces an existing Credit Note's item lines in place. |
| `create_debit_note` | Same shape as `create_purchase_invoice`; `billType` defaults to `"Agst Ref"` | Creates a Purchase-return Debit Note (`VCHTYPE="Debit Note"`). Sign convention mirrors Sales's (structurally a reverse Purchase entry). Same extrapolated-convention caveat as `create_credit_note`. |
| `update_debit_note` | Same fields as `create_debit_note`, plus required `voucherNumber` | Replaces an existing Debit Note's item lines in place. |
| `create_physical_stock` | `date`, `narration?`, `items` (`stockItem`, `actualQty`, `unit`, `godown?`, `batchName?`), `voucherNumber?` | Creates a Physical Stock voucher (`VCHTYPE="Physical Stock"`, `ISPHYSICALQTYENTERED=Yes`) recording a counted quantity per item, so Tally's stock reports show the shortage/excess variance against book stock. Inventory-only, zero value — does not post any accounting write-off for the variance itself (use `create_voucher`/`create_stock_journal` separately for that). **Extrapolated** from Tally's documented schema — verify live after use. |
| `update_physical_stock` | Same fields as `create_physical_stock`, plus required `voucherNumber` | Replaces an existing Physical Stock voucher's counted lines in place. |
| `update_voucher` | `voucherType`, `voucherNumber`, `date`, `narration?`, `debitLedger`/`creditLedger`/`amount` **or** `entries?` (3+ legs, same shape as `create_voucher`) | Replaces the ledger entries/narration of an existing voucher. **Matched by type + date + voucher number** — that combination must uniquely identify the voucher (confirm with `get_ledger_vouchers` first). |
| `update_stock_journal` | Same fields as `create_stock_journal`, plus required `voucherNumber` | Replaces an existing Stock Journal's source/destination lines in place. |
| `update_stock_item` | `name`, `group?`, `unit?`, `description?`, `rateOfVat?`, `ignoreNegativeStock?`, `extraFields?` | Updates any subset of an existing stock item's fields — genuinely partial, same field coverage as `create_stock_item`, all optional except `name`. |
| `delete_stock_item` | `name` | Deletes a stock item (fails if it has transactions posted against it). |
| `delete_voucher` | `voucherType`, `voucherNumber`, `date` | Permanently deletes a voucher (true delete, no trace — distinct from Cancel). Matched the same way as `update_voucher`. |
| `delete_master` | `collection`, `names` | Deletes one or more masters of any collection type (`LEDGER`, `GROUP`, `STOCKGROUP`, `STOCKITEM`, `VOUCHERTYPE`, `UNIT`, `GODOWN`, `COSTCATEGORY`, `COSTCENTRE`, ...) by exact name. |

### Voucher type collision (confirmed live) — affects every `update_*`/`delete_voucher` tool

Tally's Alter/Delete lookup (`TAGNAME="Voucher Number"`/`TAGVALUE`) matches by
**date + voucher number only** — the `VCHTYPE` attribute you pass is **not**
used to scope the match, even though each voucher type numbers independently
(so a Sales #4 and a Purchase #4 can both legitimately exist on the same
date). Confirmed live: altering "Purchase #4" instead silently hit an
unrelated pre-existing "Sales #4" on the same date, converted it to Purchase,
and auto-renumbered it — corrupting a real voucher with no error.

Every `update_*` tool and `delete_voucher` now calls an internal
`assertVoucherUnambiguous(voucherType, voucherNumber, date)` check first
(queries a lightweight `Voucher` collection for that date, filters to the
requested number) and **throws before sending anything to Tally** if more
than one voucher type shares that number on that date, or if the requested
type doesn't match what actually exists. There is no safe way to force the
operation through the API when a real collision exists — resolve it in
Tally (renumber one of the colliding vouchers) or edit/delete the voucher
directly in Tally's UI instead.

## Context switching tools

| Tool | Args | Effect |
|---|---|---|
| `set_company` | `companyName` | Switches Tally's active company — persistent, global state, affects every subsequent call. Only works if that company is already open in Tally; silently no-ops otherwise. |
| `set_period` | `from`, `to` | Switches Tally's active reporting period — same persistent-state caveat as `set_company`. |

## SQL cache tools

| Tool | Args | Effect |
|---|---|---|
| `sync_to_sql` | — | Loads ledgers/groups/stock items into an in-memory SQL cache (PGLite) |
| `query_sql` | `sql` | Runs a read-only `SELECT` against that cache |

See [SQL_CACHE.md](./SQL_CACHE.md) for schema and examples.

Write tools return a plain-text summary: `Success. Created: N. ...` or
`Failed. Tally reported N error(s). ...` — always check the response text
before assuming a write succeeded, since Tally reports errors inside the XML
body rather than via HTTP status.

## Adding a new tool

1. Add an entry to the `tools` array in [`src/tools.ts`](../src/tools.ts)
   with a `name`, `description`, and JSON Schema `inputSchema`.
2. If the request needs new XML shape, add a `.xml.njk` file to
   [`templates/`](../templates/) and render it with `render(name, context)`
   from `src/templates.ts` (see the existing `report.xml.njk` /
   `create-ledger.xml.njk` for the two shapes: Export Data vs Import Data).
3. Add a case to the `switch` in `handleTool` in `src/tools.ts` that builds
   the XML and calls `tallyRequest`.
4. Run `npm run build` to type-check.
5. If it's a report you haven't used before, confirm the exact `REPORTNAME`
   string by checking what Tally calls it on-screen — see
   [TALLY_XML_GUIDE.md](./TALLY_XML_GUIDE.md).
