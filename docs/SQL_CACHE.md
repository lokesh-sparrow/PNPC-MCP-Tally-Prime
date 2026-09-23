# SQL Cache (PGLite)

For ad-hoc analysis, calling one fixed-shape report tool per question doesn't
scale — Claude can't do things like "top 10 debtors by balance" without a
dedicated tool for exactly that. The SQL cache solves this generically.

## How it works

`sync_to_sql` pulls ledgers, groups, and stock items from Tally and loads
them into [PGLite](https://pglite.dev) — a real Postgres engine compiled to
WASM, running in-process, in-memory, with no disk backing (see
[`src/db.ts`](../src/db.ts)). No external database server involved.

`sync_vouchers_to_sql(from, to)` pulls voucher **headers** (not line items —
date, type, number, party, amount, narration) for one date range into the
same cache. It's additive by date range: call it once per chunk (e.g. once
per quarter) to build up full multi-year history within a session without
a single request large enough to risk Tally's gateway timing out. Re-running
it for a range you already synced just refreshes that range.

`sync_voucher_items_to_sql(from, to)` pulls voucher **inventory line items**
(stock item, qty, rate, amount, godown, batch) — one row per item per batch
allocation — for one date range into the same cache, additive by date range
like `sync_vouchers_to_sql`. This is deliberately the *only* way this
connector exposes movement analysis, godown-wise stock, or batch/ageing
detail: Tally has no exportable "Movement Analysis"/"Stock Ageing
Analysis"/"Godown Summary" report reachable over the gateway (confirmed
live against all 138 registered report names — most aren't even directly
exportable, they're UI drill-downs only reachable by clicking inside another
report), and per-godown scoping via `$ClosingBalance:"<godown>"` or the
`SVGODOWNNAME` static variable doesn't actually filter anything (confirmed
live against a real test item with real stock in a real godown — both
approaches silently returned the company-wide total regardless of which
godown was asked for). The only way to get real godown/batch data out is to
walk each voucher's own `AllInventoryEntries`, then each entry's own
`BatchAllocations` — two levels of nested TDL `EXPLODE`, confirmed live safe
(no gateway hang) and correct (godown/batch populate only where actually
set, verified against known ground truth). So: pull the line items with this
tool, then do the actual analysis as a `query_sql` `SELECT` — there is no
dedicated report tool for movement/ageing/godown, on purpose.

`sync_voucher_ledger_entries_to_sql(from, to)` pulls voucher **ledger
lines** (which ledger, amount, cost centre, bill allocation) — one row per
ledger line per bill allocation — for one date range into the same cache,
additive by date range like the others. This fills a different gap:
`vouchers`/`sync_vouchers_to_sql` only carry each voucher's single overall
total, with no way to see which ledgers it actually posted to. Whenever a
ledger's balance needs to be broken apart by the vouchers that make it up —
splitting a combined VAT ledger into Output vs Input, or reconciling a
party ledger's movements voucher by voucher — this is the table to pull
and query. It reuses the same TDL template (`voucher-ledger-entries.xml.njk`)
already used internally to verify a single voucher right after a write, now
exposed for bulk historical queries too. `amount` here is **signed**
(negative for a debit line, positive for a credit line — confirmed live: a
real Sales invoice's party-ledger line came back negative while its
Sales/VAT lines came back positive, summing to zero across the voucher), so
it sums directly with no sign-juggling needed.

`query_sql` then runs an arbitrary read-only `SELECT` against that cache.

`get_profit_and_loss`, `get_stock_summary`, `get_balance_sheet`,
`get_trial_balance`, `get_vat_liability_summary`, and
`get_gst_liability_summary` all cache themselves automatically, with no
sync step at all — calling any one of them refreshes its table with that
call's result, so a follow-up question about the same report can query it
via SQL instead of re-fetching from Tally and re-dumping the full report
into context a second time.

## Tables

| Table | Columns | Populated by |
|---|---|---|
| `ledgers` | `name`, `parent`, `closing_balance`, `trn`, `state`, `country` | `sync_to_sql` (explicit) |
| `groups` | `name`, `parent` | `sync_to_sql` (explicit) |
| `stock_items` | `name`, `parent`, `closing_balance` | `sync_to_sql` (explicit) |
| `vouchers` | `guid`, `date`, `voucher_type`, `voucher_number`, `party_ledger`, `amount`, `narration` | `sync_vouchers_to_sql` (explicit) |
| `voucher_items` | `voucher_guid`, `date`, `voucher_type`, `voucher_number`, `stock_item`, `qty`, `rate`, `amount`, `is_deemed_positive`, `godown`, `batch` | `sync_voucher_items_to_sql` (explicit) |
| `voucher_ledger_entries` | `voucher_guid`, `date`, `voucher_type`, `voucher_number`, `ledger`, `amount`, `is_deemed_positive`, `cost_centre`, `bill_name`, `bill_type` | `sync_voucher_ledger_entries_to_sql` (explicit) |
| `profit_and_loss` | `ledger_name`, `group_name`, `closing_balance`, `period_from`, `period_to` | `get_profit_and_loss` (automatic) |
| `stock_summary` | `name`, `parent`, `opening_qty`, `closing_qty`, `opening_value`, `closing_value`, `as_of_date` | `get_stock_summary` (automatic) |
| `balance_sheet` | `group_name`, `amount`, `as_of_date` | `get_balance_sheet` (automatic) |
| `trial_balance` | `name`, `debit_amount`, `credit_amount`, `period_from`, `period_to` | `get_trial_balance` (automatic) |
| `vat_summary` | `ledger_name`, `category`, `match_method`, `closing_balance`, `period_from`, `period_to` | `get_vat_liability_summary` (automatic) |
| `gst_summary` | same shape as `vat_summary` | `get_gst_liability_summary` (automatic) |

