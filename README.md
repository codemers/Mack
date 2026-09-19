# Mack

**Connect once. Ask anywhere.**

Mack is a working MVP of the access layer described in the implementation plan: a Next.js dashboard, a Cloudflare control-plane API, and an authenticated MCP gateway. Connect remote MCP servers once, discover their tools, and grant each AI client a controlled view of those tools.

## Run locally

Requires **Node.js 22.13+** (the local adapter uses `node:sqlite`) and npm. Tested with Node.js 25.6.

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:3000**. Use this exact hostname; origin validation intentionally distinguishes `localhost` from `127.0.0.1`.

The command starts four local services:

| Service                | Address                   |
| ---------------------- | ------------------------- |
| Next.js dashboard      | http://127.0.0.1:3000     |
| Control-plane API      | http://127.0.0.1:8787     |
| MCP gateway            | http://127.0.0.1:8788/mcp |
| Local demo MCP servers | http://127.0.0.1:8790     |

The demo signs in as Alex Morgan and provides six **local fixture servers**: GitHub, Slack, Notion, Linear, Gmail, and Google Drive. Discovery and tool calls use the real MCP SDK and transport. Results are explicitly labeled sample data; no actual provider account is connected. There are 27 tools, with 18 read tools enabled initially. No AI client or activity is fabricated.

SQLite state and the local encryption key persist in `.data/` and are ignored by Git. Keep both together to preserve encrypted connections. To try registration and password login, start with `DEMO_MODE=false npm run dev`. The demo account has no password; register a new account. Real services are never seeded in deployed Workers.

## Try the full flow

1. Open **Connections → GitHub** to inspect discovered tools. Toggle a read tool and see its availability change. Write and admin tools are disabled until explicitly enabled.
2. In **Clients**, connect ChatGPT with the Mack endpoint (OAuth) or create a client key for Cursor, Claude Code, or a custom client. Grant GitHub and Linear **Read only** access.
3. Configure a compatible Streamable HTTP MCP client with the endpoint. OAuth clients complete Mack sign-in; bearer clients use `Authorization: Bearer <key>`.
4. The client sees `github_list_issues` and `linear_search_issues`, and routes each call to the right demo server. Real connections receive collision-resistant namespaces.
5. Try the same tools in **Playground** and inspect **Activity** for status, duration, and redacted arguments.
6. Revoke an OAuth client or rotate a bearer key. The old credential immediately stops working.

The playground is a direct JSON tool runner, not a simulated LLM chat. Natural language reasoning belongs to the connected AI client. There is no LLM provider key needed to run Mack.

## Connect a real service

Use **Add connection**, choose personal or workspace ownership, and enter a Streamable HTTP MCP URL with no auth, a bearer token, or an API key. API key headers must begin with `X-`. Tokens are encrypted before storage and never returned to the dashboard or downstream client.

Outbound destinations are deliberately allowlisted to avoid turning the gateway into an arbitrary proxy. Defaults include `api.githubcopilot.com`, `mcp.linear.app`, `mcp.notion.com`, `mcp.slack.com`, and `mcp.stripe.com`. OAuth is available for these providers; GitHub and Slack require registered apps. To approve your own server for local development:

```sh
MCP_ALLOWED_HOSTS=mcp.your-company.com,api.githubcopilot.com npm run dev
```

Use the same comma-separated list on **both** deployed Workers. Only approve server hostnames you control or trust. Production URLs require HTTPS on port 443, reject credentials/query strings/fragments, and cannot redirect to another URL. The sole local HTTP exception is the explicitly configured fixture origin.

**MCP OAuth is supported for incoming AI clients and upstream servers.** See [OAuth setup](docs/oauth.md). ChatGPT and other OAuth-only connectors sign in through Mack. Bearer-token integrations such as Cursor, Claude Code, and custom clients still work. Personal access tokens only work when the upstream MCP server itself accepts them.

## What is implemented

