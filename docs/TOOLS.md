# Tool Reference

All dates are `DD-MM-YYYY` unless stated otherwise.

## Read tools

| Tool | Args | Returns |
|---|---|---|
| `get_ledgers` | `query?` | All ledgers (name, parent group, closing balance, VAT TRN), or — with `query` — a fuzzy-ranked shortlist of the closest-matching names (exact/prefix/substring, then a loose in-order character match for typos/abbreviations), capped to the top 20, best match first |
| `get_stock_items` | — | All stock items: name, parent group, closing balance |
| `get_groups` | — | All account groups: name, parent |
| `get_voucher_types` | — | All configured voucher types: name, parent |
| `get_cost_centres` | — | All cost centres: name, parent |
| `get_vouchers` | `from`, `to` | Day Book entries in the date range — a flat array of header rows (guid, date, voucher_type, voucher_number, party_ledger, amount, narration), no line detail. Rebuilt on the same Voucher collection query `sync_vouchers_to_sql` uses. An earlier version called Tally's canned "Day Book" report directly and was confirmed live to silently ignore the date range entirely — returning the identical fixed set of vouchers regardless of the requested range, even for a year before the company's books start. Fixed by switching to the collection-based query, which does respect the range |
| `get_ledger_vouchers` | `ledgerName`, `from`, `to` | Voucher entries posted to one ledger |
| `get_company_info` | — | Currently open company details |
| `get_profit_and_loss` | `from`, `to` | P&L statement |
| `get_balance_sheet` | `asOf` | Balance Sheet as of a date |
| `get_trial_balance` | `from`, `to` | Trial Balance |
| `get_stock_summary` | `asOf` | Stock Summary as of a date |
| `get_bills_receivable` | `asOf` | Outstanding receivables as of a date |
| `get_bills_payable` | `asOf` | Outstanding payables as of a date |
| `get_cash_flow` | `from`, `to` | Cash Flow statement — Tally's own canned report, reachable directly via a plain Export Data request (unlike VAT/GST returns or Stock Summary, which need reconstruction). Returns Tally's native `DSPPERIOD`/`DSPACCINFO` monthly-breakdown shape as-is |
| `get_funds_flow` | `from`, `to` | Funds Flow statement — same design as `get_cash_flow` |
| `get_ratio_analysis` | `from`, `to` | Standard ratios (Working Capital, Current/Quick Ratio, Inventory/Debtors/Creditors Turnover, etc.) — Tally's own canned report, native `RATIONAME`/value array shape |
| `get_sales_register` | `from`, `to` | Month-by-month Sales voucher summary — Tally's own canned report. For individual voucher-level detail, use `get_vouchers`/`get_ledger_vouchers` instead |
| `get_purchase_register` | `from`, `to` | Month-by-month Purchase voucher summary — same design as `get_sales_register` |
| `get_journal_register` | `from`, `to` | Month-by-month Journal voucher summary — same design as `get_sales_register` |
| `get_payment_register` | `from`, `to` | Month-by-month Payment voucher summary — same design as `get_sales_register`. Tally has no separate standalone "Receipt Register" reachable this way (confirmed live: `Could not find Report`) |
| `get_receipts_and_payments` | `from`, `to` | Combined cash/bank Receipts and Payments view — Tally's own canned report, and the closest reachable equivalent to Cash Book/Bank Book: those two are registered report names in Tally but not reachable via a plain Export Data request (confirmed live: `Could not find Report 'Cash Book'`/`'Bank Book'`) even though "Cash Books"/"Bank Books" show up in Tally's own Report collection listing. For one specific cash or bank ledger's own transaction history, use `get_ledger_vouchers` instead |
| `get_reorder_status` | `from`, `to` | Stock items with a reorder level configured, and how their quantity stands against it (`closingStock`, `onPurchaseOrder`, `onSaleOrder`, `reorderLevel`, `shortfall`, `minimumQty`, `requiredQty`). Tally's own report returns every stock item regardless of reorder setup — confirmed live on a 10,770-item company with no reorder levels configured at all, which returned a ~1.4MB all-null dump. This tool filters that down client-side to only rows where a reorder level is actually set; an empty `rows` array with a note means none are configured, not an error |
| `get_vat_liability_summary` | `from`, `to` | UAE VAT liability for a period. Hybrid classification, not one signal alone — confirmed live on two real companies that Tally's own `TAXTYPE` ledger field is precise but has near-zero recall (every properly-tagged ledger had a zero balance; the ledgers actually carrying real money had no tag set at all). Includes a ledger if EITHER `TAXTYPE = "VAT"` OR its name matches Input/Output/Payable/Receivable VAT patterns, tagged `matchMethod: "structural"`/`"name_pattern"` per row, and `category: "input"`/`"output"`/`"rcm"`/`"other"` — reverse-charge ledgers get their own `"rcm"` category rather than being folded into input/output, since RCM liability is what's easily missed manually even though it nets to a wash for most businesses. Not filtered by parent group — real companies scatter these across many groups, not one standard "Duties & Taxes" group as official docs describe. `netTotal` sums all rows using Tally's own debit/credit sign convention. Not Tally's canned "Vat Return and Annexures" report — confirmed live that report isn't reachable via a plain Export Data request even with its exact name from Tally's own Report collection listing. |
| `get_gst_liability_summary` | `from`, `to` | India GST liability for a period. Same hybrid design as `get_vat_liability_summary` (`TAXTYPE = "GST"` OR name pattern for CGST/SGST/IGST input/output/payable/receivable/RCM), same reasoning (Tally's structural tag alone misses every real-activity ledger in a real company file, confirmed live), same `"rcm"` category kept separate from input/output. Deliberately excludes generic expense ledgers that merely mention GST in their name (a freight ledger, a "GST Expenses"/"GST Ineligible" write-off ledger) — those distorted the result when tested against real data and are excluded on purpose. |
| `get_audit_log` | `limit?` (default 50), `toolFilter?`, `writesOnly?`, `fromDate?`/`toDate?` (DD-MM-YYYY), `company?`, `format?` (`'json'`/`'summary'`) | Reads entries from the local append-only audit log (`audit.ts`) — every tool call through this server, read or write, with timestamp/args/outcome/company tag. `company` filters to entries tagged with that exact Tally company name. `format: 'summary'` returns a compact table + outcome counts instead of raw JSON, for handing to a reviewer. Entries older than 90 days are hard-deleted — see "Audit trail & permission scoping" below. |
| `get_health_check` | — | Attempts a real Company collection query and inspects the *shape* of the response, not just whether the HTTP call succeeded — a wrong port can still return `200 OK` from an entirely different service (Tally's own license server on port 9999 answers with an HTML status page) which would otherwise look like a working gateway. Reports `tallyUrl`, `gatewayReachable`, `companyOpen`, `connectionError`, `readOnlyMode`, `disabledTools`, `auditLogPath`. Always allowed regardless of read-only mode (it's in `READ_ONLY_TOOLS`). |
| `preview_write` | `toolName`, `args` | Builds the exact XML any write tool (`create_*`/`update_*`/`delete_*`/`set_bill_of_materials`) would send, without sending it — nothing touches Tally. Reuses that tool's own arg parsing and pre-checks (e.g. `assertVoucherUnambiguous` for `update_*`/`delete_voucher`), so the preview already reflects any refusal. Returns `{previewId, toolName, description, xml}` and stores the entry in-memory for 15 minutes. In `READ_ONLY_TOOLS` — a `create_*` preview makes no gateway call at all, and an `update_*`/`delete_*` preview only makes the same read-only collision-check query that tool would normally make, so it works even when writes are blocked. |

## Write tools

Every `create_*`/`update_*`/`delete_*` tool below re-reads what it just wrote
straight back from Tally and appends the result as a `Verified in Tally: ...`
line — not just whether Tally accepted the request, but the actual field
values (or, for a delete, confirmation the record is really gone) as Tally
now has them. Ledger/stock item/master writes are checked field-for-field
against what was sent; voucher writes are checked ledger-leg-by-leg
(amount, cost centre, bill reference) and item-line-by-item-line (qty, rate,
amount). A `create_*` call with no `voucherNumber` (Tally auto-numbers it)
skips voucher verification and says so — there's no reliable key to look the
voucher back up by without one.

| Tool | Args | Effect |
|---|---|---|
| `confirm_write` | `previewId` | Sends a previously-built `preview_write` result to Tally, verbatim. The only tool that actually posts when a change went through preview first. Single-use — an already-confirmed or expired (15 min) `previewId` throws rather than reposting or silently reusing stale XML. |
| `create_ledger` | `name`, `oldName?`, `parent`, `openingBalance?`, `maintainBillWise?`, `trn?`, `email?`, `website?`, `phone?`, `mobile?`, `billCreditPeriod?`, `creditLimit?`, `address?`, `state?`, `country?`, `pincode?`, `mailingName?`, `addressApplicableFrom?`, `extraFields?` | Creates a new ledger, or (if `oldName` is passed) alters/renames an existing one. `maintainBillWise` is required for bill-wise `create_voucher` allocation to work. Address fields use Tally's `LEDMAILINGDETAILS.LIST` (a date-versioned list — `addressApplicableFrom` defaults to today if omitted, and is required internally for the address to actually persist). `country`/`state` are plain free text with no validation against a master list — match the company's existing convention rather than a formal name. `extraFields` (object) passes through any other native Tally ledger field by exact XML tag name — not validated. |
| `create_group` | `name`, `oldName?`, `parent` | Creates a new account group, or (if `oldName` is passed) renames/reparents an existing one instead. `parent: "Primary"` maps to an empty `<PARENT>` tag — Tally rejects the literal string "Primary" as a real group name. |
| `create_stock_group` | `name`, `parent` | Creates a new Stock Group (`<STOCKGROUP>` — distinct from `create_group`'s account `<GROUP>`). This is the category `create_stock_item`'s `group` field references; required before filing a stock item under a brand-new category. |
| `create_stock_item` | `name`, `group`, `unit`, `openingBalance?`, `openingRate?`, `description?`, `rateOfVat?`, `ignoreNegativeStock?`, `extraFields?` | Creates a new stock item. Same `"Primary"` handling as `create_group`. `extraFields` is the same escape hatch as on `create_ledger`. |
| `create_unit` | `symbol`, `formalName?`, `decimalPlaces?` (default 0) **or** `baseUnit`+`additionalUnit`+`conversion` | Creates a Unit of Measure. Default is simple (`<UNIT>`, `ISSIMPLEUNIT=Yes`). Passing `baseUnit` switches to a compound unit (e.g. "Box of 12 Nos" — `ISSIMPLEUNIT=No`, `<BASEUNITS>`, `<ADDITIONALUNITS>`, `<CONVERSION>`) — a real Tally-exported XML shape, but both simple units referenced must already exist first. Required before referencing a unit that doesn't exist yet (fails with `Unit does not exist!` otherwise). **Verified:** a simple unit's symbol (and `baseUnit`/`additionalUnit`, which reference existing simple units' symbols) cannot contain whitespace — Tally rejects it with `Master name contains invalid characters`; this tool now checks client-side and throws before sending anything. A compound unit's own display name is unaffected and can contain spaces. |
| `create_godown` | `name`, `parent?` | Creates a Godown/Location. Pass the parent's plain name, not a dotted path — `"MAIN LOCATION.DUBAI"` is invalid, `parent: "MAIN LOCATION"` + `name: "DUBAI"` is correct. |
| `create_cost_category` | `name`, `allocateToRevenue?` (default true), `allocateToNonRevenue?` (default true) | Creates a Cost Category (`<COSTCATEGORY>`) — a grouping of cost centres. |
| `create_cost_centre` | `name`, `category?`, `parent?` | Creates a Cost Centre (`<COSTCENTRE>`) for tagging voucher entries via `create_voucher`'s `debitCostCentre`/`creditCostCentre`/`costCentre` fields. `category` defaults to Tally's "Primary Cost Category" if omitted. |
| `set_bill_of_materials` | `stockItem`, `componentListName?` (default `"Primary"`), `basicQty?` (default 1), `unit?`, `components` (array of `stockItem`, `qty`, `unit`, `natureOfItem?`, `godown?`) | Attaches a Bill of Materials to an existing finished-goods `<STOCKITEM>` via `ACTION="Alter"` + a `<MULTICOMPONENTLIST.LIST>` (with `COMPONENTLISTNAME`, `COMPONENTBASICQTY`, and nested `MULTICOMPONENTITEMLIST.LIST` per component — `STOCKITEMNAME`, `ACTUALQTY`, `NATUREOFITEM`, `GODOWNNAME`). Pure convenience layer — doesn't move stock or post anything by itself; `create_stock_journal` still records the actual production. Verified live: attaches without error and causes no stock movement on the finished item or its components. `natureOfItem`'s four values (`Component`/`Co-Product`/`By-Product`/`Scrap`) were each checked against Tally's own BoM screen — all map to the matching "Type of Item" label there. **Note:** Tally's "Set Components List (Bill of Materials)" feature must be enabled for the company (Alter Stock Item screen → F12 → "Set Components List (Bill of Materials) in Stock Items" → Yes) before the Components field is visible at all — the write itself succeeds either way, but without this on, nothing shows it in Tally's UI. |
| `create_voucher_type` | `name`, `oldName?`, `parent`, `numberingMethod?`, `abbreviation?`, `preventDuplicates?`, `useAsManufacturingJournal?`, `extraFields?` | Creates a custom `<VOUCHERTYPE>` derived from a base type (e.g. `parent: "Payment"` for a new "Bank Payment" type, or `parent: "Stock Journal"` + `useAsManufacturingJournal: true` for a real Manufacturing Journal type — sets `<ASMFGJRNL>Yes</ASMFGJRNL>`) — or renames/reconfigures an existing one if `oldName` is passed. `parent` must be an exact existing voucher type name (check `get_voucher_types`). Verified: create, use in a real voucher end-to-end, rename via `oldName`, delete via `delete_master`. **Also verified:** a new custom type created without `numberingMethod` set can accept vouchers with a completely blank voucher number (not even `"1"`) — pass `numberingMethod: "Automatic"` explicitly, or you can only reference the resulting vouchers by date + empty-string voucher number. |
| `create_voucher` | `voucherType`, `date`, `narration?`, `debitLedger`/`creditLedger`/`amount` (2-leg) or `entries?` (N legs), `debitBillName?`, `debitBillType?`, `creditBillName?`, `creditBillType?` | Creates a voucher (Payment, Receipt, Journal, Contra, ...) with 2 or more ledger lines. Pass `entries: [{ledgerName, amount, type: "debit"|"credit", billName?, billType?, costCentre?, costCategory?}]` for 3+ legs (e.g. one payment split across several expense ledgers) — validated client-side to balance before it ever reaches Tally. `debitBillType`/`creditBillType` is `"New Ref"` (open a new bill) or `"Agst Ref"` (settle an existing one by exact bill reference name) — only takes effect if the ledger has `maintainBillWise` enabled. |
| `create_stock_journal` | `date`, `narration?`, `sources` (array of `stockItem`, `qty`, `rate`, `unit`, `godown?`, `batchName?`), `destinations` (same shape), `additionalCosts?` (array of `ledgerName`, `amount`, `allocationType?`), `voucherType?` (default `"Stock Journal"`), `voucherNumber?` | Creates a Stock Journal (or Manufacturing Journal, via `voucherType`) voucher moving inventory from one or more source items to one or more destination items in a single voucher (multi-raw-material-in, multi-finished/by-product-out). Uses Tally's real native schema — separate `INVENTORYENTRIESIN.LIST` (destinations) / `INVENTORYENTRIESOUT.LIST` (sources), each looped, not the single-list pattern other voucher types use. `additionalCosts` emits a voucher-level `LEDGERENTRIES.LIST` with `ADDLALLOCTYPE`/`LEDGERNAME`/`AMOUNT` — verified (cross-checked against a real manually-created voucher's exported JSON) to be a costing/valuation instruction only, **not** a real posting against that ledger; its balance doesn't change. Verified end-to-end for multi-source/multi-destination on a real company. |
| `create_sales_invoice` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `godown?`, `batchName?`, `discountPercent?`, `vatLedger?`, `vatRatePercent?`), `vatLedger?`, `vatRatePercent?`, `billName?`, `billType?`, `voucherNumber?` | Creates a real item-invoice Sales voucher — `ALLINVENTORYENTRIES.LIST` per stock item line (each with its own nested `ACCOUNTINGALLOCATIONS.LIST` to a Sales ledger, optional per-line `DISCOUNT` and `BATCHALLOCATIONS.LIST`), plus one `LEDGERENTRIES.LIST` VAT line **per distinct (vatLedger, vatRatePercent) pair** across all items — so a multi-rate invoice gets multiple tax lines, each summed separately. Reverse-engineered from a real manually-created invoice. **Verified:** if the company has multi-godown tracking enabled, omitting `godown` on an item line fails silently (`CREATED:0`, `EXCEPTIONS:1`, no error text). **Also verified:** some Tally configurations stop auto-numbering item-invoice vouchers via the XML gateway entirely — the real error ("Voucher No. is missing") only surfaces through Tally's own Import Data UI, not the gateway response. If creation fails with a blank `EXCEPTIONS:1`, pass `voucherNumber` explicitly (check `get_vouchers` for the next free number of that type). **Dual-role deletion caveat:** a ledger or stock item used in only a Sales invoice, or only a Purchase invoice, deletes cleanly afterward. Using the **same** master in *both* a Sales and a Purchase item-invoice leaves it permanently returning `Cannot be deleted!` via the API, even at zero balance — not a permanent lock, **Company Data → Rewrite** inside Tally clears it. When deleting a voucher and a master it referenced together, delete the voucher first and confirm success before deleting the master — doing both in one parallel batch can race. |
| `update_sales_invoice` | Same fields as `create_sales_invoice`, plus required `voucherNumber` | Replaces an existing Sales invoice's item lines, party, and narration in place (`ACTION="Alter"`) instead of delete+recreate. Matched by date + voucher number. |
| `create_purchase_invoice` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `purchaseLedger`, `godown?`, `batchName?`, `discountPercent?`, `vatLedger?`, `vatRatePercent?`), `vatLedger?`, `vatRatePercent?`, `billName?`, `billType?`, `voucherNumber?` | Buying-side mirror of `create_sales_invoice` — same shape with the debit/credit convention flipped (inward stock + expense/input-VAT increase = `ISDEEMEDPOSITIVE=Yes` + negative amount; creditor liability increase = `No` + positive amount). Verified against a real Purchase Accounts + Input VAT ledger, including a verified Stock Summary check (buy 100, sell 40 of the same item → closing balance 60, exactly right). Same multi-rate-tax-group, godown, voucherNumber, and dual-role deletion caveats as `create_sales_invoice` apply. |
| `update_purchase_invoice` | Same fields as `create_purchase_invoice`, plus required `voucherNumber` | Replaces an existing Purchase invoice's item lines in place. |
| `create_credit_note` | Same shape as `create_sales_invoice`; `billType` defaults to `"Agst Ref"` (vs. Sales's `"New Ref"`) | Creates a Sales-return Credit Note (`VCHTYPE="Credit Note"`). Sign convention mirrors Purchase's (structurally a reverse Sales entry). **Verified:** returning 5 units of a real stock item increased its book quantity by 5. Same godown/dual-role caveats as `create_sales_invoice` apply. |
| `update_credit_note` | Same fields as `create_credit_note`, plus required `voucherNumber` | Replaces an existing Credit Note's item lines in place. |
| `create_debit_note` | Same shape as `create_purchase_invoice`; `billType` defaults to `"Agst Ref"` | Creates a Purchase-return Debit Note (`VCHTYPE="Debit Note"`). Sign convention mirrors Sales's (structurally a reverse Purchase entry). **Verified:** returning 3 units decreased book quantity by 3. Same godown/dual-role caveats as `create_purchase_invoice` apply. |
| `update_debit_note` | Same fields as `create_debit_note`, plus required `voucherNumber` | Replaces an existing Debit Note's item lines in place. |
| `create_delivery_note` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `godown?`, `batchName?`, `discountPercent?`), `voucherNumber?` | Creates a Delivery Note (`VCHTYPE="Delivery Note"`, `OBJVIEW="Invoice Voucher View"`, `ISINVOICE=No`) — item-line dispatch of goods before/without a full Sales invoice. **Confirmed live:** the voucher type must be active in the company (a company-level toggle, same as `set_bill_of_materials`'s prerequisite) or the API reports `CREATED:1` for a voucher that shows in no report and isn't findable by `get_vouchers`/`delete_voucher`. Once active, both find it correctly — `get_ledger_vouchers` will still never show it, by design (it deliberately excludes inventory-classified vouchers). Requires `godown` if the company has multi-godown tracking (same silent-fail behavior as `create_sales_invoice`). **Also confirmed live:** can silently stop auto-numbering (blank `EXCEPTIONS:1`, real cause "Voucher No. is missing" only visible in Tally's own Import Data UI) — pass `voucherNumber` explicitly if this happens, same fix as the item-invoice types below. |
| `update_delivery_note` | Same fields as `create_delivery_note`, plus required `voucherNumber` | Replaces an existing Delivery Note's item lines in place. Same voucher-type-active and auto-numbering caveats. Matched by date + voucher number; refuses on a cross-type collision, same as every other `update_*` tool. **Confirmed live.** |
| `create_receipt_note` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `purchaseLedger`, `godown?`, `batchName?`, `discountPercent?`), `voucherNumber?` | Creates a Receipt Note (`VCHTYPE="Receipt Note"`) — the buying-side mirror of `create_delivery_note`, same voucher-type-active caveat. |
| `update_receipt_note` | Same fields as `create_receipt_note`, plus required `voucherNumber` | Replaces an existing Receipt Note's item lines in place. **Confirmed live.** |
| `create_sales_order` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `dueDate`, `godown?`, `batchName?`, `discountPercent?`), `orderNumber`, `voucherNumber?` | Creates a Sales Order (`VCHTYPE="Sales Order"`) — a future commitment to sell, no stock/ledger movement. **Confirmed live via a real manually-created Sales Order's own export:** the UI's "Order no." field is the voucher-level `REFERENCE` tag, independent of the voucher number; each item's Order No./Due Date live nested inside that item's `BATCHALLOCATIONS.LIST` (not direct `ALLINVENTORYENTRIES` fields as their names suggest) — omitting either fails with "Order No. is missing in Item Allocations"/"Due Date of Order is missing in Item Allocations" respectively. Tally silently reassigns its own voucher number for this voucher class ("Auto Retain" numbering) regardless of an explicit `voucherNumber` — check the real number via `get_vouchers` afterward. Same voucher-type-active prerequisite as `create_delivery_note`. |
| `update_sales_order` | Same fields as `create_sales_order`, plus required `voucherNumber` (the existing voucher's number to match by) | Replaces an existing Sales Order's item lines, party, and order number in place. **Confirmed live.** |
| `create_purchase_order` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `purchaseLedger`, `dueDate`, `godown?`, `batchName?`, `discountPercent?`), `orderNumber`, `voucherNumber?` | Creates a Purchase Order (`VCHTYPE="Purchase Order"`) — buying-side mirror of `create_sales_order`, same confirmed caveats. |
| `update_purchase_order` | Same fields as `create_purchase_order`, plus required `voucherNumber` | Replaces an existing Purchase Order's item lines, party, and order number in place. **Confirmed live.** |
| `create_sales_quotation` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `dueDate`, `godown?`, `batchName?`, `discountPercent?`), `orderNumber`, `voucherNumber?` | Creates a Sales Quotation (`VCHTYPE="Sales Quotation"`) — a pre-order price quote to a prospective customer, one step before `create_sales_order`. **Confirmed live:** Tally classifies this as an Order-class voucher (`PARENT` is `"Sales Order"` in `get_voucher_types`) and requires the same `orderNumber` (`REFERENCE`)/per-item `dueDate` as `create_sales_order` — omitting them fails silently (`EXCEPTIONS:1`, no error text in the raw response). Same voucher-type-active prerequisite as `create_delivery_note`. |
| `update_sales_quotation` | Same fields as `create_sales_quotation`, plus required `voucherNumber` | Replaces an existing Sales Quotation's item lines, party, and order number in place. **Confirmed live.** |
| `create_job_work_in_order` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `dueDate`, `godown?`, `batchName?`, `components`: array of `stockItem`, `qty`, `rate`, `unit`, `godown?`, `batchName?`), `orderNumber`, `voucherNumber?` | Creates a Job Work In Order (`VCHTYPE="Job Work In Order"`) — this company is the job worker, booking an order to process raw materials a customer will supply into a finished item delivered back. **Confirmed live via a real manually-created Job Work In Order's own export:** each item's component list lives nested two levels deep — `VOUCHERCOMPONENTLIST.LIST` inside `BATCHALLOCATIONS.LIST` inside `ALLINVENTORYENTRIES.LIST` — each component carrying its own `BATCHALLOCATIONS.LIST` with a `PARENTITEM` back-reference. No VAT/tax lines, no per-item ledger allocation — just one balancing party ledger entry for the total. Same voucher-type-active prerequisite and required `orderNumber`/`dueDate` as `create_sales_order`. |
| `update_job_work_in_order` | Same fields as `create_job_work_in_order`, plus required `voucherNumber` | Replaces an existing Job Work In Order's item lines (and their component lists), party, and order number in place. **Confirmed live.** |
| `create_job_work_out_order` | Same shape as `create_job_work_in_order` | Creates a Job Work Out Order (`VCHTYPE="Job Work Out Order"`) — mirror image: this company is the principal, sending raw materials (each item's `components`) out to a job worker and expecting a finished item back. Same nested structure as `create_job_work_in_order` with the accounting direction flipped (matching this connector's existing Sales-side vs Purchase-side sign convention). **Confirmed live:** creates cleanly with no exceptions. |
| `update_job_work_out_order` | Same fields as `create_job_work_out_order`, plus required `voucherNumber` | Replaces an existing Job Work Out Order's item lines (and their component lists), party, and order number in place. **Confirmed live.** |
| `create_material_in` | `date`, `narration?`, `partyLedger`, `items` (`stockItem`, `qty`, `rate`, `unit`, `godown?`, `batchName?`), `voucherNumber?` | Creates a Material In voucher (`VCHTYPE="Material In"`, `PERSISTEDVIEW="Multi Consumption Voucher View"`) — stock received back from a job worker, tracked via a `LEDGERENTRIES.LIST` party leg that does **not** balance against the inventory legs (both share the same sign — based on a real Tally-exported template for this exact shape; this is job-work memorandum tracking, not a real Dr/Cr pair). Verified live: stock quantity increases and the party ledger's balance stays unchanged. |
| `update_material_in` | Same fields as `create_material_in`, plus required `voucherNumber` | Replaces an existing Material In voucher's item lines in place. **Confirmed live.** |
| `create_material_out` | Same shape as `create_material_in` | Mirror of `create_material_in` (`VCHTYPE="Material Out"`, `INVENTORYENTRIESOUT.LIST`) — stock sent out to a job worker. Same verified-live behavior. |
| `update_material_out` | Same fields as `create_material_out`, plus required `voucherNumber` | Replaces an existing Material Out voucher's item lines in place. **Confirmed live.** |
| `create_rejections_in` | `date`, `narration?`, `items` (`stockItem`, `qty`, `rate`, `unit`, `godown?`, `batchName?`), `voucherNumber?` | Creates a Rejections In voucher (`VCHTYPE="Rejections In"`, `ALLINVENTORYENTRIES.LIST`, `ISDEEMEDPOSITIVE=Yes`) — goods rejected and returned to you, inventory-only, no ledger. Verified live: stock quantity increases. |
| `update_rejections_in` | Same fields as `create_rejections_in`, plus required `voucherNumber` | Replaces an existing Rejections In voucher's item lines in place. **Confirmed live.** |
| `create_rejections_out` | Same shape as `create_rejections_in` | Mirror of `create_rejections_in` (`VCHTYPE="Rejections Out"`, `ISDEEMEDPOSITIVE=No`) — goods rejected and sent outward. Same verified-live behavior. |
| `update_rejections_out` | Same fields as `create_rejections_out`, plus required `voucherNumber` | Replaces an existing Rejections Out voucher's item lines in place. **Confirmed live.** |
| `create_physical_stock` | `date`, `narration?`, `items` (`stockItem`, `actualQty`, `unit`, `godown?`, `batchName?`), `voucherNumber?` | Creates a Physical Stock voucher (`VCHTYPE="Physical Stock"`, `PERSISTEDVIEW="Invoice Voucher View"`, voucher-level `DIFFACTUALQTY=Yes`, `ISDEEMEDPOSITIVE=Yes`, no `RATE`/`AMOUNT`/`BILLEDQTY`) — updates the item's book quantity to match a physical count. **Bug found and fixed**: an earlier version of this template (`ISDEEMEDPOSITIVE=No` + a per-line `ISPHYSICALQTYENTERED` flag that doesn't actually exist for this purpose) corrupted the reported closing balance to a nonsensical negative number instead of the counted quantity. Rebuilt against a genuine Tally-exported XML template and re-verified: counting 95 of an item that had 100 in stock closed it at 95. Does not post any monetary write-off for the resulting shortage/excess value — use `create_voucher` separately for that. |
| `update_physical_stock` | Same fields as `create_physical_stock`, plus required `voucherNumber` | Replaces an existing Physical Stock voucher's counted lines in place. |
| `update_voucher` | `voucherType`, `voucherNumber`, `date`, `narration?`, `debitLedger`/`creditLedger`/`amount` **or** `entries?` (3+ legs, same shape as `create_voucher`) | Replaces the ledger entries/narration of an existing voucher. **Matched by type + date + voucher number** — that combination must uniquely identify the voucher (confirm with `get_ledger_vouchers` first). |
| `update_stock_journal` | Same fields as `create_stock_journal`, plus required `voucherNumber` | Replaces an existing Stock Journal's source/destination lines in place. |
| `update_stock_item` | `name`, `group?`, `unit?`, `description?`, `rateOfVat?`, `ignoreNegativeStock?`, `extraFields?` | Updates any subset of an existing stock item's fields — genuinely partial, same field coverage as `create_stock_item`, all optional except `name`. |
| `delete_stock_item` | `name` | Deletes a stock item (fails if it has transactions posted against it). |
| `delete_voucher` | `voucherType`, `voucherNumber`, `date` | Permanently deletes a voucher (true delete, no trace — distinct from Cancel). Matched the same way as `update_voucher`. |
| `delete_master` | `collection`, `names` | Deletes one or more masters of any collection type (`LEDGER`, `GROUP`, `STOCKGROUP`, `STOCKITEM`, `VOUCHERTYPE`, `UNIT`, `GODOWN`, `COSTCATEGORY`, `COSTCENTRE`, ...) by exact name. |

