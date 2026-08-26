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
| `ledgers` | `name`, `parent`, `closing_balance` | `sync_to_sql` (explicit) |
| `groups` | `name`, `parent` | `sync_to_sql` (explicit) |
| `stock_items` | `name`, `parent`, `closing_balance` | `sync_to_sql` (explicit) |
| `vouchers` | `guid`, `date`, `voucher_type`, `voucher_number`, `party_ledger`, `amount`, `narration` | `sync_vouchers_to_sql` (explicit) |
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

## Limitations

- **In-memory and session-only — deliberately, not just as a limitation of
  the underlying engine.** The cache is lost whenever the server process
  restarts, and it is **not company-aware**: no row records which Tally
  company it came from. Since one server instance can be pointed at many
  different client companies over time via `set_company`, persisting the
  cache across restarts (or across a company switch within one session)
  would risk silently mixing one client's numbers with another's. Re-sync
  after switching companies, and before answering any report that needs
  up-to-the-minute figures. The six automatic tables carry the same
  caveat — re-call the report tool after switching companies before
  querying it.
- **Vouchers only carry header-level detail.** No stock item or ledger line
  breakdown is cached — use `get_vouchers` / `get_ledger_vouchers` for that.
- **Read-only.** `query_sql` rejects anything that isn't a single `SELECT`
  (see the `DDL_KEYWORDS` guard in `src/db.ts`) — it cannot be used to write
  back to Tally.
