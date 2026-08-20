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
| `create_group` | `name`, `parent` | Creates a new account group. `parent: "Primary"` maps to an empty `<PARENT>` tag — Tally rejects the literal string "Primary" as a real group name. |
| `create_stock_item` | `name`, `group`, `unit`, `openingBalance?`, `openingRate?`, `description?`, `rateOfVat?`, `ignoreNegativeStock?`, `extraFields?` | Creates a new stock item. Same `"Primary"` handling as `create_group`. `extraFields` is the same escape hatch as on `create_ledger`. |
| `create_voucher` | `voucherType`, `date`, `narration?`, `debitLedger`/`creditLedger`/`amount` (2-leg) or `entries?` (N legs), `debitBillName?`, `debitBillType?`, `creditBillName?`, `creditBillType?` | Creates a voucher (Payment, Receipt, Sales, Purchase, Journal, ...) with 2 or more ledger lines. Pass `entries: [{ledgerName, amount, type: "debit"|"credit", billName?, billType?, costCentre?, costCategory?}]` for 3+ legs (e.g. one payment split across several expense ledgers) — validated client-side to balance before it ever reaches Tally. `debitBillType`/`creditBillType` is `"New Ref"` (open a new bill) or `"Agst Ref"` (settle an existing one by exact bill reference name) — only takes effect if the ledger has `maintainBillWise` enabled. |
| `create_stock_journal` | `date`, `narration?`, `sourceItem`, `sourceQty`, `sourceRate`, `destItem`, `destQty`, `destRate`, `unit`, `godown?` | Creates a Stock Journal voucher moving inventory from one item to another. Inventory-only (no ledger legs). Uses Tally's real native schema — separate `INVENTORYENTRIESIN.LIST` (destination) / `INVENTORYENTRIESOUT.LIST` (source), not the single-list pattern other voucher types use. |
| `create_sales_invoice` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `godown?`), `vatLedger?`, `vatRatePercent?`, `billName?`, `billType?` | Creates a real item-invoice Sales voucher — `ALLINVENTORYENTRIES.LIST` per stock item line (each with its own nested `ACCOUNTINGALLOCATIONS.LIST` to a Sales ledger), plus `LEDGERENTRIES.LIST` for the party and an optional VAT line on the total. Reverse-engineered from a real manually-created invoice. **Confirmed live:** if the company has multi-godown tracking enabled, omitting `godown` on an item line fails silently (`CREATED:0`, `EXCEPTIONS:1`, no error text) even though the request is otherwise valid — same silent-failure shape as the old Stock Journal issue. **Also confirmed live (A/B tested):** the deletion issue is specifically about *dual-role* usage — a ledger or stock item used in only a Sales invoice, or only a Purchase invoice, deletes cleanly afterward once its voucher is removed. It's specifically using the **same** master in *both* a Sales and a Purchase item-invoice that leaves it permanently returning `Cannot be deleted!` via the API, even at zero balance. When that happens, it is **not a permanent lock** — running **Company Data → Rewrite** inside Tally itself clears it (confirmed live: two masters stuck this way were both deletable again immediately after a Rewrite). When deleting a voucher and a master it referenced together, delete the voucher first and confirm success before deleting the master — doing both in one parallel batch can race (confirmed live). |
| `create_purchase_invoice` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `purchaseLedger`, `godown?`), `vatLedger?`, `vatRatePercent?`, `billName?`, `billType?` | Buying-side mirror of `create_sales_invoice` — same `ALLINVENTORYENTRIES.LIST`/`LEDGERENTRIES.LIST` shape with the debit/credit convention flipped (inward stock + expense/input-VAT increase = `ISDEEMEDPOSITIVE=Yes` + negative amount; creditor liability increase = `No` + positive amount). Verified live against a real Purchase Accounts + Input VAT ledger, including a live-verified Stock Summary check (buy 100, sell 40 of the same item → closing balance 60, exactly right) — buying and selling the same stock item is normal, correct usage. Same godown and dual-role deletion caveats as `create_sales_invoice` apply. |
| `update_voucher` | `voucherType`, `voucherNumber`, `date`, `narration?`, `debitLedger`, `creditLedger`, `amount` | Replaces the ledger entries/narration of an existing voucher. **Matched by type + date + voucher number** — that combination must uniquely identify the voucher (confirm with `get_ledger_vouchers` first). |
| `update_stock_item` | `name`, `group?`, `unit?` | Updates an existing stock item's group and/or unit — genuinely partial: omitting one leaves it unchanged. |
| `delete_stock_item` | `name` | Deletes a stock item (fails if it has transactions posted against it). |
| `delete_voucher` | `voucherType`, `voucherNumber`, `date` | Permanently deletes a voucher (true delete, no trace — distinct from Cancel). Matched the same way as `update_voucher`. |
| `delete_master` | `collection`, `names` | Deletes one or more masters of any collection type (`LEDGER`, `GROUP`, `STOCKITEM`, `VOUCHERTYPE`, `UNIT`, `GODOWN`, `COSTCATEGORY`, `COSTCENTRE`, ...) by exact name. |

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