### Voucher type collision — affects every `update_*`/`delete_voucher` tool

Tally's Alter/Delete lookup (`TAGNAME="Voucher Number"`/`TAGVALUE`) matches by
**date + voucher number only** — the `VCHTYPE` attribute you pass is **not**
used to scope the match, even though each voucher type numbers independently
(so a Sales #4 and a Purchase #4 can both legitimately exist on the same
date). In practice, altering "Purchase #4" instead silently hit an
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

### Audit trail & permission scoping

Every tool call — read or write — passes through `server.ts`'s
`CallToolRequestSchema` handler, which wraps `handleTool` with two things:

1. **Permission check** (`permissions.ts`, before `handleTool` even runs): if
   `TALLY_READ_ONLY=true` or `TALLY_PERMISSION_MODE=read_only` (either one —
   the former is what Claude Desktop's Extensions UI "Read-only mode" toggle
   sets via `manifest.json`'s `user_config.read_only_mode`; the latter is the
   string-form equivalent for HTTP/manual deployments), any tool not in
   `server.ts`'s `READ_ONLY_TOOLS` set is denied outright — never reaches
   `handleTool`, never builds XML, never touches Tally. `TALLY_DISABLED_TOOLS`
   (comma-separated exact names, also exposed as the "Disabled tools" field
   in the Extensions UI) denies specific tools regardless of mode.
