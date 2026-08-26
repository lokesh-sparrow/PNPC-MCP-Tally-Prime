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

## Verified-live tools with one remaining open question

`set_bill_of_materials`, `create_material_in`, `create_material_out`,
`create_rejections_in`, and `create_rejections_out` were originally built
from real Tally-exported XML templates or by direct analogy to other
proven-safe voucher shapes, and have since been live-verified: each
moves stock by the expected quantity, and `create_material_in`/
`create_material_out`'s party-ledger amount is confirmed to genuinely not
balance against the inventory legs (job-work memorandum tracking, not a
real Dr/Cr pair) — don't mistake this for a bug if the numbers don't net to
zero the way a normal voucher would.

One thing remains genuinely unverified: `set_bill_of_materials`'s
`natureOfItem` accepted values — check the resulting BOM in Tally's own UI
if you pass this field.

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
