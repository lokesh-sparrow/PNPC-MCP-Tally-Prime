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
6. It'll prompt for the **TallyPrime Gateway URL** — leave as `http://localhost:9000` unless your gateway runs elsewhere
7. Verify by clicking the **Tools** (hammer) icon in a chat — `PNPC-MCP-Tally-Prime` should appear in the list

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

## Available tools (30 total)

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

### Write

| Tool | Input | Output |
|---|---|---|
| `create_ledger` | `name`, `oldName?`, `parent`, `openingBalance?`, `maintainBillWise?`, `trn?`, `email?`, `website?`, `phone?`, `mobile?`, `billCreditPeriod?`, `creditLimit?`, `address?`, `state?`, `country?`, `pincode?`, `mailingName?`, `addressApplicableFrom?`, `extraFields?` | Creates a ledger under the given group — or, if `oldName` is passed, alters/renames that existing ledger instead. `extraFields` is an escape hatch for any other native Tally ledger field by exact tag name |
| `create_voucher` | `voucherType`, `date`, `narration?`, `debitLedger`/`creditLedger`/`amount` (simple 2-leg) **or** `entries?` (3+ legs), plus `debitBillName?`, `debitBillType?`, `creditBillName?`, `creditBillType?`, `debitCostCentre?`, `creditCostCentre?`, `costCategory?` | Creates a Payment/Receipt/Sales/Purchase/Journal voucher — either a simple debit+credit pair, or any number of lines via `entries` (e.g. one payment split across three expense ledgers). Bill-wise allocation (`New Ref` / `Agst Ref`) requires `maintainBillWise` to have been set on the ledger. Cost centre allocation works standalone |
| `update_voucher` | `voucherType`, `voucherNumber`, `date`, `narration?`, `debitLedger`, `creditLedger`, `amount`, `debitCostCentre?`, `creditCostCentre?`, `costCategory?` | Replaces an existing voucher's entries — matched by type + date + voucher number, which must already exist and be unique |
| `delete_voucher` | `voucherType`, `voucherNumber`, `date` | Permanently deletes a voucher — no trace left, distinct from cancelling (which keeps it visible, marked Cancelled) |
| `create_stock_journal` | `date`, `narration?`, `sourceItem`, `sourceQty`, `sourceRate`, `destItem`, `destQty`, `destRate`, `unit`, `godown?` | Creates a Stock Journal voucher moving inventory from one stock item to another (transfer or simple conversion). Inventory-only, no ledger entries |
| `create_sales_invoice` | `date`, `narration?`, `partyLedger`, `items` (array of `stockItem`, `qty`, `rate`, `unit`, `salesLedger`, `godown?`), `vatLedger?`, `vatRatePercent?`, `billName?`, `billType?` | Creates a real item-invoice Sales voucher — stock item lines with quantity/rate, each posted to its own Sales ledger, plus one optional VAT line on the total. Distinct from `create_voucher`, which has no stock item support. **Note:** using the *same* party ledger/stock item in both a Sales and a Purchase invoice can make it return `Cannot be deleted!` afterward — a Tally **Company Data → Rewrite** clears this (not a permanent lock). Using an item in only one of the two, or in real ongoing business (buy and sell the same item freely), is unaffected |
| `create_purchase_invoice` | Same shape as `create_sales_invoice`, with `purchaseLedger` per item instead of `salesLedger` | Creates a real item-invoice Purchase voucher — the buying-side mirror of `create_sales_invoice`. Same dual-role deletion caveat applies |
| `create_group` | `name`, `parent` | Creates an account group nested under a parent |
| `create_stock_item` | `name`, `group`, `unit`, `openingBalance?`, `openingRate?`, `description?`, `rateOfVat?`, `ignoreNegativeStock?`, `extraFields?` | Creates a stock item. `extraFields` is an escape hatch for any other native field by exact tag name |
| `update_stock_item` | `name`, `group`, `unit` | Updates an existing stock item's group/unit |
| `delete_stock_item` | `name` | Deletes a stock item (fails if it has transactions posted) |
| `delete_master` | `collection`, `names` | Deletes one or more masters of any type — `LEDGER`, `GROUP`, `STOCKITEM`, `VOUCHERTYPE`, `UNIT`, `GODOWN`, `COSTCATEGORY`, `COSTCENTRE`, etc. — by exact name |

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
> Tally (multiple companies can be open at once) — it returns success but
> has no effect if you name a company that isn't loaded. Open it in Tally
> first (File → Select Company), then switch to it via this tool.