2. **Audit logging** (`audit.ts`, after `handleTool` resolves or throws):
   appends one JSON line — `ts`, `tool`, `readOnly`, `outcome`
   (`success`/`error`/`denied`), `detail` (result text or error message,
   truncated to 500 chars), `durationMs`, `args`, `company` — to a local
   file, opened in append mode every time (`appendFileSync`). A logging
   failure is swallowed, not surfaced, so it can never block the underlying
   Tally operation. `get_audit_log` reads this file back for review from
   within the assistant itself.

   `company` is a best-effort tag: an in-memory cache updated whenever
   `get_company_info`, `get_health_check`, or `set_company` succeeds, not a
   live lookup before every call. Entries logged before the cache first
   learns a company name have `company: null`. All companies share one
   audit log file rather than one file per company.

   Once per server process start (`pruneAuditLog`, called from
   `createServer`), entries older than 90 days are permanently deleted by
   rewriting the file — this is a hard delete, not an archive, and it's the
   one case where the file is rewritten rather than only appended to. A
   long-lived process doesn't have to wait for a restart to benefit from
   this: after every write, a cheap file-size check (metadata only, no
   content read) also triggers the same 90-day prune if the file has grown
   past 50MB, so growth is bounded even between restarts.

This directly addresses the two original gaps (tight permission scopes,
append-only audit trail) an external reviewer flagged for write-back
operations against vouchers/ledgers.

