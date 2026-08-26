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
// next company's — starting fresh each session/company avoids that entirely.
const db = new PGlite();
let schemaReady: Promise<void> | null = null;

async function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = db.exec(`
      CREATE TABLE IF NOT EXISTS ledgers (
        name TEXT PRIMARY KEY,
        parent TEXT,
        closing_balance NUMERIC
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
    `).then(() => undefined);
  }
  await schemaReady;
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
export async function syncAll(): Promise<string> {
  await ensureSchema();

  const [ledgers, groups, stockItems] = await Promise.all([
    fetchCollection("Ledger", [{ name: "NAME" }, { name: "PARENT" }, { name: "CLOSINGBALANCE", datatype: "amount" }]),
    fetchCollection("Group", [{ name: "NAME" }, { name: "PARENT" }]),
    fetchCollection("Stock Item", [{ name: "NAME" }, { name: "PARENT" }, { name: "CLOSINGBALANCE", datatype: "quantity" }]),
  ]);

  await db.exec("BEGIN");
  try {
    await db.exec("DELETE FROM ledgers");
    for (const l of ledgers) {
      await db.query("INSERT INTO ledgers (name, parent, closing_balance) VALUES ($1, $2, $3)", [
        str(l.NAME),
        str(l.PARENT),
        num(l.CLOSINGBALANCE),
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
    `${stockItems.length} stock items into the local SQL cache. ` +
    `Vouchers are not synced by this tool — use sync_vouchers_to_sql(from, to) for those, ` +
    `one date range at a time (quarterly is a safe chunk size for a busy company).`
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
  await ensureSchema();

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
    `Synced ${rows.length} vouchers for ${from} to ${to} into this session's SQL cache ` +
    `(cleared when this session ends — sync again next session, or after switching companies). ` +
    `Call again with other date ranges to build up full history for this session — ` +
    `each call only replaces vouchers within its own date range.`
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
  await ensureSchema();

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
    `into this session's SQL cache table 'voucher_items' (cleared when this session ends). ` +
    `Query it directly for movement analysis (SUM(qty) grouped by stock_item/voucher_type/date), ` +
    `godown-wise stock (GROUP BY godown), or batch-level detail — there is no separate "report" tool for these, ` +
    `it's just SQL over this table via query_sql. Note: qty/amount are unsigned as Tally stores them — use ` +
    `is_deemed_positive and voucher_type together to determine inward vs outward direction for movement analysis.`
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
  await ensureSchema();
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
  await ensureSchema();
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
  await ensureSchema();
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
  await ensureSchema();
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
  await ensureSchema();
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
  await ensureSchema();
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
  await ensureSchema();

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
