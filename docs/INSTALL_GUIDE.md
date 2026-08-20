# Installing PNPC-MCP-Tally-Prime in Claude Desktop

## 1. Build the `.mcpb` package

From the repo root, using a working Node 18+ install (see
[Node version note](#node-version-note) below if `node` on your machine
resolves to something ancient):

```bash
npm install --omit=dev
npm run build
npm install -g @anthropic-ai/mcpb   # one-time, provides the `mcpb` CLI
mcpb validate manifest.json          # should print "Manifest schema validation passes!"
mcpb pack . PNPC-MCP-Tally-Prime.mcpb
```

This produces `PNPC-MCP-Tally-Prime.mcpb` in the repo root. Using
`--omit=dev` keeps devDependencies (TypeScript, `@types/*`) out of the
package — they're only needed to compile `dist/`, not to run it.

## 2. Install it in Claude Desktop

1. Open **Claude Desktop**.
2. Go to **Settings → Extensions**.
3. Find the option to install from a local file — this is usually a
   smaller "Advanced" / "Install from file" link near the bottom of the
   Extensions page, separate from any "browse extensions" button that
   just links out to a directory or GitHub.
4. Select `PNPC-MCP-Tally-Prime.mcpb`.
5. You should see an install/confirmation screen listing the 30 tools
   and a **TallyPrime Gateway URL** field — leave it as
   `http://localhost:9000` unless Tally's XML gateway runs on a
   different port on your machine.
6. Confirm/click through the install prompt, then make sure the
   extension shows as **enabled**.
7. Restart Claude Desktop if the tools don't appear immediately.

### If nothing visibly happens after picking the file

This has one specific known failure mode: Claude Desktop logs
`Handling DXT/MCPB file: <path>` in
`%APPDATA%\Claude\logs\main.log` the moment it receives the file, but a
confirmation dialog may open in a window that isn't in focus (common on
multi-monitor or remote-desktop setups). Before assuming the install
failed:

- **Alt+Tab through every open window** immediately after selecting the
  file — look for a small "Install this extension?" dialog.
- Check the **taskbar** for a new/flashing window icon.
- On remote desktop, check other sessions/monitors.
- Confirm the attempt was actually logged:
  ```
  Select-String "Handling DXT/MCPB file" "$env:APPDATA\Claude\logs\main.log" | Select-Object -Last 5
  ```
  If your latest attempt isn't in that output, the app never received
  the file — re-check that you picked the right file in the right
  dialog, rather than a "browse online extensions" link.

## 3. Verify it's connected

Once enabled, ask Claude something that needs a Tally read tool (e.g.
"list my Tally ledgers") — if it responds using this extension's tools
rather than erroring, it's wired up correctly.

## Node version note

If plain `node --version` on your machine reports something old (v6/v8),
there may be a second, newer Node install elsewhere in `PATH` (check
`where node` for all matches) — use that one explicitly for the build
steps above. Claude Desktop itself does **not** depend on your system
`node`; it bundles its own Node runtime to launch installed extensions,
so this only matters for *building* the `.mcpb`, not for running it
once installed.