## Context switching tools

| Tool | Args | Effect |
|---|---|---|
| `set_company` | `companyName` | Switches Tally's active company — persistent, global state, affects every subsequent call. Only works if that company is already open in Tally; verifies the switch actually happened and throws an error otherwise (Tally's own `ChangeCurrentCompany` action silently no-ops on a company that isn't open — this tool does not). |
| `set_period` | `from`, `to` | Switches Tally's active reporting period — same persistent-state caveat as `set_company`. |

## SQL cache tools

| Tool | Args | Effect |
|---|---|---|
| `sync_to_sql` | — | Loads ledgers/groups/stock items into an in-memory SQL cache (PGLite), scoped to this session only |
| `sync_vouchers_to_sql` | `from`, `to` | Loads voucher headers (no line items) for one date range into the same cache — additive by date range, so calling it repeatedly for different chunks builds up full history within the session |
| `sync_voucher_items_to_sql` | `from`, `to` | Loads voucher inventory line items (stock item, qty, rate, amount, godown, batch) for one date range into the same cache — the raw data behind movement/godown/ageing analysis, since Tally has no exportable report for those (confirmed live against all 138 registered report names) and per-godown `$ClosingBalance`/`SVGODOWNNAME` scoping doesn't work either (confirmed live). Built on two levels of nested TDL `EXPLODE` (voucher → `AllInventoryEntries` → `BatchAllocations`), confirmed live safe and correct against known ground truth. |
| `query_sql` | `sql` | Runs a read-only `SELECT` against that cache |

