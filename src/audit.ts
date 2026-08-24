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

export function readAuditLog(limit: number, toolFilter?: string): AuditEntry[] {
  if (!existsSync(AUDIT_LOG_PATH)) return [];
  const lines = readFileSync(AUDIT_LOG_PATH, "utf8").split("\n").filter((l) => l.trim() !== "");
  const entries: AuditEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip a corrupt line rather than failing the whole read.
    }
  }
  const filtered = toolFilter ? entries.filter((e) => e.tool === toolFilter) : entries;
  return filtered.slice(-limit);
}
