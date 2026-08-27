# Troubleshooting & FAQ

Every item below has been verified against a real TallyPrime instance,
or is explicitly marked as extrapolated/unverified. If you hit something not
listed here, check [docs/TOOLS.md](TOOLS.md) for the specific tool's own
notes first — this doc covers cross-cutting issues that aren't obvious from
a single tool's description.

## Quick FAQ

**Does this modify my Tally data directly, or just draft something for review?**
Directly. Every `create_*`/`update_*`/`delete_*` tool sends a real Import
Data request to TallyPrime the moment it's called — there's no draft/preview
step. Use `TALLY_PERMISSION_MODE=read_only` (see
[Audit trail & permission scoping](#audit-trail--permission-scoping) below)
if you want to hand this to an agent without letting it write anything.

**Is my Tally data sent anywhere outside my machine/network?**
No. In the default (stdio) mode, this runs as a local process talking to
`TALLY_URL` (`http://localhost:9000` by default) — nothing leaves your
machine. The HTTP mode ([docs/HTTP_DEPLOYMENT.md](HTTP_DEPLOYMENT.md)) is
opt-in and still only proxies to whatever `TALLY_URL` you configure.

**Can I point this at more than one company?**
Yes, via `set_company` — but only among companies already open in Tally
(File → Select Company first). It's global state, not per-call: switching
company/period affects every other caller using the same Tally instance.

**Can I run this alongside another Tally MCP connector, or on a shared server with other Tally users?**
Yes, but each needs its **own gateway port** — see
[Port conflicts on a shared server](#port-conflicts-on-a-shared-server) below.

**A write call returned success (`CREATED:1`) — how do I know it actually did what I asked, not something else?**
Check `get_audit_log` (records exact args + outcome for every call) and
independently verify in Tally itself — `get_stock_summary`, `get_ledgers`,
or opening the voucher in Tally's UI. `CREATED:1`/`EXCEPTIONS:0` means Tally
accepted the XML structurally; it does not guarantee the business result you
intended (see the additional-cost note below for a concrete example of
"succeeded" not meaning what it looks like).

**What Tally version/edition does this need?**
TallyPrime with the HTTP XML gateway enabled (`F1 → Settings → Connectivity`).
Not tested against Tally.ERP 9 specifically, though the XML shapes are
largely shared.

## Connection issues

### "Could not reach TallyPrime at http://localhost:9000"
Tally isn't running, or the gateway isn't enabled. `F1 → Settings →
Connectivity → Client/Server configuration` → set **TallyPrime acts as** to
`Both` or `Server`.

### "Tally returned an empty response"
Tally is running and the gateway is reachable, but **no company is open**.
Open one (File → Select Company) and retry.

### "Tally responded but reports no company open" / raw `Could not find Company ''`
This is different from the empty-response case above — Tally
*did* respond, but the specific `tally.exe` process bound to `TALLY_URL`'s
port has no company loaded, even though you can see a company open on
screen. This means **a different Tally process** — not the one you're
looking at — is holding that port. Common on a shared/terminal server with
multiple users, or a stale Tally window left running in the background.
Restarting *your* Tally window won't fix this if the stale process is a
separate one still holding the port.

To fix:
```powershell
Get-NetTCPConnection -LocalPort 9000 | Select-Object OwningProcess
Get-Process -Id <OwningProcess> | Select-Object Id, ProcessName, MainWindowTitle, SessionId
```
A process with no `MainWindowTitle` and a different `SessionId` than yours
is almost certainly the stale one. Either end that specific process (only if
you're sure it isn't someone else's active session — **never** mass-kill
every `tally.exe` on a shared server), or move your own company's gateway to
a different port (`F1 → Settings → Connectivity`) and update `TALLY_URL` to
match.

### Port conflicts on a shared server
Port 9000 is Tally's own default, and this connector's default too — on a
machine with multiple Tally users/connectors, only one process can bind a
given port; whoever grabbed it first "wins," and it may not be the
company/session you're looking at. If you're setting this up on a shared
server:
1. Check what's already listening on 9000 (see the PowerShell snippet above).
2. If it's someone else's active session, open your own company's gateway on
   a different port (e.g. `9001`) instead of touching theirs.
3. Set `TALLY_URL` (in `manifest.json`'s `mcp_config.env`, or wherever your
   MCP client lets you configure this server's environment) to match.

## Writes that "succeed" but nothing visible happens

### `CREATED:0`, `EXCEPTIONS:1`, no error text at all
This is the hardest failure mode — Tally's gateway gives zero explanation.
The most common cause: **the company has godown/batch
tracking enabled, and an inventory voucher line was sent without a
`godown`.** `create_stock_journal`, `create_physical_stock`, and the
item-invoice tools all treat `godown` as optional in the schema, but if the
company enforces location tracking, Tally silently refuses the whole
voucher rather than defaulting to a "Main Location." Fix: pass `godown` on
every line for companies with location tracking on. There is no way to
detect this from the API response alone — if you hit a blank `EXCEPTIONS:1`,
try again with an explicit godown before assuming something else is wrong.

### `EXCEPTIONS:1` with `LINEERROR: "Voucher date is missing"` — the date is outside Tally's active period
Confirmed live: Tally's XML gateway rejects a voucher whose date falls
outside the "Current Period" set in Tally (`Alt+F2` in the UI, or this
connector's `set_period`) with the misleading message "Voucher date is
missing", even though the `DATE` tag in the XML is present and correctly
formatted. This happens for Material In/Out, Rejections In/Out, Delivery
Note, and Receipt Note in particular — Sales/Purchase invoices and
Order-class vouchers (Sales Order, Purchase Order, etc.) were not observed
to hit this check the same way. Reproduced independently in Tally's own UI
(manually creating the voucher gives the identical "Voucher date is
missing" message), so this is a genuine Tally behavior, not an API quirk.
**Fix:** call `set_period` with a range covering the voucher's date before
creating it — e.g. after restarting Tally, the active period can reset to
the company's default financial year and silently exclude dates you were
using earlier in the same session.

Note: fixing the period resolved this for Material In/Out, Rejections
In/Out, and Receipt Note. Delivery Note kept failing with the identical
error afterward, on a date that worked for every other type including its
own buying-side mirror (Receipt Note) — confirmed reproducible manually in
Tally's own UI, so this is a separate, real, unresolved issue specific to
Delivery Note in that company, not something `set_period` fixes. If
`create_delivery_note`/`update_delivery_note` fail with this same error
after confirming the period is right, that's this issue, not a new one.

### Item-invoice voucher types (Sales/Purchase/Credit Note/Debit Note) stop auto-numbering
Some Tally configurations (seen after a **Company Data →
Rewrite** in at least one case) stop assigning voucher numbers to
item-invoice-mode voucher types through the XML gateway specifically — the
real error ("Voucher No. is missing") only shows in Tally's own Import Data
UI, never in the gateway's response. Symptom: blank `EXCEPTIONS:1` on every
create call. Fix: pass `voucherNumber` explicitly (check `get_vouchers` for
the next free number of that voucher type) on every create call for that
voucher type going forward.

### A brand-new custom voucher type accepts vouchers with **no voucher number at all**
`create_voucher_type` without an explicit `numberingMethod`
can leave the new type accepting vouchers with a completely blank number —
not `"1"`, not anything referenceable. You can still delete/alter such a
voucher by passing an empty string as `voucherNumber`, but you can't
otherwise look it up by number. Always pass `numberingMethod: "Automatic"`
explicitly when creating a voucher type you intend to post multiple vouchers
against (e.g. a Manufacturing Journal type via `useAsManufacturingJournal`).

### `create_physical_stock` corrupted stock quantities on versions before this fix
**If you used `create_physical_stock`/`update_physical_stock` before this
note was added, check the resulting stock item's closing balance in Tally —
it may be wrong.** An earlier version of this template used
`ISDEEMEDPOSITIVE=No` plus a per-line `ISPHYSICALQTYENTERED` flag that
doesn't actually control this behavior — the real result was the item's
reported closing balance flipping to a nonsensical negative number instead
of the counted quantity (e.g. counting 95 against a book balance of 102
produced a closing balance of `-100`, not `95`). Rebuilt against a genuine
Tally-exported XML template (`DIFFACTUALQTY=Yes` at the voucher level,
`ISDEEMEDPOSITIVE=Yes`, no `RATE`/`AMOUNT`/`BILLEDQTY` at all) and
re-verified: counting 95 of an item with 100 in stock now
closes it at 95. If a stock item's balance looks wrong after a physical
count made with an older version, recheck it and correct with a fresh
`create_physical_stock` call or manually in Tally.

### `additionalCosts` on a Stock/Manufacturing Journal doesn't change the ledger's balance
This is expected, not a bug — verified twice (once via direct API
testing, once by cross-checking a manually-created voucher's own exported
JSON). The named ledger's balance genuinely does not move. `additionalCosts`
is a costing/valuation instruction, telling Tally's stock reports to fold
that amount into the produced item's effective cost — it is **not** a real
accounting transaction. If labour/freight was actually paid, record that
separately with `create_voucher`.

### `create_unit` fails with "Master name contains invalid characters"
A simple unit's symbol can't contain whitespace (e.g.
`"Box Unit"` is rejected, `"Box"` isn't). This tool now checks client-side
and throws a clear error before the call ever reaches Tally — if you still
hit Tally's own raw version of this message, it means the name came from
somewhere else (e.g. `extraFields` on another master). A compound unit's own
display name (the `symbol` argument when `baseUnit` is set, e.g. `"Box of
12 Nos"`) is unaffected and can contain spaces — only the simple units it
*references* (`baseUnit`/`additionalUnit`) need to be space-free.

## Deleting things

### `delete_master` returns `LINEERROR: "Cannot be deleted!"` on a stock item/ledger with zero transactions
A ledger or stock item used in **both** a Sales-side and a
Purchase-side item-invoice (Sales + Purchase, or Credit Note + Debit Note)
can get stuck permanently reporting "Cannot be deleted!" via the API even
after every referencing voucher is gone. This is not a real permanent lock —
running **Company Data → Rewrite** inside Tally itself clears it. Retrying
the delete call does not help; only the Rewrite does.

### Deleting a voucher and a master it referenced, in the same batch
Deleting a voucher and then immediately deleting a master
that voucher referenced, in the same parallel batch, can race — the master
delete reaching Tally before the voucher delete has actually committed,
causing it to fail. Delete the voucher first, confirm the response, *then*
delete the master.

### Deleting/altering hit the wrong voucher
See [Voucher type collision](#voucher-type-collision) below — this is a
lookup ambiguity, not a delete-specific bug, and every `update_*`/
`delete_voucher` tool now refuses rather than risk it.

## Voucher matching & safety

### Voucher type collision
Tally's Alter/Delete lookup (`TAGNAME="Voucher Number"`/`TAGVALUE`) matches
by **date + voucher number only** — the voucher type you pass is not used to
scope the match, even though each type numbers independently (a Sales #4 and
a Purchase #4 can both legitimately exist on the same date). In practice,
this silently altered/renumbered an unrelated voucher of a different type
that happened to share the same number and date, with no error. Every
`update_*` tool and `delete_voucher` now calls an internal
`assertVoucherUnambiguous` check first and **refuses** if a collision exists
— resolve it in Tally (renumber one of them) rather than looking for a way
around the refusal.

## Naming & exact-match rules

- Every name (`PARENT`, `LEDGERNAME`, `STOCKITEMNAME`, godown/unit names,
  etc.) must match what exists in Tally **exactly**, including case and
  whitespace. There's no fuzzy matching anywhere in the XML gateway.
- `create_godown`'s `parent` must be the parent's plain name, not a dotted
  path — `"MAIN LOCATION.DUBAI"` is rejected,
  `parent: "MAIN LOCATION"` + `name: "DUBAI"` is correct.
- `create_group`/`create_stock_item`'s `group: "Primary"` maps to an empty
  `<PARENT>` tag internally — Tally rejects the literal string "Primary" as
  a real group name, so this substitution is required, not cosmetic.

## Audit trail & permission scoping

- Every tool call — read or write — is appended to a local JSONL file
  (`TALLY_AUDIT_LOG_PATH`, default `audit.log.jsonl` next to the installed
  package), tagged with a best-effort Tally company name. Read it back with
  `get_audit_log` (`limit?`, `toolFilter?`, `company?`, `format?`).
- Entries older than 90 days are permanently deleted — checked once when
  the server process starts, and again on any write once the file passes
  50MB. If you need history beyond 90 days, copy the file elsewhere before
  that point; there's no built-in archive.
- Set `TALLY_PERMISSION_MODE=read_only` (or, via Claude Desktop's Extensions
  settings screen, turn on "Read-only mode") to block every write tool
  before it reaches Tally — the denial itself is also logged
  (`outcome: "denied"`).
- Set `TALLY_DISABLED_TOOLS` (comma-separated exact tool names, e.g.
  `delete_voucher,delete_master`, or the "Disabled tools" field in the
  Extensions settings screen) to block specific tools regardless of mode.
- **Changing the Read-only mode toggle or Disabled tools field in Claude
  Desktop's Extensions settings does NOT take effect until you fully quit
  and reopen Claude Desktop.** Saving the settings screen is
  not enough — verified by making a write call immediately after toggling
  read-only mode on (it succeeded, unblocked) versus after a full restart
  (it was denied). This connector reads its config once at
  process startup; there's no live-reload mechanism.
- A logging failure (disk full, permissions) never blocks the underlying
  Tally operation — it's swallowed silently rather than surfaced, by design.

## SQL cache (`sync_to_sql` / `sync_vouchers_to_sql` / `query_sql`)

- The cache is **in-memory and session-scoped only** — gone as soon as the
  server process exits, no disk persistence.
- It doesn't track which company a cached row came from. If you switch
  companies via `set_company`, re-sync before querying again — don't run
  `query_sql` against a cache that spans a company switch.
- `sync_vouchers_to_sql` only pulls headers (date, type, number, party,
  amount, narration) — no line items. For a busy company, sync in chunks
  (quarterly/monthly) rather than a full year at once, to stay under the
  10s request timeout.

### A port responds but isn't actually TallyPrime's gateway
**Tally's own license server (commonly port 9999) answers
HTTP requests with an HTML status page** — if you accidentally point
`TALLY_URL` at it, a naive "did the request succeed" check says yes, when
nothing about it is the actual XML gateway. `get_health_check` specifically
checks the *shape* of the response (rejects an HTML page, not just any
non-200 status) rather than trusting a bare connection success — use it
first when debugging "is this even the right port" instead of a raw
`get_company_info` call, whose failure mode here would be a confusing
JSON-parse-of-garbage result rather than a clear answer.

## Report names that don't work via a plain Export Data request

Not every report visible in Tally's UI is reachable this way, and some
outright unreachable ones are worse than a clean error — they hang Tally's
whole gateway (confirmed live, twice) until the resulting error dialog is
manually dismissed *inside Tally's own window*, not just at the HTTP layer.
If you're exploring a new report name, check it against Tally's own
`Collection TYPE=Report` introspection query first (lists every registered
report name) rather than guessing strings — a name that isn't in that list
at all is far more likely to hang than one that is but still isn't
independently invokable.

Confirmed **unreachable, but fails cleanly** (a normal "Could not find
Report" error, not a hang): `Cash Book`, `Bank Book`, `Cash Books`,
`Bank Books` (plural — registered in Tally's Report collection, but not
independently invokable this way), `Batch Godown Summary`,
`Location-Wise Summary`, `Stock Item Monthly Details`, `Movement Analysis`,
`Stock Ageing Analysis`, `Ageing Analysis`, `Receipt Register`,
`Job Work Order Details`, `Job Work Registers`, `Job Work Stock`,
`Order Vouchers`, `Order Details`. `get_receipts_and_payments` and
`get_ledger_vouchers` are the closest reachable substitutes for the
Cash/Bank Book pair — see their tool descriptions.

Confirmed **unreachable and hangs the gateway** (needs the resulting Tally
dialog dismissed manually before the connector responds again):
`Stock Ageing`, `Age wise`, `Godowns Summary`, `Location Summary`,
`Receipt & Payment` (singular). Avoid retrying any of these.

`Movement Analysis`, `Stock Ageing Analysis`, `Godown Summary`, and
`Stock Query` genuinely aren't reachable as standalone reports at all —
building them would need collection-based reconstruction (the same
technique `get_stock_summary` and the VAT/GST tools use), not a report
name, and hasn't been attempted yet.

## `get_vouchers` used to ignore its own date range (fixed)

`get_vouchers` was originally built on Tally's canned "Day Book"
REPORTNAME (`reportXml("Day Book", ...)`). Confirmed live: it silently
ignored `SVFROMDATE`/`SVTODATE` entirely — the same fixed set of vouchers
came back regardless of the requested range, including a date a year
before the company's books even start. This was discovered while
investigating a separate report that a Delivery Note/Receipt Note created
via this connector didn't show up in `get_vouchers` — the real cause
turned out to be this date-range bug, not anything specific to those two
voucher types.

Fixed by rebuilding `get_vouchers` on the same Voucher collection query
`sync_vouchers_to_sql` already uses and trusts (a `TYPE=Collection`/
`TYPE=Voucher` query with `SVFROMDATE`/`SVTODATE`, not a canned
`REPORTNAME`) — confirmed live this correctly scopes to the requested
range (0 results for a year with no vouchers, the right count for a single
month, 7608 for the full year vs. the old broken tool's fixed 105).

**Likely root cause:** Tally's currently active **Period** (F2 in the UI,
or whatever `set_period` last set) can constrain what a canned `REPORTNAME`
report returns, independent of the `SVFROMDATE`/`SVTODATE` passed in the
request — a `TYPE=Collection` query, like the one `get_vouchers` now uses,
doesn't have this dependency (confirmed: it correctly returned 0 for 2023
even though Milan Plus's active period was FY2024).

This raised a real question about the other 9 report tools built the same
session (`get_cash_flow`, `get_funds_flow`, `get_ratio_analysis`,
`get_sales_register`, `get_purchase_register`, `get_journal_register`,
`get_payment_register`, `get_receipts_and_payments`, `get_reorder_status`)
— they all still use the same canned-`REPORTNAME` mechanism the broken Day
Book used, and had only been checked with date ranges *inside* the
currently active period. Checked live: requesting 2023 (fully outside
Milan Plus's active FY2024 period) on each of the 8 period-based ones
correctly returned genuinely null/empty data, distinct from their 2024
results — not the "same fixed wrong answer regardless of range" pattern
Day Book had. `get_reorder_status` returned identical results for 2023 and
2024, but that's expected and correct: it's a point-in-time stock snapshot
(current quantity vs. configured reorder level), not a period-transaction
report, so it has no reason to vary with the requested range at all. None
of the 9 have Day Book's bug. `get_balance_sheet`, `get_trial_balance`,
`get_bills_receivable`, and `get_bills_payable` (pre-existing, not built
this session) haven't been re-checked against an out-of-period range —
worth the same test if one of them is ever suspected of returning stale
data across a period boundary.

Now that `get_vouchers` is fixed, `delete_voucher` also correctly finds a
Delivery Note/Receipt Note once its voucher type is active in the company
(confirmed live) — see `create_delivery_note`'s own tool description for
that remaining prerequisite. `get_ledger_vouchers` will still never show
either voucher type, but that's by design (it deliberately excludes
inventory-classified vouchers), not a gap.

## Verified-live tools

`update_material_in`, `update_material_out`, `update_rejections_in`,
`update_rejections_out`, `update_receipt_note`, `update_sales_order`,
`update_purchase_order`, `update_sales_quotation`,
`update_job_work_in_order`, and `update_job_work_out_order` were each
confirmed live end to end (create a real test voucher, then update it,
then confirm `ALTERED:1`) once the active-period issue above was
identified and fixed. `update_delivery_note` is built the same way and is
structurally identical to the verified `update_receipt_note`, but is
currently blocked from live verification by the separate Delivery Note
issue noted above.

`set_bill_of_materials`, `create_material_in`, `create_material_out`,
`create_rejections_in`, and `create_rejections_out` were originally built
from real Tally-exported XML templates or by direct analogy to other
proven-safe voucher shapes, and have since been live-verified: each
moves stock by the expected quantity, and `create_material_in`/
`create_material_out`'s party-ledger amount is confirmed to genuinely not
balance against the inventory legs (job-work memorandum tracking, not a
real Dr/Cr pair) — don't mistake this for a bug if the numbers don't net to
zero the way a normal voucher would.

`set_bill_of_materials`'s `natureOfItem` values (`Component`, `Co-Product`,
`By-Product`, `Scrap`) were each checked against Tally's own BoM screen
("Set Components (BoM)" → click into a component line) — all four map to
the matching "Type of Item" label there. That screen (and its "Type of
Item" column) only appears once the company has "Set Components List
(Bill of Materials) in Stock Items" turned on — Alter Stock Item → F12 →
that setting → Yes. The underlying write succeeds either way; without
that setting on, Tally's UI just won't show a Components field to look
at it with.

**Job Work In/Out Order vouchers were deliberately not built** — no
verified real-world XML example was found, and there's no existing
"Order"-type voucher tool in this project to model the due-date/lot
structure from. Guessing that structure blind risked shipping something
broken rather than just incomplete.

## Extension install issues

**Clicking "Install Extension" and picking the `.mcpb` produces no dialog, no error, just the same screen.**
Inconsistent behavior seen on some Claude Desktop builds. Check
`%APPDATA%\Claude\logs\main.log` for a fresh `Handling DXT/MCPB file: <path>`
line right after your attempt:
```powershell
Select-String "Handling DXT/MCPB file" "$env:APPDATA\Claude\logs\main.log" | Select-Object -Last 5
```
- Logged but nothing else happens: a confirmation dialog may be rendering
  off-screen (rare, multi-monitor/remote-desktop setups) — check other
  windows.
- Not logged at all: use **Install Unpacked Extension** on the same
  Extensions → Advanced settings screen instead. Download the "Source code
  (zip)" from the
  [latest release](https://github.com/lokesh-sparrow/PNPC-MCP-Tally-Prime/releases/latest),
  extract it, and point the picker at that folder.
