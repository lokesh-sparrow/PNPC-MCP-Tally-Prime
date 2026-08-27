# Connecting from claude.ai, ChatGPT, or Grok (OAuth)

Claude web (claude.ai), ChatGPT, and Grok don't run a local stdio server
on your PC the way Claude Desktop does — they only connect to a remote
HTTPS MCP endpoint, and their "Add custom connector" flows expect that
endpoint to support OAuth 2.1. This connector's HTTP entry point
(`src/http-server.ts`) implements a minimal, single-user OAuth layer on
top of the existing bearer-token auth so all three can connect through
the standard flow, instead of needing a raw-header workaround.

**What this actually is:** your real credential is still just
`TALLY_MCP_TOKEN` — one shared secret you set. The OAuth layer is a
login-page "envelope" around that same token so MCP clients that require
OAuth (rather than accepting a static header) can complete their
connection flow. There's no separate per-user account system — anyone
who completes the login page with the correct token gets the same access
that token has always granted. This is meant for one person (you)
connecting your own account(s) to your own server, not for onboarding
multiple separate users/clients.

## Prerequisites

1. This connector running with `TALLY_MCP_TOKEN` set (see
   [HTTP_DEPLOYMENT.md](./HTTP_DEPLOYMENT.md)).
2. `PUBLIC_URL` set to your server's externally-reachable HTTPS address
   (no trailing slash) — e.g. your [Cloudflare Tunnel](./CLOUDFLARE_TUNNEL.md)
   URL, or your own domain if using a different reverse proxy. This is
   required: the OAuth endpoints advertise absolute URLs back to
   themselves, and clients will fail to complete the flow if this points
   at the wrong address.

   > **On a no-domain Quick Tunnel**, this URL is random and changes every
   > time you restart the tunnel (see [CLOUDFLARE_TUNNEL.md](./CLOUDFLARE_TUNNEL.md#which-path-do-i-need)).
   > That's not just "log in again" — the client's whole connector entry
   > pointed at the *old* URL, which no longer exists, so you have to
   > **remove and re-add the custom connector from scratch** with the new
   > URL each time you restart. A fixed domain avoids this entirely.

```bash
TALLY_MCP_TOKEN=<your-token> PUBLIC_URL=https://your-tunnel-or-domain npm run start:http
```

## What gets added

| Endpoint | Purpose |
|---|---|
| `GET /.well-known/oauth-authorization-server` | Metadata discovery (RFC 8414) — tells the client where `/authorize` and `/token` are |
| `GET /.well-known/oauth-protected-resource` | Tells the client which authorization server protects `/mcp` (RFC 9728) |
| `POST /register` | Dynamic Client Registration (RFC 7591) — used by the "register a client automatically" option most clients offer |
| `GET`/`POST /authorize` | The actual login screen — enter `TALLY_MCP_TOKEN` here |
| `POST /token` | Exchanges the authorization code for an access token, with PKCE (S256) verification |

`/mcp` itself accepts either the raw `TALLY_MCP_TOKEN` (for setups using
a direct `Authorization: Bearer` header, e.g. Claude Desktop's custom
headers or a `curl` call) or a token issued through this OAuth flow —
both work, so existing direct-header setups aren't affected by this.

## Connecting a client

The steps are the same shape in each — connector settings will vary in
wording, but the pattern holds:

1. Add a custom/remote connector, pointed at `<your-public-url>/mcp`.
2. If it asks how to register an OAuth client, pick the automatic/DCR
   option (no client ID to enter, no secret).
3. It redirects to this server's login page — enter your
   `TALLY_MCP_TOKEN`.
4. You're redirected back to the client, connected.

**Claude web:** Settings → Connectors → Add custom connector.

**ChatGPT:** Settings → Security → Developer mode (Pro/Plus/Business/
Enterprise/Education only) → add the MCP server URL. ChatGPT only
accepts remote HTTPS endpoints — it cannot run a local stdio server the
way Claude Desktop can, so this remote/OAuth path is the *only* way to
reach this connector from ChatGPT, not an alternative to a local option.

**Grok:** [grok.com/connectors](https://grok.com/connectors) → **New
Connector** → **Custom** → enter `<your-public-url>/mcp` as the MCP
server URL → complete authentication (this is where the OAuth/DCR flow
above runs). Custom MCP connectors are a paid-tier feature (SuperGrok/X
Premium+ as of mid-2026) — if you don't see the option, that's the
likely reason. (Exact menu wording changes over time; if you hit
something unexpected, share what the screen shows and it can be mapped
onto this same setup.)

## Security notes

- Everything issued (auth codes, access tokens, registered client IDs)
  lives in server process memory only — gone on restart, same as the SQL
  cache. There's no persistent database of who's connected.
- Access tokens issued through this flow are valid for 30 days from
  issuance; there's currently no revocation endpoint — rotating
  `TALLY_MCP_TOKEN` and restarting the server invalidates all of them at
  once (raw-token holders and OAuth-issued tokens both stop working,
  since issued tokens are only ever checked in-memory against that
  process's own state).
- This is still fundamentally a single shared password behind a
  standards-shaped login screen, not a real multi-user authorization
  system — don't extend this to give out separate credentials to
  multiple people/clients without redesigning the auth model first.
