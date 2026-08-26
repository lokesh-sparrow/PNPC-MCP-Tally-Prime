<p align="center">
  <img src="assets/icon.png" alt="PNPC-MCP-Tally-Prime" width="180">
</p>

<h1 align="center">PNPC-MCP-Tally-Prime</h1>

<p align="center">
  Tally Prime MCP (Model Context Protocol) Server implementation to feed
  TallyPrime ERP data to Claude — and unlike most Tally MCP servers, it can
  also <b>post vouchers</b> (Sales, Purchase, Payment, Receipt, Journal), not
  just read reports.
</p>

> Built and maintained by **PNPC Global**. Public so anyone can use or
> self-host it for their own TallyPrime setup.

## Prerequisites

- **TallyPrime** (Silver / Gold — avoid the Educational edition, its date-range
  limitation feeds partial/invalid data to the LLM and causes degraded, incorrect answers)
- **Claude Desktop** (Pro / Team / Max / Enterprise recommended — MCP makes
  many calls to Tally per question, which can exhaust a Free plan's limits quickly)
- TallyPrime's **XML/HTTP gateway enabled**:
  `F1 (Help) → Settings → Connectivity → Client/Server configuration`
  - **TallyPrime acts as** = `Server` (or `Both`)
  - **Port** = `9000`

You do **not** need Node.js installed to *run* this — Claude Desktop bundles
its own Node.js runtime for extensions. You only need Node.js if you're
building from source (see [Building from source](#building-from-source)).

## Download

Get the latest release — no cloning or building required:

- **[Latest release](https://github.com/lokesh-sparrow/PNPC-MCP-Tally-Prime/releases/latest)** — download the `.mcpb` (one-click installer extension for Claude Desktop) from the Assets section

## Supported platforms

| Platform | Local | Remote |
|---|---|---|
| Claude Desktop | ✔️ | ✔️ |

(Remote/cloud deployment is possible via the HTTP entry point — see
[docs/HTTP_DEPLOYMENT.md](docs/HTTP_DEPLOYMENT.md) — but local is the
supported, recommended path for most users.)

## Setup (Local)

Use this when Claude Desktop and TallyPrime are both on the same PC — Claude
Desktop runs the MCP server internally for you.

### One-click installation (via Extension)

1. Claude Desktop → menu → **File → Settings**
2. **Extensions → Advanced settings**
3. Click **Install Extension**
4. Browse to and select **`PNPC-MCP-Tally-Prime.mcpb`** (downloaded above)
5. A dialog will appear asking *"Do you want to install PNPC-MCP-Tally-Prime?"* — click **Install**
6. It'll prompt for the **TallyPrime Gateway URL** (leave as `http://localhost:9000` unless your gateway runs elsewhere), **Read-only mode** (on by default — this connector can look but not change anything until you turn this off), and an optional **Disabled tools** list
7. Verify by clicking the **Tools** (hammer) icon in a chat — `PNPC-MCP-Tally-Prime` should appear in the list

> **Read-only mode is on by default.** A fresh install can read reports, ledgers, and vouchers immediately, but every write tool (`create_*`, `update_*`, `delete_*`) will be refused until you go to this connector's settings, turn Read-only mode off, and **fully quit and reopen Claude Desktop** — saving the settings screen alone isn't enough.

If step 4–5 don't produce that confirmation dialog (accepted silently, nothing
visible happens), see **Troubleshooting** below — `Install Unpacked Extension`
on the same screen, pointed at the extracted "Source code (zip)" from the
[latest release](https://github.com/lokesh-sparrow/PNPC-MCP-Tally-Prime/releases/latest),
is the reliable fallback.

### Installation via config file (via Developer menu)

1. Claude Desktop → menu → **File → Settings → Developer**
2. This opens a File Explorer window at the config location — right-click **`claude_desktop_config.json`** → **Edit** (Notepad)
3. Add:
   ```json
   {
     "mcpServers": {
       "PNPC-MCP-Tally-Prime": {
         "command": "node",
         "args": ["D:\\Path\\To\\PNPC-MCP-Tally-Prime\\dist\\index.js"]
       }
     }
   }
   ```
   (Use double backslashes in the path, as shown.)
4. Save, then fully quit Claude Desktop (**File → Exit**) and relaunch it
5. Verify via the **Tools** icon, same as above

### Perplexity Desktop / other MCP clients

Any MCP client that accepts a local stdio server config uses the same
`command`/`args` JSON shown above. See your client's own docs for exactly
where that config lives.

## Setup (Cloud)

For browser-based or mobile LLM clients that can't reach a TallyPrime
instance running on your local PC, the server can run as a small web
service with OAuth-protected access instead. This is more involved —
see [docs/HTTP_DEPLOYMENT.md](docs/HTTP_DEPLOYMENT.md).

## Available tools (71 total)

Dates use `DD-MM-YYYY` format, matching Tally's own convention. Full
machine-readable schemas: [docs/TOOLS.md](docs/TOOLS.md).

### Read

| Tool | Input | Output |
|---|---|---|
| `get_ledgers` | — | All ledgers (accounts) |
| `get_stock_items` | — | All stock items |
| `get_groups` | — | Account groups (e.g. Sundry Debtors, Fixed Assets) |
| `get_voucher_types` | — | Configured voucher types (Payment, Sales, Journal, ...) |
| `get_cost_centres` | — | All cost centres |
| `get_company_info` | — | Currently open company's details |
| `get_vouchers` | `from`, `to` | Day Book — vouchers in that date range |
| `get_ledger_vouchers` | `ledgerName`, `from`, `to` | Voucher entries posted to one ledger |
| `get_profit_and_loss` | `from`, `to` | P&L statement |
| `get_trial_balance` | `from`, `to` | Trial Balance |
| `get_balance_sheet` | `asOf` | Balance Sheet as of a date |
| `get_stock_summary` | `asOf` | Stock Summary as of a date |
| `get_bills_receivable` | `asOf` | Outstanding Bills Receivable |
| `get_bills_payable` | `asOf` | Outstanding Bills Payable |
| `get_cash_flow` | `from`, `to` | Cash Flow statement — Tally's own canned report |
| `get_funds_flow` | `from`, `to` | Funds Flow statement — Tally's own canned report |
| `get_ratio_analysis` | `from`, `to` | Standard ratios (Current Ratio, Quick Ratio, Inventory/Debtors/Creditors Turnover, etc.) — Tally's own canned report |
| `get_sales_register` | `from`, `to` | Month-by-month Sales voucher summary — Tally's own canned report |
| `get_purchase_register` | `from`, `to` | Month-by-month Purchase voucher summary — Tally's own canned report |
| `get_journal_register` | `from`, `to` | Month-by-month Journal voucher summary — Tally's own canned report |
| `get_payment_register` | `from`, `to` | Month-by-month Payment voucher summary — Tally's own canned report |
| `get_receipts_and_payments` | `from`, `to` | Combined cash/bank Receipts and Payments view — the closest reachable equivalent to Cash Book/Bank Book, which aren't reachable as standalone reports |
| `get_reorder_status` | `from`, `to` | Stock items that actually have a reorder level configured, and how their quantity stands against it — filtered down from Tally's own report, which returns every item regardless (confirmed live on a 10,770-item company) |
| `get_vat_liability_summary` | `from`, `to` | UAE VAT liability for a period — Input/Output/RCM/other VAT ledgers found via Tally's own tax-type field or name pattern (whichever actually catches this company's real ledgers), plus a net total |
| `get_gst_liability_summary` | `from`, `to` | India GST liability for a period — same hybrid approach as VAT, for CGST/SGST/IGST input/output/payable/receivable/RCM ledgers |

### Write — vouchers

| Tool | Input | Output |
|---|---|---|
| `create_voucher` | `voucherType`, `date`, `narration?`, `debitLedger`/`creditLedger`/`amount` (simple 2-leg) **or** `entries?` (3+ legs), plus `debitBillName?`, `debitBillType?`, `creditBillName?`, `creditBillType?`, `debitCostCentre?`, `creditCostCentre?`, `costCategory?` | Creates a Payment/Receipt/Journal/Contra voucher — either a simple debit+credit pair, or any number of lines via `entries` (e.g. one payment split across three expense ledgers). Bill-wise allocation (`New Ref` / `Agst Ref`) requires `maintainBillWise` to have been set on the ledger |
| `update_voucher` | `voucherType`, `voucherNumber`, `date`, `narration?`, `debitLedger`/`creditLedger`/`amount` **or** `entries?` | Replaces an existing voucher's entries in place — matched by type + date + voucher number |
| `delete_voucher` | `voucherType`, `voucherNumber`, `date` | Permanently deletes a voucher — no trace left, distinct from cancelling (which keeps it visible, marked Cancelled) |
| `create_stock_journal` | `date`, `narration?`, `sources` (array of `stockItem`, `qty`, `rate`, `unit`, `godown?`, `batchName?`), `destinations` (same shape), `additionalCosts?` (array of `ledgerName`, `amount`, `allocationType?`), `voucherType?`, `voucherNumber?` | Creates a Stock Journal (or Manufacturing Journal, via `voucherType`) voucher moving inventory from one or more source items to one or more destination items — supports multiple raw materials in and multiple finished/by-products out in a single voucher, plus optional additional costs (labour, freight) folded into the produced items' valuation. Inventory-only, no ledger balance effect from `additionalCosts` itself — see the note below |
| `update_stock_journal` | Same fields as `create_stock_journal`, plus required `voucherNumber` | Replaces an existing Stock Journal/Manufacturing Journal's source/destination lines in place |
| `create_material_in` | `date`, `narration?`, `partyLedger`, `items` (array of `stockItem`, `qty`, `rate`, `unit`, `godown?`, `batchName?`), `voucherNumber?` | Creates a Material In voucher — stock received back from a job worker, tracked against their ledger without a real accounting posting. Verified live: stock quantity increases and the party ledger's balance stays unchanged |
| `create_material_out` | Same shape as `create_material_in` | Creates a Material Out voucher — stock sent out to a job worker. Mirror of `create_material_in`, same verified-live behavior |
| `create_rejections_in` | `date`, `narration?`, `items` (array of `stockItem`, `qty`, `rate`, `unit`, `godown?`, `batchName?`), `voucherNumber?` | Creates a Rejections In voucher — goods rejected and returned to you. Inventory-only. Verified live: stock quantity increases correctly |
| `create_rejections_out` | Same shape as `create_rejections_in` | Creates a Rejections Out voucher — goods you're rejecting outward. Mirror of `create_rejections_in`, same verified-live behavior |
| `create_sales_invoice` | `date`, `narration?`, `partyLedger`, `items` (array of `stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `godown?`, `batchName?`, `discountPercent?`, `vatLedger?`, `vatRatePercent?`), `vatLedger?`, `vatRatePercent?`, `billName?`, `billType?`, `voucherNumber?` | Creates a real item-invoice Sales voucher — stock item lines with quantity/rate/discount, each posted to its own Sales ledger, grouped into one VAT line per distinct rate. Distinct from `create_voucher`, which has no stock item support. `voucherNumber`: some Tally configurations stop auto-numbering item-invoice vouchers via the XML gateway — pass it explicitly if creation fails with a blank `EXCEPTIONS:1`. **Note:** using the *same* party ledger/stock item in both a Sales and a Purchase invoice can make it return `Cannot be deleted!` afterward — a Tally **Company Data → Rewrite** clears this (not a permanent lock) |
| `update_sales_invoice` | Same fields as `create_sales_invoice`, plus required `voucherNumber` | Replaces an existing Sales invoice's item lines/party/narration in place, instead of delete+recreate |
| `create_purchase_invoice` | Same shape as `create_sales_invoice`, with `purchaseLedger` per item instead of `salesLedger` | Creates a real item-invoice Purchase voucher — the buying-side mirror of `create_sales_invoice`. Same dual-role deletion caveat applies |
| `update_purchase_invoice` | Same fields as `create_purchase_invoice`, plus required `voucherNumber` | Replaces an existing Purchase invoice's item lines in place |
| `create_credit_note` | Same shape as `create_sales_invoice`, `billType` defaults to `'Agst Ref'` | Creates a Sales-return Credit Note — sign convention mirrors Purchase's. Returning 5 units increases book quantity by 5 |
| `update_credit_note` | Same fields as `create_credit_note`, plus required `voucherNumber` | Replaces an existing Credit Note's item lines in place |
| `create_debit_note` | Same shape as `create_purchase_invoice`, `billType` defaults to `'Agst Ref'` | Creates a Purchase-return Debit Note — sign convention mirrors Sales's. Returning 3 units decreases book quantity by 3 |
| `update_debit_note` | Same fields as `create_debit_note`, plus required `voucherNumber` | Replaces an existing Debit Note's item lines in place |
| `create_delivery_note` | `date`, `narration?`, `partyLedger`, `items` (array of `stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `godown?`, `batchName?`, `discountPercent?`), `voucherNumber?` | Creates a Delivery Note — item-line dispatch of goods before/without a full Sales invoice. ⚠️ The voucher type must be active in the company first (a company-level toggle) — once active, `get_vouchers`/`delete_voucher` find it correctly; `get_ledger_vouchers` never shows it, by design |
| `create_receipt_note` | `date`, `narration?`, `partyLedger`, `items` (array of `stockItem`, `qty`, `rate`, `unit`, `purchaseLedger`, `godown?`, `batchName?`, `discountPercent?`), `voucherNumber?` | Creates a Receipt Note — buying-side mirror of `create_delivery_note`, same caveats |
| `create_sales_order` | `date`, `narration?`, `partyLedger`, `items` (array of `stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `dueDate`, `godown?`, `batchName?`, `discountPercent?`), `orderNumber`, `voucherNumber?` | Creates a Sales Order — a future commitment to sell, no stock/ledger movement yet. `orderNumber` and each item's `dueDate` are required (Tally rejects an Order-class voucher without them). Same voucher-type-active caveat as `create_delivery_note`. Tally silently reassigns its own voucher number for Order-class vouchers regardless of what's passed — check the real number via `get_vouchers` after creating one |
| `create_purchase_order` | `date`, `narration?`, `partyLedger`, `items` (array of `stockItem`, `qty`, `rate`, `unit`, `purchaseLedger`, `dueDate`, `godown?`, `batchName?`, `discountPercent?`), `orderNumber`, `voucherNumber?` | Creates a Purchase Order — buying-side mirror of `create_sales_order`, same caveats |
| `create_sales_quotation` | `date`, `narration?`, `partyLedger`, `items` (array of `stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `godown?`, `batchName?`, `discountPercent?`), `voucherNumber?` | Creates a Sales Quotation — a pre-order price quote, one step before `create_sales_order`. Same voucher-type-active caveat |
| `create_job_work_in_order` | `date`, `narration?`, `partyLedger`, `items` (array of `stockItem`, `qty`, `rate`, `unit`, `dueDate`, `godown?`, `batchName?`, `components` — array of `stockItem`, `qty`, `rate`, `unit`, `godown?`, `batchName?`), `orderNumber`, `voucherNumber?` | Creates a Job Work In Order — this company is the job worker, booking an order to process raw materials a customer will supply into a finished item delivered back. Each item's `components` list is the raw material the customer is expected to supply. `orderNumber` and each item's `dueDate` are required |
| `create_job_work_out_order` | Same fields as `create_job_work_in_order` | Creates a Job Work Out Order — mirror image: this company is the principal, sending raw materials (each item's `components`) out to a job worker and expecting a finished item back |
| `create_physical_stock` | `date`, `narration?`, `items` (array of `stockItem`, `actualQty`, `unit`, `godown?`, `batchName?`), `voucherNumber?` | Creates a Physical Stock voucher — updates the item's book quantity to match a physical count (that's the point of the voucher). Counting 95 of an item with 100 in stock closes it at 95. Doesn't post any monetary write-off for the shortage/excess value itself — see [Troubleshooting](docs/TROUBLESHOOTING.md) if you're on an older build than this |
| `update_physical_stock` | Same fields as `create_physical_stock`, plus required `voucherNumber` | Replaces an existing Physical Stock voucher's counted lines in place |

> ℹ️ **`additionalCosts` on `create_stock_journal`/`update_stock_journal`:** this does **not** post a real transaction against the named ledger — its balance stays unchanged. It's a costing/valuation instruction only, telling Tally's stock valuation reports to fold that amount into the produced item's effective cost. The actual expense (e.g. paying labour) still needs recording separately, e.g. via `create_voucher`.

> ℹ️ **Voucher type collision:** `update_voucher`, `update_sales_invoice`,
> `update_purchase_invoice`, `update_credit_note`, `update_debit_note`,
> `update_stock_journal`, `update_physical_stock`, and `delete_voucher` all
> check for date+number ambiguity across voucher types before touching
> anything, and refuse rather than risk altering/deleting the wrong one.
> If you hit that refusal, see [Troubleshooting](docs/TROUBLESHOOTING.md)
> for why it happens and how to resolve it in Tally.

### Write — masters

| Tool | Input | Output |
|---|---|---|
| `create_ledger` | `name`, `oldName?`, `parent`, `openingBalance?`, `maintainBillWise?`, `trn?`, `email?`, `website?`, `phone?`, `mobile?`, `billCreditPeriod?`, `creditLimit?`, `address?`, `state?`, `country?`, `pincode?`, `mailingName?`, `addressApplicableFrom?`, `extraFields?` | Creates a ledger under the given group — or, if `oldName` is passed, alters/renames that existing ledger instead. `extraFields` is an escape hatch for any other native Tally ledger field by exact tag name |
| `create_group` | `name`, `oldName?`, `parent` | Creates an account group nested under a parent — or renames/reparents an existing one if `oldName` is passed |
| `create_stock_group` | `name`, `parent` | Creates a Stock Group (the category `create_stock_item`'s `group` field references) — distinct from `create_group`'s account groups |
| `create_stock_item` | `name`, `group`, `unit`, `openingBalance?`, `openingRate?`, `description?`, `rateOfVat?`, `ignoreNegativeStock?`, `extraFields?` | Creates a stock item. `extraFields` is an escape hatch for any other native field by exact tag name |
| `update_stock_item` | `name`, `group?`, `unit?`, `description?`, `rateOfVat?`, `ignoreNegativeStock?`, `extraFields?` | Updates any subset of an existing stock item's fields — same coverage as `create_stock_item`, all optional except `name` |
| `delete_stock_item` | `name` | Deletes a stock item (fails if it has transactions posted) |
| `create_unit` | `symbol`, `formalName?`, `decimalPlaces?` **or** `baseUnit`+`additionalUnit`+`conversion` for a compound unit | Creates a Unit of Measure — simple (e.g. `'Kg'`) by default, or compound (e.g. `'Box of 12 Nos'`) when `baseUnit` is passed. Both simple units must already exist before creating the compound unit that references them — required before using a unit that doesn't exist yet |
| `set_bill_of_materials` | `stockItem`, `componentListName?`, `basicQty?`, `unit?`, `components` (array of `stockItem`, `qty`, `unit`, `natureOfItem?`, `godown?`) | Attaches a recipe to an existing finished-goods stock item. Pure convenience layer over `create_stock_journal` — doesn't move stock or post anything itself. Verified live: attaches without error and causes no stock movement on its own. `natureOfItem`'s four values (`Component`/`Co-Product`/`By-Product`/`Scrap`) were each checked against Tally's own BoM screen — all map to the matching "Type of Item" label |
| `create_godown` | `name`, `parent?` | Creates a Godown/Location, optionally nested under a parent godown — pass the parent's plain name, not a dotted path |
| `create_cost_category` | `name`, `allocateToRevenue?`, `allocateToNonRevenue?` | Creates a Cost Category (grouping of cost centres) |
| `create_cost_centre` | `name`, `category?`, `parent?` | Creates a Cost Centre for tagging voucher entries (see `create_voucher`'s cost centre fields) |
| `create_voucher_type` | `name`, `oldName?`, `parent`, `numberingMethod?`, `abbreviation?`, `preventDuplicates?`, `useAsManufacturingJournal?`, `extraFields?` | Creates a custom Voucher Type derived from a base type (e.g. `'Bank Payment'` from `'Payment'`, or a proper `'Manufacturing Journal'` type from `'Stock Journal'` via `useAsManufacturingJournal`) — or renames/reconfigures an existing one if `oldName` is passed. Pass the resulting name as `voucherType` to `create_stock_journal`/`update_stock_journal` to post against it |
| `delete_master` | `collection`, `names` | Deletes one or more masters of any type — `LEDGER`, `GROUP`, `STOCKGROUP`, `STOCKITEM`, `VOUCHERTYPE`, `UNIT`, `GODOWN`, `COSTCATEGORY`, `COSTCENTRE`, etc. — by exact name |

> ⚠️ `create_ledger` / `update_voucher` / `delete_stock_item` / `delete_master` /
> `delete_voucher` modify or remove existing data. Keep a Tally backup before
> letting the model use these on data you care about — `delete_master` and
> `delete_voucher` in particular have no undo.

### Context switching

| Tool | Input | Output |
|---|---|---|
| `set_company` | `companyName` | Switches TallyPrime's active company — affects every subsequent call until changed again |
| `set_period` | `from`, `to` | Switches TallyPrime's active reporting period — affects every subsequent report until changed again |

> These change **global, persistent state in Tally itself** (the same as
> switching company/period from Tally's own UI) — not a per-call parameter.
> If you're running multiple tools/sessions against the same Tally
> instance, a `set_company`/`set_period` call from one affects what every
> other caller sees next.
>
> `set_company` can only switch to a company that is **already open** in
> Tally (multiple companies can be open at once) — naming one that isn't
> loaded returns an error rather than silently doing nothing. Open it in
> Tally first (File → Select Company), then switch to it via this tool.

### SQL cache

| Tool | Input | Output |
|---|---|---|
| `sync_to_sql` | — | Pulls ledgers, groups, and stock items into a **session-only, in-memory** SQL cache |
| `sync_vouchers_to_sql` | `from`, `to` | Pulls voucher headers (date, type, number, party, amount, narration — not line items) for one date range into the same cache. Call it once per chunk (e.g. per quarter) to build up full multi-year history within a session — each call only replaces vouchers in its own date range, so calling it for 2024 then 2025 gives you both |
| `query_sql` | `sql` (SELECT only) | Runs a read-only query against that cache — tables: `ledgers(name, parent, closing_balance)`, `groups(name, parent)`, `stock_items(name, parent, closing_balance)`, `vouchers(guid, date, voucher_type, voucher_number, party_ledger, amount, narration)` |

`get_profit_and_loss`, `get_stock_summary`, `get_balance_sheet`,
`get_trial_balance`, `get_vat_liability_summary`, and
`get_gst_liability_summary` also cache themselves into this same store
automatically — `profit_and_loss(ledger_name, group_name, closing_balance,
period_from, period_to)`, `stock_summary(name, parent, opening_qty,
closing_qty, opening_value, closing_value, as_of_date)`,
`balance_sheet(group_name, amount, as_of_date)`, `trial_balance(name,
debit_amount, credit_amount, period_from, period_to)`,
`vat_summary(ledger_name, category, match_method, closing_balance,
period_from, period_to)`, and `gst_summary` (same shape as `vat_summary`)
— no separate sync call needed. Each holds only the most recent call's
result, replaced whenever you call that report tool again.

> The cache is **in-memory and session-scoped only** — it's gone as soon as
> the server process exits, and there's no persistence to disk. This is
> deliberate: since one Tally connection can be pointed at many different
> client companies over time (`set_company`), nothing here tracks *which*
> company a cached row came from. If you switch companies, re-sync (or, for
> the six automatic tables, re-call the report tool) before querying —
> don't run `query_sql` against a cache that spans a company switch, since
> the rows won't be distinguishable by company.

### Audit & permissions

| Tool | Input | Output |
|---|---|---|
| `get_audit_log` | `limit?` (default 50), `toolFilter?`, `writesOnly?`, `fromDate?`, `toDate?`, `company?`, `format?` (`'json'` default or `'summary'`) | Reads this connector's audit log — every tool call made through it, read or write, with timestamp, arguments, outcome (`success`/`error`/`denied`), and a best-effort company tag. `company` filters to one Tally company; `writesOnly` + a date range + `format: 'summary'` gives a compact reviewer-facing table instead of raw JSON — "what changed between these two dates" |
| `get_health_check` | — | Reports whether Tally's gateway is actually reachable (not just "something answered" — this catches cases like Tally's own license server responding on a misconfigured port with an HTML page that looks like success), which company is open, the active `TALLY_URL`, current read-only/disabled-tools state, and the audit log's file path. Always allowed, even in read-only mode |

Every tool call — read or write — is appended to a local JSONL log file, so
there's always a plain-text record of exactly what an agent did. All
companies share this one log file; each entry carries a best-effort
`company` tag (updated whenever `get_company_info`, `get_health_check`, or
`set_company` succeeds — not a live lookup on every call). Once per server
start, entries older than 90 days are permanently deleted by rewriting the
file — this is a hard delete, not an archive. A cheap size check on every
write also triggers the same deletion if the file grows past 50MB, so a
long-lived process doesn't have to wait for a restart for this to kick in.

**Safe by default:** a fresh `.mcpb` install starts in **read-only mode** —
this connector can look at your books but cannot change anything until you
deliberately turn writes on. If you installed via the `.mcpb`, Claude
Desktop's Extensions settings screen for this connector shows a **"Read-only
mode"** toggle (on by default) and an optional **"Disabled tools"** field
directly — no config editing required either way.

> ⚠️ **Settings changes take effect only after you fully quit and reopen
> Claude Desktop** — saving the settings screen alone does *not* apply the
> new value. This connector runs as a long-lived child process that only
> reads its configuration once, at startup; Claude Desktop doesn't push new
> values into an already-running extension. Toggling "Read-only mode" on
> and expecting it to take effect immediately will fail silently (the next
> write still goes through) until you restart the app.

Running this outside Claude Desktop (HTTP mode, manual config)? Use the
environment variables in the table below instead — see `TALLY_PERMISSION_MODE`
and `TALLY_DISABLED_TOOLS`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `TALLY_URL` | `http://localhost:9000` | Tally's HTTP gateway address. Installed via `.mcpb`? This is the "Tally Gateway URL" field in Claude Desktop's Extensions settings — no manifest editing needed |
| `TALLY_READ_ONLY` | `true` for `.mcpb` installs via Claude Desktop's Extensions UI (safe-by-default); `false` if unset entirely (e.g. bare HTTP/manual deployments) | Set to `true` to block every write tool before it reaches Tally. This is the "Read-only mode" toggle in Claude Desktop's Extensions settings for `.mcpb` installs, **on by default** — you have to deliberately turn it off before this connector can write anything |
| `TALLY_PERMISSION_MODE` | `read_write` | String-form equivalent of `TALLY_READ_ONLY`, for HTTP/manual deployments — set to `read_only` for the same block. Either variable blocks writes; you don't need to set both |
| `TALLY_DISABLED_TOOLS` | _(unset)_ | Comma-separated exact tool names to block regardless of mode, e.g. `delete_voucher,delete_master` to allow writes but forbid deletion. This is the "Disabled tools (advanced)" field in Claude Desktop's Extensions settings for `.mcpb` installs |
| `TALLY_AUDIT_LOG_PATH` | `audit.log.jsonl` next to the installed package | Where the append-only audit log is written. Point multiple connector instances at one shared path if you want a single combined log |
| `PORT` | `3939` | Port for `npm run start:http` (remote mode only) |
| `TALLY_MCP_TOKEN` | _(unset)_ | Bearer token required on the HTTP server's `/mcp` endpoint if set (remote mode only) |

> **Running this alongside another Tally MCP connector?** Each connector needs
> its own gateway port open in TallyPrime (`F1 → Settings → Connectivity`) —
> two connectors can't share port 9000. If you already have one connector
> using 9000, open a second gateway on e.g. 9001 for this one, edit
> `mcp_config.env.TALLY_URL` in `manifest.json` to match before packing, or
> set `TALLY_URL` directly wherever your MCP client lets you configure this
> server's environment.

## Building from source

Only needed if you're modifying the code rather than using the downloaded `.mcpb`.

```bash
npm install --omit=dev   # production deps only
npm run build             # compiles src/ -> dist/
```

**Node version note:** if your system `node --version` reports something
ancient, check `where node` (Windows) / `which -a node` (macOS/Linux) for a
newer install elsewhere on `PATH` and use it explicitly for the commands
above — Claude Desktop's *own* bundled Node is what runs the installed
extension regardless of your system `PATH`, so this only affects building.

### Packing a `.mcpb` yourself

```bash
npm install -g @anthropic-ai/mcpb   # one-time
mcpb validate manifest.json
mcpb pack . PNPC-MCP-Tally-Prime.mcpb
```

## Troubleshooting

The most common issues at a glance:

- **"Could not reach TallyPrime"** — Tally isn't running, or the gateway isn't enabled on port 9000.
- **"Tally returned an empty response"** — Tally is running but no company is open.
- **A write call returns `CREATED:0`/`EXCEPTIONS:1` with no error text** — most often a missing `godown` on a company with location tracking enabled.
- **`create_ledger` / `create_voucher` fails** — parent group / ledger names must match Tally *exactly* (case- and whitespace-sensitive).

For the full FAQ and every other real-world gotcha (shared-server port
conflicts, silent write failures, deletion quirks, voucher-numbering
surprises, the audit log, extension install issues, and more), see
**[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**.

## Project structure

```
src/
  tally.ts        Tally HTTP client: sends XML, handles connection/timeout errors
  clean.ts        Normalizes Tally's raw XML->JSON into predictable JSON
  templates.ts    Renders the Nunjucks XML templates in templates/
  db.ts           PGLite SQL cache: sync_to_sql / sync_vouchers_to_sql / query_sql
  audit.ts        Append-only JSONL audit log (every tool call, read or write)
  permissions.ts  Write-scoping via TALLY_PERMISSION_MODE / TALLY_DISABLED_TOOLS
  tools.ts        MCP tool definitions + XML request builders
  server.ts       Shared MCP Server construction (used by both entry points) — wires audit logging + permission checks around every call
  index.ts        stdio entry point (local Claude Desktop)
  http-server.ts  HTTP entry point (remote clients)
templates/
  *.xml.njk       Nunjucks templates for each Tally XML request shape
manifest.json     Claude Desktop Extension manifest (manifest_version 0.3)
```

## Docs

- [docs/INSTALL_GUIDE.md](docs/INSTALL_GUIDE.md) — background on why the install steps above are structured this way
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — request flow, file responsibilities
- [docs/TALLY_XML_GUIDE.md](docs/TALLY_XML_GUIDE.md) — how Tally's XML gateway works, gotchas
- [docs/TOOLS.md](docs/TOOLS.md) — full tool reference + how to add a new tool
- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — full FAQ + every real-world gotcha, by category
- [docs/SQL_CACHE.md](docs/SQL_CACHE.md) — the PGLite SQL cache, schema, examples
- [docs/HTTP_DEPLOYMENT.md](docs/HTTP_DEPLOYMENT.md) — running as a remote HTTP server
- [docs/EXTENSION_PACKAGING.md](docs/EXTENSION_PACKAGING.md) — packaging as a Claude Desktop Extension

## Roadmap / not yet supported

- GST/VAT-specific statutory reports (e.g. GSTR-1, GSTR-3B, VAT return format)
- Ready-made packaging for AI clients other than Claude Desktop — the server itself runs on the standard MCP protocol (stdio and HTTP), so it isn't tied to Claude; the `.mcpb`/install steps above are just this repo's Claude Desktop packaging

## License

ISC — see [LICENSE](LICENSE). Early development was inspired by ideas
from [vaijaaaaa/Tally-MCP-Server](https://github.com/vaijaaaaa/Tally-MCP-Server)
and [dhananjay1405/tally-mcp-server](https://github.com/dhananjay1405/tally-mcp-server).

---

<p align="center">
  Built and maintained by <b>Lokesh Sparrow</b>, <a href="https://www.pnpcglobal.com">PNPC Global</a> —
  questions or issues? <a href="https://github.com/lokesh-sparrow/PNPC-MCP-Tally-Prime/issues">Open an issue</a>.
</p>