`get_profit_and_loss`, `get_stock_summary`, `get_balance_sheet`,
`get_trial_balance`, `get_vat_liability_summary`, and
`get_gst_liability_summary` populate six more tables automatically as a
side effect of being called — `profit_and_loss`, `stock_summary`,
`balance_sheet`, `trial_balance`, `vat_summary`, `gst_summary` — no
explicit sync tool for any of them.
Each call does a whole-table replace (`DELETE` then re-`INSERT`), so the
table always reflects only the most recent call to that report tool, not
accumulated history across multiple periods.

`balance_sheet` and `trial_balance` needed their own bespoke parsers, not a
shared one — live inspection showed Tally's Balance Sheet export returns
two parallel top-level arrays (`BSNAME`/`BSAMT`) matched only by index
position, while Trial Balance returns a completely different shape
(`DSPACCNAME`/`DSPACCINFO`). Both handlers guard against a length mismatch
between the parallel arrays before zipping them — if Tally ever returns
mismatched array lengths, caching is silently skipped rather than risking a
wrong name-to-amount pairing.

**Deliberately not persisted, and not company-aware.** The cache is pure in-memory PGLite with no disk backing — it disappears when the process exits. This was a deliberate design choice, not an oversight: since one server instance can be pointed at many different client companies over the life of a session (`set_company`), and no cached row tracks which company it came from, persisting across restarts would risk silently mixing one client's cached data with the next. Re-sync after switching companies before running `query_sql` (or, for `profit_and_loss`/`stock_summary`, just re-call the report tool).

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
