// Scoping for write-back operations, per the confirmed gap that this connector
// previously had no way to run in a locked-down mode: an operator connecting
// this to a shared/production company can restrict it before ever handing it
// to an agent, rather than relying on the agent choosing not to call a tool.

const PERMISSION_MODE = (process.env.TALLY_PERMISSION_MODE ?? "read_write").trim().toLowerCase();

// The Claude Desktop Extension install screen exposes a plain boolean toggle
// ("Read-only mode") rather than the read_only/read_write string enum above —
// TALLY_READ_ONLY is what that toggle maps to (see manifest.json's
// user_config.read_only_mode). Either one triggers the same block.
const READ_ONLY_TOGGLE = (process.env.TALLY_READ_ONLY ?? "false").trim().toLowerCase() === "true";

const DISABLED_TOOLS = new Set(
  (process.env.TALLY_DISABLED_TOOLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// Returns a denial message if the call should be blocked, or null to allow it.
export function checkPermission(toolName: string, isReadOnly: boolean): string | null {
  if ((PERMISSION_MODE === "read_only" || READ_ONLY_TOGGLE) && !isReadOnly) {
    return (
      `Denied: this connector is configured in read-only mode (Read-only mode is on, or ` +
      `TALLY_PERMISSION_MODE=read_only). '${toolName}' is a write operation and was blocked before it ` +
      `reached Tally. Turn off read-only mode (or set TALLY_PERMISSION_MODE to 'read_write') to allow writes.`
    );
  }
  if (DISABLED_TOOLS.has(toolName)) {
    return (
      `Denied: '${toolName}' is disabled for this connector via TALLY_DISABLED_TOOLS. ` +
      `Remove it from that list to allow this tool.`
    );
  }
  return null;
}

// For get_health_check — reports the effective config without duplicating the logic above.
export function getPermissionStatus(): { readOnly: boolean; disabledTools: string[] } {
  return {
    readOnly: PERMISSION_MODE === "read_only" || READ_ONLY_TOGGLE,
    disabledTools: Array.from(DISABLED_TOOLS),
  };
}
