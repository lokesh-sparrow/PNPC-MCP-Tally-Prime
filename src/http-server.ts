import express from "express";
import { randomUUID, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

// Remote/cloud entry point: exposes the same tools as index.ts over HTTP
// instead of stdio, so a browser-based or remote MCP client can reach a
// Tally instance that this process has local network access to.
const PORT = Number(process.env.PORT ?? 3939);
const AUTH_TOKEN = process.env.TALLY_MCP_TOKEN;

// PUBLIC_URL is this server's own externally-reachable base URL (e.g. your
// Cloudflare Tunnel/domain, no trailing slash). Required for the OAuth
// endpoints below, since they have to advertise absolute URLs back to
// themselves for MCP clients (like claude.ai) to discover and call.
const PUBLIC_URL = (process.env.PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// ---------------------------------------------------------------------------
// Minimal single-user OAuth 2.1 authorization server.
//
// This connector's actual credential is still just TALLY_MCP_TOKEN — a
// single shared secret, same as before. What's added here is the OAuth
// *wrapper* claude.ai's "Add custom connector" flow expects (metadata
// discovery, dynamic client registration, an /authorize + /token exchange
// with PKCE), so that flow works cleanly for a single self-hosted user
// instead of requiring a raw-header workaround. There is intentionally no
// real user database or multi-tenant client registry — everyone who
// completes the /authorize login screen with the correct TALLY_MCP_TOKEN
// gets the same level of access this server has always granted to anyone
// holding that token.
//
// All state (registered clients, in-flight auth codes, issued access
// tokens) is in-memory only, same lifetime as the SQL cache elsewhere in
// this connector — gone on restart, which is fine for a single-user setup.
// ---------------------------------------------------------------------------

if (!AUTH_TOKEN) {
  console.error(
    "WARNING: TALLY_MCP_TOKEN is not set — /mcp is unauthenticated and the OAuth login " +
      "screen has no password to check against. Set TALLY_MCP_TOKEN before exposing this " +
      "beyond localhost."
  );
}

type PendingAuth = { codeChallenge: string; redirectUri: string; expiresAt: number };
type IssuedToken = { expiresAt: number };

const registeredClients = new Set<string>();
const pendingAuthCodes = new Map<string, PendingAuth>();
const issuedAccessTokens = new Map<string, IssuedToken>();

const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes to complete the redirect
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// RFC 8414 — lets an MCP client discover this server's OAuth endpoints.
app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  res.json({
    issuer: PUBLIC_URL,
    authorization_endpoint: `${PUBLIC_URL}/authorize`,
    token_endpoint: `${PUBLIC_URL}/token`,
    registration_endpoint: `${PUBLIC_URL}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
});

// RFC 9728 — lets an MCP client discover which authorization server
// protects this resource (itself, in this single-server setup).
app.get("/.well-known/oauth-protected-resource", (_req, res) => {
  res.json({
    resource: `${PUBLIC_URL}/mcp`,
    authorization_servers: [PUBLIC_URL],
  });
});

// RFC 7591 — Dynamic Client Registration. claude.ai's "register one
// automatically" option calls this. Any client_name is accepted since
// there's nothing multi-tenant to protect here — the real gate is the
// TALLY_MCP_TOKEN password screen at /authorize.
app.post("/register", (req, res) => {
  const clientId = randomUUID();
  registeredClients.add(clientId);
  res.status(201).json({
    client_id: clientId,
    redirect_uris: req.body?.redirect_uris ?? [],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
  });
});

// The login screen — this is the actual gate. Whoever holds
// TALLY_MCP_TOKEN can complete this and get an access token back.
app.get("/authorize", (req, res) => {
  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, response_type } =
    req.query;

  if (response_type !== "code" || code_challenge_method !== "S256") {
    res.status(400).send("Unsupported request: only response_type=code with PKCE S256 is supported.");
    return;
  }
  if (typeof redirect_uri !== "string" || typeof code_challenge !== "string") {
    res.status(400).send("Missing redirect_uri or code_challenge.");
    return;
  }

  res.type("html").send(`<!doctype html>
<html><head><title>Tally MCP — Sign in</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: system-ui, sans-serif; max-width: 380px; margin: 80px auto; padding: 0 16px; }
  h1 { font-size: 1.1rem; }
  input { width: 100%; padding: 10px; margin: 12px 0; box-sizing: border-box; font-size: 1rem; }
  button { width: 100%; padding: 10px; font-size: 1rem; cursor: pointer; }
  .error { color: #b00020; font-size: 0.9rem; }
</style></head>
<body>
  <h1>Tally MCP connector</h1>
  <p>Enter your connector's access token (TALLY_MCP_TOKEN) to continue.</p>
  ${req.query.error ? '<p class="error">Incorrect token — try again.</p>' : ""}
  <form method="post" action="/authorize">
    <input type="hidden" name="client_id" value="${String(client_id ?? "")}">
    <input type="hidden" name="redirect_uri" value="${redirect_uri}">
    <input type="hidden" name="state" value="${String(state ?? "")}">
    <input type="hidden" name="code_challenge" value="${code_challenge}">
    <input type="password" name="token" placeholder="Access token" autofocus required>
    <button type="submit">Continue</button>
  </form>
</body></html>`);
});

app.post("/authorize", (req, res) => {
  const { redirect_uri, state, code_challenge, token } = req.body ?? {};

  if (typeof redirect_uri !== "string" || typeof code_challenge !== "string") {
    res.status(400).send("Missing redirect_uri or code_challenge.");
    return;
  }
  if (!AUTH_TOKEN || typeof token !== "string" || !constantTimeEquals(token, AUTH_TOKEN)) {
    const retryUrl = new URL(`${PUBLIC_URL}/authorize`);
    retryUrl.searchParams.set("redirect_uri", redirect_uri);
    retryUrl.searchParams.set("state", String(state ?? ""));
    retryUrl.searchParams.set("code_challenge", code_challenge);
    retryUrl.searchParams.set("code_challenge_method", "S256");
    retryUrl.searchParams.set("response_type", "code");
    retryUrl.searchParams.set("error", "invalid_token");
    res.redirect(retryUrl.toString());
    return;
  }

  const code = base64url(randomBytes(32));
  pendingAuthCodes.set(code, { codeChallenge: code_challenge, redirectUri: redirect_uri, expiresAt: Date.now() + CODE_TTL_MS });

  const redirect = new URL(redirect_uri);
  redirect.searchParams.set("code", code);
  if (state) redirect.searchParams.set("state", String(state));
  res.redirect(redirect.toString());
});

// RFC 6749 §4.1.3 + RFC 7636 (PKCE) — exchanges the authorization code for
// an access token, verifying the code_verifier against the code_challenge
// issued at /authorize.
app.post("/token", (req, res) => {
  const { grant_type, code, code_verifier, redirect_uri } = req.body ?? {};

  if (grant_type !== "authorization_code" || typeof code !== "string" || typeof code_verifier !== "string") {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const pending = pendingAuthCodes.get(code);
  if (!pending || pending.expiresAt < Date.now()) {
    pendingAuthCodes.delete(code);
    res.status(400).json({ error: "invalid_grant" });
    return;
  }
  if (redirect_uri && redirect_uri !== pending.redirectUri) {
    res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
    return;
  }

  const computedChallenge = base64url(createHash("sha256").update(code_verifier).digest());
  if (!constantTimeEquals(computedChallenge, pending.codeChallenge)) {
    res.status(400).json({ error: "invalid_grant", error_description: "PKCE verification failed" });
    return;
  }

  pendingAuthCodes.delete(code);
  const accessToken = base64url(randomBytes(32));
  issuedAccessTokens.set(accessToken, { expiresAt: Date.now() + TOKEN_TTL_MS });

  res.json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(TOKEN_TTL_MS / 1000),
  });
});

// Accepts either the raw TALLY_MCP_TOKEN (existing direct-header setups,
// e.g. curl or Claude Desktop's custom-header config) or a token issued
// through the /authorize + /token OAuth flow above.
function isAuthorized(header: string | undefined): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length);
  if (AUTH_TOKEN && constantTimeEquals(presented, AUTH_TOKEN)) return true;
  const issued = issuedAccessTokens.get(presented);
  if (issued && issued.expiresAt > Date.now()) return true;
  return false;
}

app.use((req, res, next) => {
  if (!AUTH_TOKEN) {
    next();
    return;
  }
  if (!isAuthorized(req.header("authorization"))) {
    res
      .status(401)
      .header("WWW-Authenticate", `Bearer resource_metadata="${PUBLIC_URL}/.well-known/oauth-protected-resource"`)
      .json({ error: "Unauthorized" });
    return;
  }
  next();
});

app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.error(`Tally MCP server running (HTTP) on port ${PORT}`);
  console.error(`Public URL for OAuth discovery: ${PUBLIC_URL}`);
  if (!AUTH_TOKEN) {
    console.error(
      "WARNING: TALLY_MCP_TOKEN is not set — the /mcp endpoint is unauthenticated. " +
        "Set TALLY_MCP_TOKEN before exposing this beyond localhost."
    );
  }
});
