import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { tools, handleTool } from "./tools.js";
import { appendAuditEntry } from "./audit.js";
import { checkPermission } from "./permissions.js";

// Tools that only read from Tally or change session context (not data) — everything
// else creates/updates/deletes masters or vouchers. Claude Desktop's Extensions page
// groups tools into "Read-only" vs "Write/delete" using exactly these hints.
const READ_ONLY_TOOLS = new Set([
  "get_ledgers", "get_stock_items", "get_vouchers", "get_company_info",
  "get_profit_and_loss", "get_balance_sheet", "get_trial_balance", "get_groups",
  "get_voucher_types", "get_cost_centres", "get_stock_summary", "get_bills_receivable",
  "get_bills_payable", "get_ledger_vouchers", "sync_to_sql", "sync_vouchers_to_sql", "query_sql",
  "set_company", "set_period", "get_audit_log",
]);

function annotationsFor(toolName: string) {
  return READ_ONLY_TOOLS.has(toolName)
    ? { readOnlyHint: true, openWorldHint: false }
    : { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };
}

// Builds a fresh MCP Server instance. Shared by both the stdio entry point
// (index.ts, for local Claude Desktop use) and the HTTP entry point
// (http-server.ts, for remote/cloud use).
export function createServer(): Server {
  const server = new Server(
    { name: "pnpc-mcp-tally-prime", version: "0.2.0" },
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
