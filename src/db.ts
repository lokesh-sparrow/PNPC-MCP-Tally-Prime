import { PGlite } from "@electric-sql/pglite";
import { tallyRequest, buildCollectionXml, CollectionField } from "./tally.js";
import { extractRecords } from "./clean.js";
import { render } from "./templates.js";

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toTallyActionDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split("-");
  return `${parseInt(dd, 10)}-${MONTH_ABBR[parseInt(mm, 10) - 1]}-${yyyy}`;
}

function toIsoDate(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split("-");
  return `${yyyy}-${mm}-${dd}`;
}

// Tally returns voucher dates like "1-Jan-24" (D-Mon-YY) regardless of input format.
function parseTallyDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/.exec(s.trim());
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const monthIdx = MONTH_ABBR.findIndex((abbr) => abbr.toLowerCase() === m[2].toLowerCase());
  if (monthIdx < 0) return null;
  const month = String(monthIdx + 1).padStart(2, "0");
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${year}-${month}-${day}`;
}

// In-memory Postgres (WASM), scoped to this session only. A consultant using
// this against many different client companies should not have one
// company's cached vouchers silently outlive the session and mix with the
// next company's — starting fresh each session avoids that, and clearCache()
// (called from set_company) avoids the same mixing within a single session
// that switches companies partway through.
const db = new PGlite();
let schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.exec(`
      CREATE TABLE IF NOT EXISTS ledgers (
        name TEXT PRIMARY KEY,
        parent TEXT,
        closing_balance NUMERIC,
        trn TEXT,
        state TEXT,
        country TEXT
      );
      CREATE TABLE IF NOT EXISTS groups (
        name TEXT PRIMARY KEY,
        parent TEXT
      );
      CREATE TABLE IF NOT EXISTS stock_items (
        name TEXT PRIMARY KEY,
        parent TEXT,
        closing_balance NUMERIC
      );
      CREATE TABLE IF NOT EXISTS vouchers (
        guid TEXT PRIMARY KEY,
        date DATE,
        voucher_type TEXT,
        voucher_number TEXT,
        party_ledger TEXT,
        amount NUMERIC,
        narration TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_vouchers_date ON vouchers(date);
      CREATE INDEX IF NOT EXISTS idx_vouchers_type ON vouchers(voucher_type);
      CREATE INDEX IF NOT EXISTS idx_vouchers_party ON vouchers(party_ledger);
      CREATE TABLE IF NOT EXISTS profit_and_loss (
        ledger_name TEXT,
        group_name TEXT,
        closing_balance NUMERIC,
        period_from DATE,
        period_to DATE
      );
      CREATE TABLE IF NOT EXISTS stock_summary (
        name TEXT,
        parent TEXT,
        opening_qty NUMERIC,
        closing_qty NUMERIC,
        opening_value NUMERIC,
        closing_value NUMERIC,
        as_of_date DATE
      );
      CREATE TABLE IF NOT EXISTS balance_sheet (
        group_name TEXT,
        amount NUMERIC,
        as_of_date DATE
      );
      CREATE TABLE IF NOT EXISTS trial_balance (
        name TEXT,
        debit_amount NUMERIC,
        credit_amount NUMERIC,
        period_from DATE,
        period_to DATE
      );
      CREATE TABLE IF NOT EXISTS vat_summary (
        ledger_name TEXT,
        category TEXT,
        match_method TEXT,
        closing_balance NUMERIC,
        period_from DATE,
        period_to DATE
      );
      CREATE TABLE IF NOT EXISTS gst_summary (
        ledger_name TEXT,
        category TEXT,
        match_method TEXT,
        closing_balance NUMERIC,
        period_from DATE,
        period_to DATE
      );
      CREATE TABLE IF NOT EXISTS voucher_items (
        id SERIAL PRIMARY KEY,
        voucher_guid TEXT,
        date DATE,
        voucher_type TEXT,
        voucher_number TEXT,
        stock_item TEXT,
        qty NUMERIC,
        rate TEXT,
        amount NUMERIC,
        is_deemed_positive BOOLEAN,
        godown TEXT,
        batch TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_voucher_items_date ON voucher_items(date);
      CREATE INDEX IF NOT EXISTS idx_voucher_items_stock_item ON voucher_items(stock_item);
      CREATE INDEX IF NOT EXISTS idx_voucher_items_godown ON voucher_items(godown);
      CREATE TABLE IF NOT EXISTS voucher_ledger_entries (
        id SERIAL PRIMARY KEY,
        voucher_guid TEXT,
        date DATE,
        voucher_type TEXT,
        voucher_number TEXT,
        ledger TEXT,
        amount NUMERIC,
        is_deemed_positive BOOLEAN,
        cost_centre TEXT,
        bill_name TEXT,
        bill_type TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_vle_date ON voucher_ledger_entries(date);
      CREATE INDEX IF NOT EXISTS idx_vle_ledger ON voucher_ledger_entries(ledger);
      CREATE INDEX IF NOT EXISTS idx_vle_voucher_type ON voucher_ledger_entries(voucher_type);
    `).then(() => undefined);
  }
  await schemaReady;
}

// Drops every row from every cached table without dropping the tables
// themselves (ensureSchema's CREATE TABLE IF NOT EXISTS would otherwise
// leave them empty-but-present anyway, but TRUNCATE is the correct verb for
// "same shape, no data"). Call this whenever the active Tally company
// changes — none of these tables track which company their rows came from
// (confirmed live: they don't even carry a company column), so a session
// that queries one company and then switches to another must not go on
// serving the first company's rows under the new company's name.
export async function clearCache(): Promise<void> {
  if (!schemaReady) return; // schema was never created, nothing to clear
  await schemaReady;
  await db.exec(`
    TRUNCATE TABLE ledgers, groups, stock_items, vouchers, voucher_items,
      voucher_ledger_entries, profit_and_loss, stock_summary, balance_sheet,
      trial_balance, vat_summary, gst_summary;
  `);
}

// Tracks which Tally company the cache currently holds data for — updated at
// every successful cache write via ensureCacheCompanyMatch below, null until
// the first one this session. Not a DB column because nothing here needs to
// survive a session restart; a module variable is enough to compare against.
let cachedCompanyName: string | null = null;

// Told explicitly by set_company right after it clears the cache, so this
// module's own notion of "which company the cache is for" doesn't lag a call
// behind — harmless either way (the next sync/query below would self-correct
// at the cost of one redundant TRUNCATE on an already-empty cache), but this
// keeps the two in sync immediately instead of on the next opportunistic
// check.
export function setKnownCompany(name: string): void {
  cachedCompanyName = name;
}

// Tally's gateway has no notion of "who is asking" or "what did the
// connector expect" — it just answers with whatever company is currently
// open, however it got switched there (this tool's own set_company, Tally's
// UI directly, or a connector restart resetting which company Tally reopens
// on). Re-asks Tally what's actually open right now, the same way
// set_company's own post-switch check does.
async function getActiveCompanyName(): Promise<string | null> {
  const xml = buildCollectionXml(
    "Company",
    [{ name: "NAME" }],
    [{ name: "OnlyCurrent", expression: "$$IsEqual:$Name:##SVCurrentCompany" }]
  );
  const rows = extractRecords(await tallyRequest(xml)) as { NAME?: string }[];
  return rows[0]?.NAME ? String(rows[0].NAME) : null;
}

// Every cache write and read is gated through this. Detects a company
// change since the last cache write — regardless of how the switch
// happened — and truncates the now-mismatched cache before it can be read
// as if it still belonged to the new company.
//
// Hit live on 2026-09-11: a connector update left Tally on "Classic
// Catering LLC (2020)" mid-way through work on Milan Plus Equestrian
// Equipment LLC, and four sync_voucher_ledger_entries_to_sql calls silently
// loaded ~19,500 Classic Catering rows that looked like plausible Milan
// Plus data — only caught by a manual get_company_info check. Wrong-company
// data that looks plausible is worse than an error, since it produces
// confident, wrong client tax figures. This makes that check automatic on
// every cache write/read instead of something a human has to remember, and
// every sync's own return message now names the company it actually synced
// so the mismatch is visible without a separate check.
async function ensureCacheCompanyMatch(): Promise<{ companyName: string; wasCleared: boolean; previousCompany: string | null }> {
  await ensureSchema();
  const actual = await getActiveCompanyName();
  if (!actual) {
    throw new Error(
      "Could not determine which company is currently open in Tally — refusing to sync or query the cache " +
        "until this is resolved (check get_health_check)."
    );
  }
  const previousCompany = cachedCompanyName;
  const wasCleared = previousCompany !== null && previousCompany !== actual;
  if (wasCleared) {
    await clearCache();
  }
  cachedCompanyName = actual;
  return { companyName: actual, wasCleared, previousCompany };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

async function fetchCollection(
  type: string,
  fields: CollectionField[]
): Promise<Record<string, unknown>[]> {
  const xml = buildCollectionXml(type, fields);
  const parsed = await tallyRequest(xml);
  return extractRecords(parsed) as Record<string, unknown>[];
}

// Pulls ledgers, groups, and stock items from Tally into this session's SQL
// cache, replacing whatever was there before (use sync_vouchers_to_sql for
// voucher headers, which are additive by date range instead).
// Appended to a sync's success message only when ensureCacheCompanyMatch
// actually found and cleared a stale other-company cache — silent otherwise,
// so the common case (same company as last time) doesn't grow noisy.
function companyChangeNote(wasCleared: boolean, previousCompany: string | null, companyName: string): string {
  return wasCleared
    ? ` Note: Tally's active company changed since the last sync (was "${previousCompany}", now "${companyName}") — the previous cache was cleared first to avoid mixing data from different companies.`
    : "";
}

export async function syncAll(): Promise<string> {
  const { companyName, wasCleared, previousCompany } = await ensureCacheCompanyMatch();

  const [ledgers, groups, stockItems] = await Promise.all([
    fetchCollection("Ledger", [
      { name: "NAME" },
      { name: "PARENT" },
      { name: "CLOSINGBALANCE", datatype: "amount" },
      { name: "VATTINNUMBER" },
      { name: "STATE", expression: "$LedStateName" },
      { name: "COUNTRY", expression: "$CountryName" },
    ]),
    fetchCollection("Group", [{ name: "NAME" }, { name: "PARENT" }]),
    fetchCollection("Stock Item", [{ name: "NAME" }, { name: "PARENT" }, { name: "CLOSINGBALANCE", datatype: "quantity" }]),
  ]);

  await db.exec("BEGIN");
  try {
    await db.exec("DELETE FROM ledgers");
    for (const l of ledgers) {
      await db.query("INSERT INTO ledgers (name, parent, closing_balance, trn, state, country) VALUES ($1, $2, $3, $4, $5, $6)", [
        str(l.NAME),
        str(l.PARENT),
        num(l.CLOSINGBALANCE),
        str(l.VATTINNUMBER),
        str(l.STATE),
        str(l.COUNTRY),
      ]);
    }

    await db.exec("DELETE FROM groups");
    for (const g of groups) {
      await db.query("INSERT INTO groups (name, parent) VALUES ($1, $2)", [
        str(g.NAME),
        str(g.PARENT),
      ]);
    }

    await db.exec("DELETE FROM stock_items");
    for (const s of stockItems) {
      await db.query(
        "INSERT INTO stock_items (name, parent, closing_balance) VALUES ($1, $2, $3)",
        [str(s.NAME), str(s.PARENT), num(s.CLOSINGBALANCE)]
      );
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }

  return (
    `Synced ${ledgers.length} ledgers, ${groups.length} groups, ` +
    `${stockItems.length} stock items into the local SQL cache for company "${companyName}". ` +
    `Vouchers are not synced by this tool — use sync_vouchers_to_sql(from, to) for those, ` +
    `one date range at a time (quarterly is a safe chunk size for a busy company).` +
    companyChangeNote(wasCleared, previousCompany, companyName)
  );
}

function syncVouchersXml(fromDate: string, toDate: string): string {
  return render("sync-vouchers.xml.njk", { fromDate, toDate });
}

// Syncs voucher HEADERS (not line items) for one date range into the
// session-scoped cache (gone once this process exits — deliberately, so
// switching companies never leaves a prior client's data behind). Call once
// per chunk (e.g. per quarter) to build up full multi-year history without a
// single request large enough to risk Tally's gateway timing out —
// re-running for a range that was already synced replaces just that range.
export async function syncVouchers(from: string, to: string): Promise<string> {
  const { companyName, wasCleared, previousCompany } = await ensureCacheCompanyMatch();

  const xml = syncVouchersXml(toTallyActionDate(from), toTallyActionDate(to));
  const result = await tallyRequest(xml);
  const rows = extractRecords(result) as Record<string, unknown>[];

  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);

  await db.exec("BEGIN");
  try {
    await db.query("DELETE FROM vouchers WHERE date >= $1 AND date <= $2", [fromIso, toIso]);
    for (const v of rows) {
      const date = parseTallyDate(str(v.DATE) ?? "");
      if (!date) continue; // "Opening" rows and similar have no real voucher date/guid
      await db.query(
        `INSERT INTO vouchers (guid, date, voucher_type, voucher_number, party_ledger, amount, narration)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (guid) DO UPDATE SET
           date = EXCLUDED.date, voucher_type = EXCLUDED.voucher_type,
           voucher_number = EXCLUDED.voucher_number, party_ledger = EXCLUDED.party_ledger,
           amount = EXCLUDED.amount, narration = EXCLUDED.narration`,
        [str(v.GUID), date, str(v.VOUCHER_TYPE), str(v.VOUCHER_NUMBER), str(v.PARTY_LEDGER), num(v.AMOUNT), str(v.NARRATION)]
      );
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }

  return (
    `Synced ${rows.length} vouchers for ${from} to ${to} into this session's SQL cache for company "${companyName}" ` +
    `(cleared when this session ends — sync again next session, or after switching companies). ` +
    `Call again with other date ranges to build up full history for this session — ` +
    `each call only replaces vouchers within its own date range.` +
    companyChangeNote(wasCleared, previousCompany, companyName)
  );
}

function syncVoucherItemsXml(fromDate: string, toDate: string): string {
  return render("sync-voucher-items.xml.njk", { fromDate, toDate });
}

// Syncs voucher INVENTORY LINE ITEMS (stock item, qty, rate, amount, godown,
// batch) for one date range into the session-scoped cache — the raw material
// for movement/godown/ageing analysis, which is just a SQL query over this
// table (via query_sql) rather than a dedicated report tool. Tally has no
// exportable "Movement Analysis"/"Stock Ageing Analysis"/"Godown Summary"
// report reachable over the gateway (confirmed live: none of the 138
// registered report names for these export real data), and per-godown
// $ClosingBalance/SVGODOWNNAME scoping doesn't work either (confirmed live
// against a real test item with real stock in a real godown — both ignored
// the godown and returned the company-wide total). This walks each voucher's
// own AllInventoryEntries, then each entry's own BatchAllocations, via two
// levels of nested TDL EXPLODE — confirmed live safe (no hang) and correct
// (godown/batch only populate where actually set, verified against known
// ground truth). Same chunked, additive-by-date-range model as syncVouchers.
export async function syncVoucherItems(from: string, to: string): Promise<string> {
  const { companyName, wasCleared, previousCompany } = await ensureCacheCompanyMatch();

  const xml = syncVoucherItemsXml(toTallyActionDate(from), toTallyActionDate(to));
  const result = await tallyRequest(xml);
  const rows = extractRecords(result) as Record<string, unknown>[];

  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);

  let itemCount = 0;
  await db.exec("BEGIN");
  try {
    await db.query(
      "DELETE FROM voucher_items WHERE date >= $1 AND date <= $2",
      [fromIso, toIso]
    );
    for (const v of rows) {
      const date = parseTallyDate(str(v.DATE) ?? "");
      if (!date) continue;
      const rawItems = (v as any).ITEM;
      if (!rawItems) continue;
      const items = Array.isArray(rawItems) ? rawItems : [rawItems];
      for (const item of items) {
        const rawBatches = item.BATCH;
        const batches = rawBatches ? (Array.isArray(rawBatches) ? rawBatches : [rawBatches]) : [{}];
        for (const batch of batches) {
          itemCount++;
          await db.query(
            `INSERT INTO voucher_items
               (voucher_guid, date, voucher_type, voucher_number, stock_item, qty, rate, amount, is_deemed_positive, godown, batch)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              str(v.VOUCHER_GUID),
              date,
              str(v.VOUCHER_TYPE),
              str(v.VOUCHER_NUMBER),
              str(item.STOCK_ITEM),
              num(item.QTY),
              str(item.RATE),
              num(item.AMOUNT),
              item.IS_DEEMED_POSITIVE === 1 || item.IS_DEEMED_POSITIVE === "1",
              str(batch.GODOWN) || null,
              str(batch.BATCH) || null,
            ]
          );
        }
      }
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }

  return (
    `Synced ${itemCount} inventory line items (across ${rows.length} vouchers checked) for ${from} to ${to} ` +
    `into this session's SQL cache table 'voucher_items' for company "${companyName}" (cleared when this session ends). ` +
    `Query it directly for movement analysis (SUM(qty) grouped by stock_item/voucher_type/date), ` +
    `godown-wise stock (GROUP BY godown), or batch-level detail — there is no separate "report" tool for these, ` +
    `it's just SQL over this table via query_sql. Note: qty/amount are unsigned as Tally stores them — use ` +
    `is_deemed_positive and voucher_type together to determine inward vs outward direction for movement analysis.` +
    companyChangeNote(wasCleared, previousCompany, companyName)
  );
}

function syncVoucherLedgerEntriesXml(fromDate: string, toDate: string): string {
  return render("voucher-ledger-entries.xml.njk", { fromDate, toDate });
}

// Syncs voucher LEDGER LINES (party/sales/VAT/expense ledger, amount,
// cost centre, bill allocation — one row per ledger line per bill
// allocation) for one date range into the session-scoped cache. This is
// the piece get_vouchers/sync_vouchers_to_sql can't provide — those return
// only each voucher's single overall total, not which ledgers it actually
// posted to and for how much. Needed whenever a ledger's balance has to be
// broken down by the vouchers that make it up (e.g. splitting a combined
// VAT ledger into Output vs Input by grouping these rows by voucher_type,
// or reconciling a party ledger's movements voucher by voucher) — reusing
// the same TDL template verifyVoucherWrite already relies on internally
// for single-voucher post-write verification, now exposed for bulk
// historical queries too. Same chunked, additive-by-date-range model as
// syncVouchers/syncVoucherItems.
export async function syncVoucherLedgerEntries(from: string, to: string): Promise<string> {
  const { companyName, wasCleared, previousCompany } = await ensureCacheCompanyMatch();

  const xml = syncVoucherLedgerEntriesXml(toTallyActionDate(from), toTallyActionDate(to));
  const result = await tallyRequest(xml);
  const rows = extractRecords(result) as Record<string, unknown>[];

  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);

  let entryCount = 0;
  await db.exec("BEGIN");
  try {
    await db.query(
      "DELETE FROM voucher_ledger_entries WHERE date >= $1 AND date <= $2",
      [fromIso, toIso]
    );
    for (const v of rows) {
      const date = parseTallyDate(str(v.DATE) ?? "");
      if (!date) continue;
      const rawEntries = (v as any).ENTRY;
      if (!rawEntries) continue;
      const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];
      for (const entry of entries) {
        const rawBills = entry.BILL;
        const bills = rawBills ? (Array.isArray(rawBills) ? rawBills : [rawBills]) : [{}];
        for (const bill of bills) {
          entryCount++;
          await db.query(
            `INSERT INTO voucher_ledger_entries
               (voucher_guid, date, voucher_type, voucher_number, ledger, amount, is_deemed_positive, cost_centre, bill_name, bill_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              str(v.VOUCHER_GUID),
              date,
              str(v.VOUCHER_TYPE),
              str(v.VOUCHER_NUMBER),
              str(entry.LEDGER),
              num(entry.AMOUNT),
              entry.IS_DEEMED_POSITIVE === 1 || entry.IS_DEEMED_POSITIVE === "1",
              str(entry.COST_CENTRE) || null,
              str(bill.BILL_NAME) || null,
              str(bill.BILL_TYPE) || null,
            ]
          );
        }
      }
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }

  return (
    `Synced ${entryCount} ledger lines (across ${rows.length} vouchers checked) for ${from} to ${to} into this ` +
    `session's SQL cache table 'voucher_ledger_entries' for company "${companyName}" (cleared when this session ends). Query it directly to ` +
    `see exactly which vouchers post to a given ledger and for how much — e.g. GROUP BY ledger, voucher_type to ` +
    `split a combined ledger's balance apart, or filter by ledger to reconcile its movements voucher by voucher. ` +
    `amount is SIGNED (negative for a debit line, positive for a credit line, confirmed live: a Sales invoice's ` +
    `party ledger comes back negative while its Sales/VAT lines come back positive, summing to zero) — sum it ` +
    `directly rather than combining with is_deemed_positive, which is kept only for cross-reference against ` +
    `voucher_items' own use of that same field.` +
    companyChangeNote(wasCleared, previousCompany, companyName)
  );
}

// Auto-caches the last get_profit_and_loss call's rows — whole-table replace,
// same "cache reflects the most recent call" model as syncAll's ledgers/
// groups/stock_items, not an accumulating history. Called automatically by
// the tool handler itself (no separate sync step), so a follow-up question
// about the same P&L result can query it via SQL instead of re-fetching and
// re-dumping the full report into context again. Failures here must never
// break the read tool that triggered them — caller wraps this in try/catch.
export async function cacheProfitAndLoss(
  rows: { ledgerName: string; groupName: string; closingBalance: number }[],
  from: string,
  to: string
): Promise<void> {
  await ensureCacheCompanyMatch();
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);
  await db.exec("BEGIN");
  try {
    await db.exec("DELETE FROM profit_and_loss");
    for (const r of rows) {
      await db.query(
        "INSERT INTO profit_and_loss (ledger_name, group_name, closing_balance, period_from, period_to) VALUES ($1, $2, $3, $4, $5)",
        [str(r.ledgerName), str(r.groupName), num(r.closingBalance), fromIso, toIso]
      );
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

// Same whole-table-replace model as cacheProfitAndLoss, for get_stock_summary.
export async function cacheStockSummary(
  rows: Record<string, unknown>[],
  asOf: string
): Promise<void> {
  await ensureCacheCompanyMatch();
  const asOfIso = toIsoDate(asOf);
  await db.exec("BEGIN");
  try {
    await db.exec("DELETE FROM stock_summary");
    for (const r of rows) {
      await db.query(
        `INSERT INTO stock_summary (name, parent, opening_qty, closing_qty, opening_value, closing_value, as_of_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [str(r.NAME), str(r.PARENT), num(r.OPENINGBALANCE), num(r.CLOSINGBALANCE), num(r.OPENINGVALUE), num(r.CLOSINGVALUE), asOfIso]
      );
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

// Balance Sheet's own export shape has no shared schema with any other Tally
// report (confirmed live by inspecting real data) — two parallel top-level
// arrays (BSNAME/BSAMT) matched only by index position, not key-value pairs.
// Caller is responsible for having already zipped them into rows; this just
// persists the result with the same whole-table-replace model as the other
// auto-caches.
export async function cacheBalanceSheet(
  rows: { groupName: string | null; amount: number | null }[],
  asOf: string
): Promise<void> {
  await ensureCacheCompanyMatch();
  const asOfIso = toIsoDate(asOf);
  await db.exec("BEGIN");
  try {
    await db.exec("DELETE FROM balance_sheet");
    for (const r of rows) {
      await db.query(
        "INSERT INTO balance_sheet (group_name, amount, as_of_date) VALUES ($1, $2, $3)",
        [str(r.groupName), num(r.amount), asOfIso]
      );
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

// Trial Balance's export shape is different again from Balance Sheet's
// (DSPACCNAME/DSPACCINFO, not BSNAME/BSAMT) — kept as separate debit/credit
// columns rather than one signed amount, since collapsing dual dr/cr columns
// into a single sign convention risks being misread by whoever queries this.
export async function cacheTrialBalance(
  rows: { name: string | null; debitAmount: number | null; creditAmount: number | null }[],
  from: string,
  to: string
): Promise<void> {
  await ensureCacheCompanyMatch();
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);
  await db.exec("BEGIN");
  try {
    await db.exec("DELETE FROM trial_balance");
    for (const r of rows) {
      await db.query(
        "INSERT INTO trial_balance (name, debit_amount, credit_amount, period_from, period_to) VALUES ($1, $2, $3, $4, $5)",
        [str(r.name), num(r.debitAmount), num(r.creditAmount), fromIso, toIso]
      );
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

// UAE VAT liability summary — hybrid classification (Tally's own TAXTYPE
// field where it's actually set, plus a name-pattern fallback, since real
// company files were confirmed live to have their highest-activity ledgers
// created WITHOUT TAXTYPE set at all). Same whole-table-replace model as
// the other auto-caches.
export async function cacheVatSummary(
  rows: { ledgerName: string; category: string; matchMethod: string; closingBalance: number }[],
  from: string,
  to: string
): Promise<void> {
  await ensureCacheCompanyMatch();
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);
  await db.exec("BEGIN");
  try {
    await db.exec("DELETE FROM vat_summary");
    for (const r of rows) {
      await db.query(
        "INSERT INTO vat_summary (ledger_name, category, match_method, closing_balance, period_from, period_to) VALUES ($1, $2, $3, $4, $5, $6)",
        [str(r.ledgerName), str(r.category), str(r.matchMethod), num(r.closingBalance), fromIso, toIso]
      );
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

// Same hybrid classification and whole-table-replace model as
// cacheVatSummary, for India GST.
export async function cacheGstSummary(
  rows: { ledgerName: string; category: string; matchMethod: string; closingBalance: number }[],
  from: string,
  to: string
): Promise<void> {
  await ensureCacheCompanyMatch();
  const fromIso = toIsoDate(from);
  const toIso = toIsoDate(to);
  await db.exec("BEGIN");
  try {
    await db.exec("DELETE FROM gst_summary");
    for (const r of rows) {
      await db.query(
        "INSERT INTO gst_summary (ledger_name, category, match_method, closing_balance, period_from, period_to) VALUES ($1, $2, $3, $4, $5, $6)",
        [str(r.ledgerName), str(r.category), str(r.matchMethod), num(r.closingBalance), fromIso, toIso]
      );
    }
    await db.exec("COMMIT");
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  }
}

const DDL_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;

// Blanks out the contents of single-quoted string literals (Postgres uses ''
// to escape a literal quote inside one) before the DDL_KEYWORDS check runs.
// Confirmed live: without this, a perfectly safe SELECT ... WHERE name =
// 'ZZTEST ITEM DELETE ME' was rejected as a write statement, because the
// naive keyword check saw "DELETE" inside the quoted value, not just in
// actual SQL syntax.
function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

export async function runSql(sql: string): Promise<string> {
  // Unlike the sync_*_to_sql tools, this one doesn't fetch anything fresh —
  // it can only ever answer from whatever is already cached. So a detected
  // company change is refused outright rather than silently run against the
  // now-cleared (and therefore misleadingly empty, not "this company has no
  // data") tables — see ensureCacheCompanyMatch's own comment for why.
  const { companyName, wasCleared, previousCompany } = await ensureCacheCompanyMatch();
  if (wasCleared) {
    throw new Error(
      `Tally's active company changed since the last sync (was "${previousCompany}", now "${companyName}") — ` +
        `the cached data was for a different company and has been cleared to avoid answering with the wrong ` +
        `company's figures. Re-run the relevant sync_*_to_sql tool(s) for "${companyName}" before querying again.`
    );
  }

  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (!/^SELECT\b/i.test(trimmed)) {
    throw new Error("Only SELECT statements are allowed.");
  }
  if (DDL_KEYWORDS.test(stripStringLiterals(trimmed))) {
    throw new Error("Only read-only SELECT statements are allowed.");
  }

  const result = await db.query(trimmed);
  return JSON.stringify(result.rows, null, 2);
}
