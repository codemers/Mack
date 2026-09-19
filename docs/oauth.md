# MCP OAuth

Mack is both an OAuth authorization server for incoming AI clients and an OAuth client for upstream MCP servers.

## Incoming AI clients

External MCP clients such as ChatGPT, Claude, and Cursor can connect to the Mack gateway with OAuth 2.1 instead of a pasted bearer key. Add the gateway URL as a connector. Mack advertises protected-resource metadata, supports PKCE S256, dynamic client registration, and Client ID Metadata Documents.

| Piece                         | Location                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| MCP resource                  | `GATEWAY_URL`, for example `https://mack-gateway-staging.blogue.workers.dev/mcp`                       |
| Protected resource metadata   | `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp` on the gateway |
| Authorization server metadata | `/.well-known/oauth-authorization-server` on the gateway                                               |
| Sign-in and consent           | `{WEB_ORIGIN}/oauth/authorize` after the gateway validates the OAuth request                           |
| Tokens                        | Gateway `/oauth/token`, hashed access tokens with a one-hour lifetime and rotated refresh tokens       |

Unauthenticated `/mcp` requests return `401` with a `WWW-Authenticate` challenge that includes `resource_metadata` and `scope="mcp"`. The user signs in with their Mack session, chooses workspace context, and grants per-connection access. Those grants use the same client permission model as bearer keys. OAuth access tokens are bound to the gateway resource URL. Reconnect from the AI client to refresh access; rotating a key in the dashboard is disabled for OAuth clients.

### Claude custom connector

In Claude, add a custom connector and paste the gateway MCP URL, for example `https://mack-gateway-staging.blogue.workers.dev/mcp`. Leave **OAuth Client ID** blank. Claude registers itself through Mack’s `/oauth/register` endpoint, then opens Mack sign-in in the browser.

If Claude shows “Couldn’t register with Mack’s sign-in service” and an `ofid_…` reference, registration never completed.

Incoming OAuth must be deployed first. Staging still serving `{"error":"Not found"}` for `/.well-known/oauth-authorization-server` or `POST /oauth/register` cannot complete Claude DCR. Apply migration `0004_incoming_oauth.sql`, then deploy both Workers. Confirm discovery yourself:

```sh
curl -sI https://mack-gateway-staging.blogue.workers.dev/mcp
curl -s https://mack-gateway-staging.blogue.workers.dev/.well-known/oauth-authorization-server
curl -s -D - -X POST https://mack-gateway-staging.blogue.workers.dev/oauth/register \
  -H 'content-type: application/json' \
  -d '{"client_name":"Claude","redirect_uris":["https://claude.ai/api/mcp/auth_callback","https://claude.com/api/mcp/auth_callback"],"token_endpoint_auth_method":"none"}'
```

Protected-resource metadata and registration must return JSON, not `Not found`. A successful register response is `201` with a `client_id`.

Claude’s connector broker often cannot reach `*.workers.dev` hostnames. Put the gateway on a normal HTTPS hostname (for example `mcp.usemack.ai`) and use that URL in Claude. The `ofid_…` value is Claude’s internal flow id. Mack cannot look it up; share it with Anthropic support if discovery and registration already succeed from `curl`.

Claude Code can still use a bearer client key from the Mack dashboard if you do not need Claude.ai’s OAuth connector.

Apply migration `0004_incoming_oauth.sql` before deploying both Workers:

```sh
npm run db:migrate
npm run deploy:api
npm run deploy:gateway
```

Bearer keys still work for clients that do not speak OAuth.

## Upstream MCP servers

Mack also acts as an OAuth client to remote MCP servers.

| Provider                   | Connection                           | Operator setup                                                                                                                                                                                       |
| -------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear                     | `https://mcp.linear.app/mcp`         | Dynamic registration; defaults to the `read` scope.                                                                                                                                                  |
| Notion                     | `https://mcp.notion.com/mcp`         | Dynamic registration; provider's `default` scope.                                                                                                                                                    |
| GitHub                     | `https://api.githubcopilot.com/mcp/` | Register a GitHub App or OAuth App and configure its client ID and secret. Default OAuth App scopes are `repo read:org` and may grant write access; GitHub App permissions are configured in GitHub. |
| Slack                      | `https://mcp.slack.com/mcp`          | Register an internal or marketplace-published Slack app and configure its client ID and secret. Unlisted apps cannot use Slack MCP. Defaults to a subset of read scopes.                             |
| Stripe (Custom MCP server) | `https://mcp.stripe.com`             | Dynamic registration; review permissions on Stripe's consent screen. Use a sandbox account for testing.                                                                                              |
| Other custom servers       | Operator-approved HTTPS endpoint     | RFC 9728/RFC 8414 discovery, S256 PKCE, and dynamic registration or configured client credentials. Separate authorization origins require explicit operator approval.                                |

Gmail and Drive entries in the local demo are fixture servers, not hosted Google MCP integrations. They do not become live Google connections through this feature.

## Setup

