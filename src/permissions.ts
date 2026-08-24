// Scoping for write-back operations, per the confirmed gap that this connector
// previously had no way to run in a locked-down mode: an operator connecting
// this to a shared/production company can restrict it before ever handing it
// to an agent, rather than relying on the agent choosing not to call a tool.

const PERMISSION_MODE = (process.env.TALLY_PERMISSION_MODE ?? "read_write").trim().toLowerCase();

const DISABLED_TOOLS = new Set(
  (process.env.TALLY_DISABLED_TOOLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

// Returns a denial message if the call should be blocked, or null to allow it.
export function checkPermission(toolName: string, isReadOnly: boolean): string | null {
  if (PERMISSION_MODE === "read_only" && !isReadOnly) {
    return (
      `Denied: this connector is configured in read-only mode (TALLY_PERMISSION_MODE=read_only). ` +
      `'${toolName}' is a write operation and was blocked before it reached Tally. ` +
      `Change TALLY_PERMISSION_MODE to 'read_write' (the default) to allow writes.`
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
