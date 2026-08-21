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

## Tables

| Table | Columns |
|---|---|
| `ledgers` | `name`, `parent`, `closing_balance` |
| `groups` | `name`, `parent` |
| `stock_items` | `name`, `parent`, `closing_balance` |
| `vouchers` | `guid`, `date`, `voucher_type`, `voucher_number`, `party_ledger`, `amount`, `narration` |

`vouchers` is only populated for date ranges you've explicitly pulled via
`sync_vouchers_to_sql` — it starts empty every session.

## Example

```
sync_to_sql
sync_vouchers_to_sql: from=01-01-2024 to=31-03-2024
sync_vouchers_to_sql: from=01-04-2024 to=30-06-2024
query_sql: SELECT voucher_type, COUNT(*), SUM(amount) FROM vouchers
           GROUP BY voucher_type ORDER BY 2 DESC
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
  up-to-the-minute figures.
- **Vouchers only carry header-level detail.** No stock item or ledger line
  breakdown is cached — use `get_vouchers` / `get_ledger_vouchers` for that.
- **Read-only.** `query_sql` rejects anything that isn't a single `SELECT`
  (see the `DDL_KEYWORDS` guard in `src/db.ts`) — it cannot be used to write
  back to Tally.