Apply migration 0003 before deploying both API and gateway Workers:

```sh
npm run db:migrate
npm run deploy:api
npm run deploy:gateway
```

Vercel deploys the updated UI from GitHub. Keep `API_ORIGIN` pointing to the API Worker. OAuth callbacks use the frontend origin so the existing Mack session cookie accompanies the callback through the Next.js `/api/*` proxy.

The staging redirect URI is exactly:

```text
https://mack-teal.vercel.app/api/oauth/callback
```

For GitHub and Slack, register that exact URL with the provider. Store a JSON object as the **API Worker's** `OAUTH_CLIENTS_JSON` secret:

```json
{
  "api.githubcopilot.com": {
    "client_id": "YOUR_GITHUB_CLIENT_ID",
    "client_secret": "YOUR_GITHUB_CLIENT_SECRET",
    "scope": "repo read:org"
  },
  "mcp.slack.com": {
    "client_id": "YOUR_SLACK_CLIENT_ID",
    "client_secret": "YOUR_SLACK_CLIENT_SECRET"
  }
}
```

```sh
npx wrangler secret put OAUTH_CLIENTS_JSON --config apps/api/wrangler.jsonc
```

Use a secret prompt; never commit real values or put them in Vercel frontend variables. Only include configured providers. GitHub Apps can set `scope` to an empty string to use their configured app permissions. New connections encrypt the necessary client credentials alongside their tokens; the gateway can refresh them without its own copy of the operator configuration. Reconnect connections after rotating app secrets.

For custom servers, add the MCP host to `MCP_ALLOWED_HOSTS` on both Workers. If authorization is on a different origin, also add its exact HTTPS origin to the comma-separated `OAUTH_ALLOWED_ORIGINS` setting on both Workers. Built-in providers use fixed per-provider trusted origins, preventing cross-provider redirects. Custom pre-registered clients use the same JSON format, keyed by MCP hostname. Servers requiring only client-ID metadata documents, device grants, or non-PKCE legacy flows are not supported in this version.

## User flow

Open Connections → Add connection → choose a provider → OAuth sign-in. Set personal or workspace scope and select permissions from the discovered OAuth scope checklist. Complete the provider's sign-in and consent. Mack discovers tools after the callback and keeps them disabled pending review. Workspace connections share the authorizing account's upstream access under Mack's existing grants; choose personal for private access.

Use Reconnect with OAuth when access is revoked or refresh fails. Reconnect requests the currently configured default scopes and invalidates tool approvals. To choose different scopes, create a new connection with the desired permission selection. Disconnect deletes Mack's saved credentials; revoke the authorization in the provider's settings if you also want to remove the upstream grant.

## Security and validation

- Ten-minute, one-use, encrypted authorization transactions bound to the initiating Mack user. A valid Mack session is required on callback; an expired session requires restarting sign-in.
- S256 PKCE, exact redirect URI, pinned discovered issuer and resource, and HTTPS endpoint allowlists. Redirects from server-side OAuth requests are rejected.
- Credentials, refresh tokens, and client secrets are encrypted in D1 and never returned in connection APIs. OAuth responses are capped at 256 KiB and requests have 12-second timeouts.
- Tokens refresh before expiry. A database lease prevents concurrent refresh-token rotation; callers encountering the lease receive a retryable conflict. Conditional writes prevent an older refresh from overwriting reconnection credentials.
- Scope and provider consent do not bypass tool review or user/client permissions. Only Linear's documented `read` scope is specifically presented as upstream read-only enforcement. Other providers' capabilities follow their consent grants and account permissions.

The test suite uses mocked OAuth servers through the real MCP SDK for discovery, DCR, PKCE exchange, failure cases and refresh. Live public discovery metadata was inspected for built-in providers; no real account consent or authenticated provider calls were performed during implementation.

Provider references: [Linear MCP](https://linear.app/docs/mcp), [Notion's MCP integration guide](https://github.com/makenotion/notion-cookbook/blob/main/docs/mcp-client-integration.md), [GitHub MCP host integration](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md), [Slack MCP](https://docs.slack.dev/ai/slack-mcp-server/), [Stripe MCP](https://docs.stripe.com/mcp).

### Permission selection

The authenticated `/api/oauth/scopes` endpoint discovers the approved server's authorization and resource metadata without registering a client or creating an OAuth request. The UI lists their combined advertised scopes, preselecting only configured/provider defaults. Known scopes have friendly descriptions and access labels; unknown scopes are explicitly provider-defined. Discovery failures show a retry action and prevent starting with hidden defaults. Selecting no permissions cannot silently restore broader defaults.

An app configured with an empty `scope` uses provider-managed permissions (for example GitHub Apps). Servers without published scopes use configured defaults when present, otherwise their consent screen. Tool approvals remain separate: no undocumented scope-to-tool mapping is inferred. Existing OAuth reconnects continue to use configured defaults.

Description references: [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication), [GitHub scopes](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps), [Slack MCP](https://docs.slack.dev/ai/slack-mcp-server/).
