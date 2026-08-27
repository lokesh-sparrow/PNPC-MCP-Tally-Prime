# tally-doc-import (Claude Skill)

Turns a folder of a client's paperwork — invoices, purchase bills, bank
statements, credit/debit notes — into TallyPrime vouchers, via
PNPC-MCP-Tally-Prime's own tools. See [SKILL.md](SKILL.md) for the full
procedure Claude follows; this file is just install/setup.

**Requires PNPC-MCP-Tally-Prime itself already installed and connected to
TallyPrime** — see the [main README](../README.md). This skill is a
*procedure* Claude follows on top of that connector; it has no connection
to Tally of its own.

## What's in here

- [`SKILL.md`](SKILL.md) — the procedure: read documents, classify, resolve
  ledgers, draft every voucher through `preview_write`, one batch review,
  confirm only what's approved.
- [`references/voucher-mapping.md`](references/voucher-mapping.md) — a
  worked example (exact tool call, exact arguments) for every document
  type this skill handles.
- [`references/gst-and-ledgers.md`](references/gst-and-ledgers.md) —
  ledger-naming and parent-group conventions, and the UAE VAT vs. India
  GST distinction.
- [`scripts/xlsx_to_csv.py`](scripts/xlsx_to_csv.py) — converts an `.xlsx`
  sheet to plain-text CSV so Claude can read it (Claude reads PDFs/images/
  CSV natively, but not binary spreadsheet formats). Standard-library-only
  Python 3 — no `pip install` needed. This is the **only** place Python is
  needed anywhere in this connector; if you're not using this skill's
  XLSX-reading step, you never need Python at all.

## Installing

How you load a Skill depends on which Claude surface you're using —
Claude Desktop, Cowork, and Claude Code each have their own mechanism, and
that mechanism changes over time. Point Claude at this `skills/tally-doc-import/`
folder (or this whole repo) through whatever your client's current
"add a skill" / "import a skill" flow is, and it'll pick up `SKILL.md`
from there.

If your client's flow expects a single packaged file rather than a folder,
zip this directory's contents (not the directory itself — `SKILL.md`
should be at the zip's root) and use that.

## Try it safely first

Point this at a **throwaway/test Tally company**, never real client books,
the first time. Everything it drafts goes through `preview_write` and
waits for your explicit review and `confirm_write` before anything posts —
but reviewing that behavior on test data first, before trusting it on a
real client's period, costs nothing and catches any surprise early.
