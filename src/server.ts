import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, handleTool } from "./tools.js";
import { appendAuditEntry, pruneAuditLog, setActiveCompany } from "./audit.js";
import { checkPermission } from "./permissions.js";

// Tools whose successful result tells us which Tally company is active —
// used to keep the audit log's best-effort company tag up to date. See
// setActiveCompany in audit.ts for why this is cache-on-success rather than
// a live lookup before every call.
function updateActiveCompanyFrom(name: string, args: Record<string, unknown>, text: string): void {
  try {
    if (name === "set_company") {
      const companyName = args.companyName;
      if (typeof companyName === "string" && companyName.length > 0) setActiveCompany(companyName);
    } else if (name === "get_company_info" || name === "get_health_check") {
      const parsed = JSON.parse(text);
      const companyName = name === "get_health_check" ? parsed?.companyOpen : parsed?.DATA?.ROW?.NAME;
      if (typeof companyName === "string" && companyName.length > 0) setActiveCompany(companyName);
    }
  } catch {
    // Best-effort — a parse failure here just means the cache doesn't update this call.
  }
}

// Read the real version from package.json instead of hardcoding one here —
// confirmed live that a hardcoded string silently drifted from the actual
// shipped version across several releases (frozen at "0.2.0" while
// package.json/manifest.json moved on to 1.4.0+) with nothing to catch it.
const moduleDir = dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(join(moduleDir, "..", "package.json"), "utf8"));
const SERVER_VERSION: string = packageJson.version;

// Tools that only read from Tally or change session context (not data) — everything
// else creates/updates/deletes masters or vouchers. Claude Desktop's Extensions page
// groups tools into "Read-only" vs "Write/delete" using exactly these hints.
const READ_ONLY_TOOLS = new Set([
  "get_ledgers", "get_stock_items", "get_vouchers", "get_company_info",
  "get_profit_and_loss", "get_balance_sheet", "get_trial_balance", "get_groups",
  "get_voucher_types", "get_cost_centres", "get_stock_summary", "get_bills_receivable",
  "get_bills_payable", "get_cash_flow", "get_funds_flow", "get_ratio_analysis", "get_sales_register",
  "get_purchase_register", "get_journal_register", "get_payment_register", "get_receipts_and_payments",
  "get_reorder_status", "get_vat_liability_summary", "get_gst_liability_summary", "get_ledger_vouchers", "sync_to_sql", "sync_vouchers_to_sql", "query_sql",
  "set_company", "set_period", "get_audit_log", "get_health_check",
  // preview_write never sends a write to Tally (see its own description) —
  // treated as read-only so it still works when read-only mode is on.
  // confirm_write is deliberately NOT here; it's the tool that actually posts.
  "preview_write",
]);

function annotationsFor(toolName: string) {
  if (READ_ONLY_TOOLS.has(toolName)) {
    return { readOnlyHint: true, openWorldHint: false };
  }
  if (toolName === "confirm_write") {
    // Wraps whatever write was previewed (create/update/delete) — can't know
    // which in advance, so hint cautiously: potentially destructive, and
    // never a safe repeat (a used-up preview_id fails rather than reposting).
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
  }
  if (toolName.startsWith("delete_")) {
    // Deleting an already-gone target converges to the same end state either way.
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
  }
  if (toolName.startsWith("create_")) {
    // Confirmed live throughout this project: calling a create_* tool twice with
    // the same args creates a second record, or Tally rejects it as a duplicate
    // name — never a safe no-op repeat. idempotentHint: true here would be wrong
    // and could encourage a caller to safely "just retry" a create, risking
    // duplicate masters/vouchers in a real client's books. Also not destructive —
    // it adds a new record rather than overwriting existing data.
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  }
  // update_* tools (and set_bill_of_materials, which overwrites a stock item's
  // recipe) replace existing state with a fixed target — repeating with the same
  // args converges to the same end state, and they do overwrite prior data.
  return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
}

// Builds a fresh MCP Server instance. Shared by both the stdio entry point
// (index.ts, for local Claude Desktop use) and the HTTP entry point
// (http-server.ts, for remote/cloud use).
export function createServer(): Server {
  pruneAuditLog();

  const server = new Server(
    { name: "pnpc-mcp-tally-prime", version: SERVER_VERSION },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      annotations: annotationsFor(t.name),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const isReadOnly = READ_ONLY_TOOLS.has(name);
    const start = Date.now();

    const denial = checkPermission(name, isReadOnly);
    if (denial) {
      appendAuditEntry({
        ts: new Date().toISOString(),
        tool: name,
        readOnly: isReadOnly,
        outcome: "denied",
        detail: denial,
        durationMs: Date.now() - start,
        args: args ?? {},
      });
      return { content: [{ type: "text", text: denial }], isError: true };
    }

    try {
      const text = await handleTool(name, (args ?? {}) as Record<string, unknown>);
      updateActiveCompanyFrom(name, (args ?? {}) as Record<string, unknown>, text);
      appendAuditEntry({
        ts: new Date().toISOString(),
        tool: name,
        readOnly: isReadOnly,
        outcome: "success",
        detail: text.slice(0, 500),
        durationMs: Date.now() - start,
        args: args ?? {},
      });
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendAuditEntry({
        ts: new Date().toISOString(),
        tool: name,
        readOnly: isReadOnly,
        outcome: "error",
        detail: msg,
        durationMs: Date.now() - start,
        args: args ?? {},
      });
      return { content: [{ type: "text", text: `Error: ${msg}` }], isError: true };
    }
  });

  return server;
}