`vouchers` is only populated for date ranges you've explicitly pulled via
`sync_vouchers_to_sql` — it starts empty every session. The six automatic
tables are whole-table replaced on every call to their respective report
tool — each holds only the **most recent** call's result, not an
accumulating history. Calling `get_profit_and_loss` for a different period
wipes and replaces the table, it doesn't add to it.

`balance_sheet` and `trial_balance` come from genuinely different Tally
export shapes than `profit_and_loss`/`stock_summary` — Tally's own report
XML uses bespoke, per-report field names with no shared schema — Balance
Sheet returns `BSNAME`/`BSAMT` parallel arrays, Trial Balance returns
`DSPACCNAME`/`DSPACCINFO`. Each report gets its own parser in
`src/db.ts`/`src/tools.ts`, not one generic flattener — a real design
constraint discovered by inspecting live data, not a stylistic choice.

`vat_summary`/`gst_summary` aren't from canned Tally reports at all —
Tally's own UAE VAT return ("Vat Return and Annexures") and India GST
returns aren't reachable via a plain Export Data request even with their
exact internal names, so both are reconstructed from ledger balances
instead, the same technique `profit_and_loss` uses. `category` is `input`/`output`/`rcm`/`other` — reverse-charge ledgers get their own `rcm` category
rather than being folded into `input`/`output`, since RCM liability is the thing that's easily
missed manually even though it nets to a wash for most businesses. `match_method` records
*how* each row was found — `structural` (Tally's own `TAXTYPE` ledger
field matches) or `name_pattern` (matched by ledger name). This isn't
redundant belt-and-braces: on two real companies, `TAXTYPE` alone was
precise but had near-zero recall — every ledger Tally
itself tagged had a zero balance, while every ledger actually carrying real
money was created without that tag set. Relying on `TAXTYPE` alone would
return a structurally correct but financially empty result, so both
signals are combined and neither is skipped.

## Example

```
sync_to_sql
sync_vouchers_to_sql: from=01-01-2024 to=31-03-2024
sync_vouchers_to_sql: from=01-04-2024 to=30-06-2024
query_sql: SELECT voucher_type, COUNT(*), SUM(amount) FROM vouchers
           GROUP BY voucher_type ORDER BY 2 DESC
```

For the six automatic tables, no sync call is needed — just call the
report tool once, then query it:

```
get_profit_and_loss: from=01-01-2024 to=31-12-2024
query_sql: SELECT group_name, SUM(closing_balance) FROM profit_and_loss
           GROUP BY group_name ORDER BY 2 DESC

get_trial_balance: from=01-01-2024 to=31-12-2024
query_sql: SELECT SUM(debit_amount), SUM(credit_amount) FROM trial_balance
```

Splitting a combined ledger's balance apart by the vouchers that make it
up — e.g. a single "VAT 5%" ledger used for both sales (Output) and
purchases (Input) — needs `voucher_ledger_entries`, not `vouchers`:

```
sync_voucher_ledger_entries_to_sql: from=01-01-2024 to=31-12-2024
query_sql: SELECT voucher_type, SUM(amount) FROM voucher_ledger_entries
           WHERE ledger = 'VAT 5%' GROUP BY voucher_type
```

## Limitations

- **In-memory and session-only — deliberately, not just as a limitation of
  the underlying engine.** The cache is lost whenever the server process
  restarts, and no individual row records which Tally company it came from.
  Since one server instance can be pointed at many different client
  companies over time, persisting the cache across a company switch would
  risk silently mixing one client's numbers with another's. Rather than
  relying only on `set_company` to catch this (a company can also change in
  Tally's own UI, or be reset by a connector restart/update — neither of
  which `set_company` sees), every sync/query tool asks Tally which company
  is actually open right before touching the cache and compares that
  against what the cache was last synced/queried for. A mismatch — however
  it happened — empties every one of these tables (the manually-synced ones
  and the six automatic ones alike) first: `sync_*_to_sql` clears and then
  proceeds with the fresh sync, saying so in its return message; `query_sql`
  clears and refuses to run rather than silently answering from what's now
  a stale, wrong-company cache. This was hit live once already — see the
  note in [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — before this check
  existed.
- **`vouchers` only carries header-level detail.** No stock item or ledger
  line breakdown is cached there — use `get_vouchers` / `get_ledger_vouchers`
  for that, `sync_voucher_items_to_sql` for the inventory line items, or
  `sync_voucher_ledger_entries_to_sql` for the ledger lines (which ledger,
  how much) inside each voucher.
- **`qty`/`amount` in `voucher_items` are unsigned**, exactly as Tally stores
  them on the inventory entry — there is no single sign convention across
  voucher types. Use `is_deemed_positive` together with `voucher_type` to
  work out inward vs outward movement in a query.
- **Read-only.** `query_sql` rejects anything that isn't a single `SELECT`
  (see the `DDL_KEYWORDS` guard in `src/db.ts`) — it cannot be used to write
  back to Tally.
