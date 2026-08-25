import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
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
  // Best-effort tag of whichever Tally company was active when this call was
  // made, from an in-memory cache — not a live lookup per call (see
  // setActiveCompany). null until something has told us a company name.
  company: string | null;
};

// Updated opportunistically by server.ts whenever get_company_info,
// get_health_check, or set_company succeeds. Deliberately not a live query
// run before every tool call — that would double the Tally round-trips this
// connector makes for no benefit beyond a label on the audit entry.
let activeCompany: string | null = null;

export function setActiveCompany(name: string | null): void {
  activeCompany = name;
}

const MAX_AUDIT_LOG_BYTES = 50 * 1024 * 1024; // 50MB safety valve — see runPrune below.

// Fire-and-forget by design: a logging failure (disk full, permissions) must
// never block the underlying Tally operation this entry is recording.
export function appendAuditEntry(entry: Omit<AuditEntry, "company">): void {
  try {
    mkdirSync(dirname(AUDIT_LOG_PATH), { recursive: true });
    const full: AuditEntry = { ...entry, company: activeCompany };
    appendFileSync(AUDIT_LOG_PATH, JSON.stringify(full) + "\n", "utf8");

    // Cheap metadata check (no file content read) on every write, so a
    // long-lived process (this connector can run for weeks under Claude
    // Desktop without restarting) doesn't have to wait for its next restart
    // before the 90-day policy gets a chance to shrink the file back down.
    const size = statSync(AUDIT_LOG_PATH).size;
    if (size >= MAX_AUDIT_LOG_BYTES) runPrune();
  } catch {
    // Swallowed intentionally — see comment above.
  }
}

export function auditLogPath(): string {
  return AUDIT_LOG_PATH;
}

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Hard-deletes entries older than 90 days by rewriting the file — JSONL
// offers no cheaper way to drop individual lines. Never blows away recent
// entries just because the file is large; it only ever removes entries
// actually past the 90-day cutoff.
function runPrune(): void {
  try {
    if (!existsSync(AUDIT_LOG_PATH)) return;
    const lines = readFileSync(AUDIT_LOG_PATH, "utf8").split("\n").filter((l) => l.trim() !== "");
    const cutoff = Date.now() - NINETY_DAYS_MS;
    const kept: string[] = [];
    let droppedAny = false;
    for (const line of lines) {
      try {
        const entry: AuditEntry = JSON.parse(line);
        if (new Date(entry.ts).getTime() >= cutoff) {
          kept.push(line);
        } else {
          droppedAny = true;
        }
      } catch {
        droppedAny = true; // Can't attribute an unparseable line to a date — drop it.
      }
    }
    if (droppedAny) {
      writeFileSync(AUDIT_LOG_PATH, kept.length > 0 ? kept.join("\n") + "\n" : "", "utf8");
    }
  } catch {
    // Never let pruning failure block the write that triggered it.
  }
}

let hasPrunedOnStartup = false;

// Called once from createServer() so every process checks the 90-day policy
// at least once on boot, regardless of how long it's been since the last
// write-triggered prune (e.g. a fresh install with an old carried-over log,
// or a file that's stayed under the size threshold for months).
export function pruneAuditLog(): void {
  if (hasPrunedOnStartup) return;
  hasPrunedOnStartup = true;
  runPrune();
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
  // Restrict to entries tagged with this exact company name (see
  // setActiveCompany). Entries predating this feature, or made before any
  // company-identifying call succeeded, have company: null and are excluded.
  company?: string;
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
  if (filter.company) entries = entries.filter((e) => e.company === filter.company);
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
    "| Time (UTC) | Tool | Type | Outcome | Company |",
    "|---|---|---|---|---|",
  ];
  for (const e of entries) {
    lines.push(`| ${e.ts} | ${e.tool} | ${e.readOnly ? "read" : "write"} | ${e.outcome} | ${e.company ?? "(unknown)"} |`);
  }
  return lines.join("\n");
}