- Next.js App Router, React, Tailwind, and accessible Radix/shadcn-style UI primitives.
- Responsive connections dashboard, search, scope filters, grid/list views, details, refresh, pause/resume, and removal.
- Remote MCP initialization, paginated tool discovery, namespacing, input-schema validation, and routing.
- MCP tools exposed through the official SDK's stateless, JSON-response Streamable HTTP transport. Handshake-based MCP revisions supported by SDK v1 are negotiated by the SDK; the new 2026 protocol is not claimed.
- Resource/prompt capability inspection during discovery; resource/prompt **routing is not exposed**.
- Personal and workspace connections, owner/admin/member roles, teams, explicit user/team/client grants, and per-tool grants through the API.
- Client keys displayed once, SHA-256 hashes at rest, connection permission editing, rotation, revocation, and actual last-used timestamps.
- Email/password signup and login, HttpOnly sessions, sign-out, profile editing, and workspace creation.
- Workspace invitations with expiring, hashed links bound to the invited email. Copy and deliver the link yourself; no email is sent automatically.
- AES-256-GCM upstream credentials with a fresh nonce and connection-bound authenticated data, plus credential replacement.
- Auditing of successful, failed, and denied calls, sensitive-key redaction, activity details, and JSON export of the displayed results (latest 200).
- Origin validation, body limits, upstream response limits/timeouts, destination allowlisting, and atomic request-rate limits.
- D1 migrations, separate Worker configurations, a local SQLite adapter, and integration tests.

## Repository

```text
apps/
  web/                 Next.js dashboard and UI components
  api/                 Hono control-plane Worker
  gateway/             MCP Worker and tool execution service
packages/
  db/                  Database interface and D1 migration
  auth/                Session/client authentication and rate limits
  crypto/              Credential encryption, password and token hashing
  mcp/                 Upstream SDK client and outbound restrictions
  oauth/               Mack as OAuth client to upstream MCP servers
  oauth-server/        Mack as OAuth authorization server for AI clients
  permissions/         Shared permission evaluator
  shared/              Domain types and errors
  tool-registry/       Discovery, risk classification, public tool mapping
scripts/               Local servers, SQLite adapter, and fixtures
 tests/                Backend and protocol integration tests
```

UI primitives live in `apps/web/components/ui` until another frontend needs to share them. D1 is the source of truth; permissions are re-evaluated on every list/call rather than cached. KV, R2, Queues, and Durable Objects are deferred until their respective workload exists.

## Verify

```sh
npm run typecheck
npm test
npm run build
npm run format:check
```

`npm run check` runs type checking, backend tests, and the production frontend build. The tests use a fresh in-memory SQLite database and in-process MCP fixture servers, without real credentials or network access. The production build uses webpack to work in environments that prohibit Turbopack's temporary subprocess sockets.

See [architecture and security](docs/architecture.md) and [deployment](docs/deployment.md) for the access model, operational details, and remaining production work.

## What remains

This implements the plan's gateway/UI MVP and the core workspace and permission flows. It is not the complete enterprise roadmap. Conversational model integration, invitation email delivery, email verification/password recovery, MFA/SSO/SCIM, approvals, delegated identity, billing, persistent resource/prompt routing, KV caches, R2/Queue auditing, suspicious-request detection, and realtime sessions remain future work. Staging uses Vercel and Cloudflare Workers; deployment configuration is documented separately.

### Jev-assisted permission review

Set `AI_GATEWAY_API_KEY` in the environment before `npm run dev`, then refresh a real connection. In production, set it as an API Worker secret with `npx wrangler secret put AI_GATEWAY_API_KEY --config apps/api/wrangler.jsonc` and apply migrations before deploying both Workers. Never use a `NEXT_PUBLIC_` variable for this key.

Connection details show Jev’s advisory suggestion and a **Review permissions** form. A manager verifies the tool’s behavior, selects the enforced level, records a rationale, and explicitly enables it. Pending tools cannot be listed or called through the gateway, even by owners. Changes to a tool’s definition revoke its approval. Existing non-demo tools become disabled pending review when migration 0002 runs.

Only tool metadata (name, description, input schema, annotations) is sent to Vercel AI Gateway/TypeSafe, with zero data retention requested. Metadata can contain sensitive descriptions or schema examples: connect only servers whose metadata may be shared. Credentials, invocation arguments, and results are not included. Each evaluation has a 10-second timeout and no retries; discovery starts at most 20 evaluations within a 20-second start window. Excess tools remain uncertain for manual review. Unchanged successful assessments are cached; refresh retries missing configuration and errors. Jev is optional: without a key, manual review still works.

The 90% model probability threshold is provisional, not a calibrated confidence guarantee. Run the synthetic labeled evaluation with `npm run eval:jev` after providing a key; it makes paid model calls and prints expected versus observed classifications. No live model accuracy is claimed by the mocked integration tests. Real read-only protection also requires restricted upstream credentials; a remote server can misrepresent what a tool does.
