# Upstream MCP OAuth

Mack acts as an OAuth client to remote MCP servers. This does not make Mack an OAuth authorization server for incoming AI clients; those still use Mack client keys.

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

Open Connections → Add connection → choose a provider → OAuth sign-in. Set personal or workspace scope and optionally override the displayed OAuth scopes. Complete the provider's sign-in and consent. Mack discovers tools after the callback and keeps them disabled pending review. Workspace connections share the authorizing account's upstream access under Mack's existing grants; choose personal for private access.

Use Reconnect with OAuth when access is revoked or refresh fails. Reconnect requests the currently configured default scopes and invalidates tool approvals. To choose different scopes, create a new connection with the desired scope field. Disconnect deletes Mack's saved credentials; revoke the authorization in the provider's settings if you also want to remove the upstream grant.

## Security and validation

- Ten-minute, one-use, encrypted authorization transactions bound to the initiating Mack user. A valid Mack session is required on callback; an expired session requires restarting sign-in.
- S256 PKCE, exact redirect URI, pinned discovered issuer and resource, and HTTPS endpoint allowlists. Redirects from server-side OAuth requests are rejected.
- Credentials, refresh tokens, and client secrets are encrypted in D1 and never returned in connection APIs. OAuth responses are capped at 256 KiB and requests have 12-second timeouts.
- Tokens refresh before expiry. A database lease prevents concurrent refresh-token rotation; callers encountering the lease receive a retryable conflict. Conditional writes prevent an older refresh from overwriting reconnection credentials.
- Scope and provider consent do not bypass tool review or user/client permissions. Only Linear's documented `read` scope is specifically presented as upstream read-only enforcement. Other providers' capabilities follow their consent grants and account permissions.

The test suite uses mocked OAuth servers through the real MCP SDK for discovery, DCR, PKCE exchange, failure cases and refresh. Live public discovery metadata was inspected for built-in providers; no real account consent or authenticated provider calls were performed during implementation.

Provider references: [Linear MCP](https://linear.app/docs/mcp), [Notion's MCP integration guide](https://github.com/makenotion/notion-cookbook/blob/main/docs/mcp-client-integration.md), [GitHub MCP host integration](https://github.com/github/github-mcp-server/blob/main/docs/host-integration.md), [Slack MCP](https://docs.slack.dev/ai/slack-mcp-server/), [Stripe MCP](https://docs.stripe.com/mcp).
