# Remote Access via Cloudflare Tunnel

This is the recommended way to reach this connector from Claude web, a
mobile client, or anywhere off your local network, without opening any
inbound port on your router. See [HTTP_DEPLOYMENT.md](./HTTP_DEPLOYMENT.md)
for the alternative (a manually-configured reverse proxy).

**How it works:** a small daemon (`cloudflared`) runs on the same machine
as this connector and TallyPrime. It makes an *outbound* connection to
Cloudflare and keeps it open — Cloudflare then routes traffic for a URL you
choose back down that same connection. Nothing on your router needs to be
opened or forwarded, and Cloudflare issues the HTTPS certificate for you.

## Which path do I need?

Cloudflare Tunnel has two modes — pick based on whether you own a domain:

| | **I have a domain on Cloudflare** | **I don't have a domain** |
|---|---|---|
| Setup | Steps 1–9 below (Named Tunnel) | One command — see box below (Quick Tunnel) |
| URL | Fixed, e.g. `tally.yourdomain.com` — stays the same forever | Random, e.g. `something-random.trycloudflare.com` |
| **URL after a restart** | **Same URL every time** | **Changes to a new random URL every time you restart the tunnel** — anything pointed at the old URL (a saved claude.ai connector, a bookmark) breaks and needs re-pointing |
| Best for | Something you'll keep running long-term | Trying this out, or short one-off sessions you start/stop yourself |

> **No domain? Quick Tunnel — one command, no Cloudflare account needed:**
> ```bash
> cloudflared tunnel --url http://localhost:3939
> ```
> It prints a `https://<random-words>.trycloudflare.com` URL immediately —
> use that instead of `tally.yourdomain.com` everywhere in steps 6–9 below
> (skip steps 1–5, they're only for the domain path). Remember the
> restart caveat above: if you stop this command and run it again later,
> you'll get a **different** URL and have to update anywhere you'd
> connected the old one (e.g. re-add the custom connector in claude.ai).

## Prerequisites (Named Tunnel — domain path only; skip if using Quick Tunnel above)

- This connector's code cloned and built (`npm install && npm run build`)
  on the same machine as TallyPrime, or one that can reach it — see
  [HTTP_DEPLOYMENT.md](./HTTP_DEPLOYMENT.md) for `TALLY_URL`.
- A domain added to a free Cloudflare account (Cloudflare Tunnel requires
  a domain on Cloudflare's DNS — any domain you own works; add it to
  Cloudflare first if it isn't already, or buy a cheap one just for this).
- Admin/terminal access on the machine you're deploying from.

## 1. Install cloudflared

Windows (PowerShell, as Administrator):

```powershell
winget install --id Cloudflare.cloudflared
```

Or download the binary directly from
[Cloudflare's releases page](https://github.com/cloudflare/cloudflared/releases)
if `winget` isn't available.

## 2. Authenticate

```bash
cloudflared tunnel login
```

Opens a browser window — log into Cloudflare and pick the domain you're
using for this. This drops a certificate at
`%USERPROFILE%\.cloudflared\cert.pem` that authorizes tunnel creation
under that account.

## 3. Create the tunnel

```bash
cloudflared tunnel create tally-mcp
```

Note the tunnel ID it prints — you'll need it in the config file below.
This also writes a credentials JSON file to `%USERPROFILE%\.cloudflared\`.

## 4. Route a hostname to it

Pick a subdomain, e.g. `tally.yourdomain.com`:

```bash
cloudflared tunnel route dns tally-mcp tally.yourdomain.com
```

This adds the DNS record on Cloudflare's side automatically — no manual
DNS editing needed.

## 5. Configure the tunnel

Create `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: tally-mcp
credentials-file: C:\Users\<you>\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: tally.yourdomain.com
    service: http://localhost:3939
  - service: http_status:404
```

The second `ingress` line is required by cloudflared — it's the
catch-all for any request that doesn't match a defined hostname.

## 6. Set the bearer token and start this connector

```bash
$env:TALLY_MCP_TOKEN = "<a-long-random-secret-you-generate>"
npm run start:http
```

Generate the token the same way as local HTTP setup:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Leave this running (see step 8 for making it permanent).

## 7. Start the tunnel

```bash
cloudflared tunnel run tally-mcp
```

Test it from any machine, anywhere:

```bash
curl https://tally.yourdomain.com/healthz
```

Should return `{"status":"ok"}`. If it doesn't, check that step 6's
server is actually running on port 3939 first — the tunnel just forwards,
it doesn't fix a connector that isn't up.

## 8. Run both as background services (don't rely on open terminal windows)

**Skip this step if you're on the Quick Tunnel (no-domain) path** — making
a Quick Tunnel "permanent" defeats its own purpose, since its URL changes
on every restart anyway. This step is only useful with a fixed domain.

Two processes need to survive reboots and terminal closures:
`cloudflared tunnel run` and `npm run start:http`.

- **cloudflared**: `cloudflared service install` registers it as a
  Windows service that starts on boot.
- **This connector**: wrap `npm run start:http` with a process manager —
  `pm2` (`npm install -g pm2`, then `pm2 start npm --name tally-mcp --
  run start:http`, then `pm2 save` + `pm2 startup`) is the simplest
  cross-platform option.

## 9. Point your remote client at it

**Direct-header clients** (Claude Desktop custom headers, `curl`, scripts):
MCP endpoint `https://tally.yourdomain.com/mcp`, header
`Authorization: Bearer <the-token-from-step-6>` on every request.

**claude.ai, ChatGPT, Grok** (anything expecting an OAuth "Add custom
connector" flow): also set `PUBLIC_URL=https://tally.yourdomain.com` in
step 6 before starting the server, then see
[docs/OAUTH_CONNECTORS.md](./OAUTH_CONNECTORS.md) for the login flow —
same URL, but you'll go through a login page instead of pasting the
token as a raw header.

## Security checklist before leaving this running unattended

- [ ] `TALLY_MCP_TOKEN` is set — an unset token means `/mcp` is
      completely open to anyone who finds the URL.
- [ ] Tally's own gateway port (9000) is **not** separately exposed —
      only this connector's port (3939) is, and only cloudflared reaches
      it, since there's no inbound firewall rule for it at all.
- [ ] The token is stored as an environment variable or secret, not
      committed anywhere.
- [ ] Both processes (cloudflared + this connector) are running as
      services, not terminal windows that'll die on logout/reboot.
- [ ] (Optional, tighter) Restrict the Cloudflare hostname to specific
      IPs or add Cloudflare Access (free tier) in front of it for a
      second layer of login beyond the bearer token.
