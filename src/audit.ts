import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

// Defaults to a file next to the installed package (one per TALLY_URL this
// connector talks to, in practice — one install per company/session on a
// shared server) — override with TALLY_AUDIT_LOG_PATH for a shared location.
const AUDIT_LOG_PATH = process.env.TALLY_AUDIT_LOG_PATH ?? join(moduleDir, "..", "audit.log.jsonl");

export type AuditOutcome = "success" | "error" | "denied";

export type AuditEntry = {
  ts: string;
  tool: string;
  readOnly: boolean;
  outcome: AuditOutcome;
  detail: string;
  durationMs: number;
  args: unknown;
};

// Fire-and-forget by design: a logging failure (disk full, permissions) must
// never block the underlying Tally operation this entry is recording.
export function appendAuditEntry(entry: AuditEntry): void {
  try {
    mkdirSync(dirname(AUDIT_LOG_PATH), { recursive: true });
    appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Swallowed intentionally — see comment above.
  }
}

export function auditLogPath(): string {
  return AUDIT_LOG_PATH;
}

export type AuditLogFilter = {
  limit?: number;
  toolFilter?: string;
  // Restrict to write calls only (readOnly === false) — the subset a reviewer
  // actually cares about when asking "what did this agent change".
  writesOnly?: boolean;
  // Inclusive date range, DD-MM-YYYY, matching this project's date convention
  // everywhere else (Tally itself uses DD-MM-YYYY on every date-range tool).
  fromDate?: string;
  toDate?: string;
};

function parseDdMmYyyy(d: string): Date {
  const [dd, mm, yyyy] = d.split("-").map(Number);
  return new Date(yyyy, mm - 1, dd);
}

export function readAuditLog(filter: AuditLogFilter = {}): AuditEntry[] {
  if (!existsSync(AUDIT_LOG_PATH)) return [];
  const lines = readFileSync(AUDIT_LOG_PATH, "utf8").split("\n").filter((l) => l.trim() !== "");
  let entries: AuditEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip a corrupt line rather than failing the whole read.
    }
  }

  if (filter.toolFilter) entries = entries.filter((e) => e.tool === filter.toolFilter);
  if (filter.writesOnly) entries = entries.filter((e) => !e.readOnly);
  if (filter.fromDate) {
    const from = parseDdMmYyyy(filter.fromDate);
    entries = entries.filter((e) => new Date(e.ts) >= from);
  }
  if (filter.toDate) {
    const to = parseDdMmYyyy(filter.toDate);
    to.setHours(23, 59, 59, 999);
    entries = entries.filter((e) => new Date(e.ts) <= to);
  }

  return entries.slice(-(filter.limit ?? 50));
}

// A reviewer-facing report — counts + a compact table — instead of raw JSON,
// meant to be handed to someone checking "what did this agent actually do"
// without them needing to parse JSONL themselves.
export function summarizeAuditLog(entries: AuditEntry[]): string {
  if (entries.length === 0) {
    return "No audit log entries match this filter.";
  }

  const counts = { success: 0, error: 0, denied: 0 };
  for (const e of entries) counts[e.outcome]++;
  const writes = entries.filter((e) => !e.readOnly).length;
  const reads = entries.length - writes;

  const lines = [
    `${entries.length} call(s) — ${writes} write, ${reads} read.`,
    `Outcomes: ${counts.success} succeeded, ${counts.error} errored, ${counts.denied} denied.`,
    "",
    "| Time (UTC) | Tool | Type | Outcome |",
    "|---|---|---|---|",
  ];
  for (const e of entries) {
    lines.push(`| ${e.ts} | ${e.tool} | ${e.readOnly ? "read" : "write"} | ${e.outcome} |`);
  }
  return lines.join("\n");
}
