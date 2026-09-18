# Deployment

Deployment is prepared but not performed. The frontend targets Vercel and the two backend services target Cloudflare Workers, using one shared D1 database. You need your own accounts, domains, database ID, and encryption secret. Do not deploy the local fixture runner or enable `DEMO_MODE` in production.

## Cloudflare

1. Authenticate Wrangler in your own terminal:

   ```sh
   npx wrangler login
   npx wrangler d1 create mack
   ```

2. Replace `REPLACE_WITH_D1_DATABASE_ID` with the returned ID in **both** `apps/api/wrangler.jsonc` and `apps/gateway/wrangler.jsonc`. Set the real `WEB_ORIGIN`, `GATEWAY_URL`, and `MCP_ALLOWED_HOSTS` values in both files. Their defaults reflect the plan's proposed domains, not provisioned resources.

3. Generate a random 32-byte base64 secret in a password manager or with `openssl rand -base64 32`. Save it securely. Supply exactly the same value to both secret prompts:

   ```sh
   npx wrangler secret put ENCRYPTION_KEY --config apps/api/wrangler.jsonc
   npx wrangler secret put ENCRYPTION_KEY --config apps/gateway/wrangler.jsonc
   ```

4. Apply the schema and deploy:

   ```sh
   npm run db:migrate
   npm run deploy:api
   npm run deploy:gateway
   ```

5. Configure the custom domains `api.usemack.ai` and `mcp.usemack.ai` on their Workers, or use the generated Worker URLs and update your variables accordingly. Workers custom domains require a Cloudflare-managed zone. The checked-in files deliberately do not claim an existing DNS zone.

`ENCRYPTION_KEY` must not go into Wrangler `vars`, source control, the frontend environment, or D1. Keep `DEV_REMOTE_ORIGIN` and `DEMO_MODE` unset on both Workers. Add new approved upstream server hosts to both allowlists before using them.

## Vercel

Import the monorepo with `apps/web` as the project root and Next.js as the framework. Use the repository npm lockfile/workspaces for installation. The project build command is `npm run build` in the web workspace, and Next.js handles the output directory.

Set `API_ORIGIN` to the deployed API Worker origin, for example `https://api.usemack.ai`, before the build. The Next.js rewrite proxies `/api/*` there, allowing host-only session cookies to stay on the web application. Set the same public frontend origin as `WEB_ORIGIN` on both Workers. A different preview domain requires matching Worker configuration or a separate staging backend; production sessions should not be silently shared with arbitrary preview origins.

Add the frontend domain in Vercel and its DNS record. Create your first account and workspace in the UI. No default production admin credentials exist.

## Release checks

Run `npm run check` and `npm run format:check` before deployment. Worker bundles can be checked without provisioning infrastructure:

```sh
npx wrangler deploy --dry-run --config apps/api/wrangler.jsonc --outdir .data/build-api
npx wrangler deploy --dry-run --config apps/gateway/wrangler.jsonc --outdir .data/build-gateway
```

After deployment, verify the API and gateway health endpoints, sign in, add a real server, create a least-privilege client key, and make a real MCP call. Verify that the call appears in Activity and a revoked key is rejected.

This MVP has intentionally limited authentication: no OAuth authorization server, upstream OAuth refresh, password recovery, MFA, or automated email verification. Complete the required identity flows and establish audit retention/cleanup before opening registration broadly. See `architecture.md` for request limits, supported protocol behavior, session isolation, and operational constraints.

### Jev classification

Apply migration `0002_tool_reviews.sql` before deploying the API and gateway together. It disables existing real tools pending manager review. Set `AI_GATEWAY_API_KEY` as an API Worker secret (not on the web frontend); the gateway never calls Jev. See the README’s permission-review section for data-sharing details and the optional labeled evaluation command. Without a key, discovery and explicit manual review remain available.