### SQL cache

| Tool | Input | Output |
|---|---|---|
| `sync_to_sql` | — | Pulls ledgers, groups, stock items, and vouchers (last 365 days) into a local in-memory SQL cache |
| `query_sql` | `sql` (SELECT only) | Runs a read-only query against that cache — tables: `ledgers(name, parent, closing_balance)`, `groups(name, parent)`, `stock_items(name, parent, closing_balance)`, `vouchers(date, voucher_type, ledger, amount, narration)` |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `TALLY_URL` | `http://localhost:9000` | Tally's HTTP gateway address |
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

- **"Could not reach TallyPrime"** — Tally isn't running, or the gateway isn't enabled on port 9000.
- **"Tally returned an empty response"** — Tally is running but no company is open.
- **`create_ledger` / `create_voucher` fails** — parent group / ledger names must match Tally *exactly* (case- and whitespace-sensitive).
- **Clicking "Install Extension" and picking the `.mcpb` produces no dialog, no error, just the same screen:** this has been an inconsistent behavior on some Claude Desktop builds. Check `%APPDATA%\Claude\logs\main.log` for a fresh `Handling DXT/MCPB file: <path>` line right after your attempt:
  ```powershell
  Select-String "Handling DXT/MCPB file" "$env:APPDATA\Claude\logs\main.log" | Select-Object -Last 5
  ```
  - If it's logged but nothing else happens, a confirmation dialog may be rendering off-screen (rare, multi-monitor/remote-desktop setups) — check other windows.
  - If it's **not** logged at all, use **Install Unpacked Extension** on the same Extensions → Advanced settings screen instead. Download the "Source code (zip)" from the [latest release](https://github.com/lokesh-sparrow/PNPC-MCP-Tally-Prime/releases/latest), extract it, and point the picker at that folder — that path has been the more reliable one.

## Project structure

```
src/
  tally.ts        Tally HTTP client: sends XML, handles connection/timeout errors
  clean.ts        Normalizes Tally's raw XML->JSON into predictable JSON
  templates.ts    Renders the Nunjucks XML templates in templates/
  db.ts           PGLite SQL cache: sync_to_sql / query_sql
  tools.ts        MCP tool definitions + XML request builders
  server.ts       Shared MCP Server construction (used by both entry points)
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
- [docs/SQL_CACHE.md](docs/SQL_CACHE.md) — the PGLite SQL cache, schema, examples
- [docs/HTTP_DEPLOYMENT.md](docs/HTTP_DEPLOYMENT.md) — running as a remote HTTP server
- [docs/EXTENSION_PACKAGING.md](docs/EXTENSION_PACKAGING.md) — packaging as a Claude Desktop Extension

## Roadmap / not yet supported

- GST/VAT-specific statutory reports (e.g. GSTR-1, GSTR-3B, VAT return format)
- Tested/packaged integration with other MCP-capable AI clients (e.g. OpenAI Codex) — the server itself is a standard MCP server (stdio/HTTP) so it's not inherently Claude-only, but the `.mcpb` packaging and install steps above are Claude Desktop-specific and this hasn't been verified against other clients yet

## License

ISC — see [LICENSE](LICENSE). Early development was inspired by ideas
from [vaijaaaaa/Tally-MCP-Server](https://github.com/vaijaaaaa/Tally-MCP-Server)
and [dhananjay1405/tally-mcp-server](https://github.com/dhananjay1405/tally-mcp-server).

---

<p align="center">
  Built and maintained by <b>Lokesh Sparrow</b>, <a href="https://www.pnpcglobal.com">PNPC Global</a> —
  questions or issues? <a href="https://github.com/lokesh-sparrow/PNPC-MCP-Tally-Prime/issues">Open an issue</a>.
</p>
