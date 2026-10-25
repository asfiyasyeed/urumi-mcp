# MCP Gateway on Kubernetes

A WooCommerce store on Kubernetes, a self-written WooCommerce MCP server, and a team MCP gateway with a React dashboard and a chat agent. Admins register MCP servers once. Every team member then uses all of them through one MCP endpoint, or through the chat agent in the dashboard.

## Architecture

```
Browser / Chat --> nginx (dashboard) --> Gateway --+--> mcp-woo --> WordPress/WooCommerce --> MariaDB
External MCP client ------------------> Gateway --+--> mcp-notes
                                                  +--> mcp-utils
```

| Component | Namespace | What it does |
|---|---|---|
| store (WordPress, WooCommerce, MariaDB) | `store` | The shop. Data is on PVCs. |
| mcp-woo | `mcp` | My own MCP server. Talks to the store through the WooCommerce REST API. |
| mcp-notes, mcp-utils | `mcp` | Two small extra MCP servers. Both expose a `search` tool to demonstrate name collisions. |
| gateway | `mcp` | MCP client to every upstream, MCP server to users. Login, API keys, audit log, chat agent. |
| dashboard | `mcp` | React app served by nginx. nginx forwards `/api` and `/mcp` to the gateway. |

Only the storefront and the dashboard have an Ingress. The MCP servers are ClusterIP only, and a NetworkPolicy allows only pods labelled `app: gateway` to reach them.

## Why the REST API for the store

The MCP server uses the WooCommerce REST API (`/wp-json/wc/v3`). It is the official, authenticated, stable interface and needs no shell access to the WordPress pod. WP-CLI would need `kubectl exec` into the pod, which is fragile and gives far too much power.

## Local setup

Needs Docker, kubectl, helm and k3d.

1. Create the cluster: `k3d cluster create mcp -p "8080:80@loadbalancer"`
2. Local domains: `*.localtest.me` resolves to 127.0.0.1, so `store.localtest.me:8080` and `mcp.localtest.me:8080` work with no hosts-file edit.
3. Create the Secrets (never committed):
   - namespace `store`: `store-secrets` with keys `db-root-password`, `db-password`, `wp-admin-password`
   - namespace `mcp`: `gateway-secrets` with keys `credential-key`, `gemini-api-key`, and `woo-api-keys` with keys `consumer-key`, `consumer-secret` (created in WooCommerce > Settings > Advanced > REST API)
4. Build and import the images:
   ```
   docker build -t mcp-woo:0.1.0 apps/mcp-woo
   docker build -t mcp-extra:0.1.0 apps/mcp-extra
   docker build -t mcp-gateway:0.1.0 apps/gateway
   docker build -t mcp-dashboard:0.1.1 apps/dashboard
   for i in mcp-woo:0.1.0 mcp-extra:0.1.0 mcp-gateway:0.1.0 mcp-dashboard:0.1.1; do k3d image import $i -c mcp; done
   ```
5. Install the charts:
   ```
   helm install store charts/store -n store --create-namespace -f charts/store/values-local.yaml
   helm install mcp-woo charts/mcp-woo -n mcp --create-namespace -f charts/mcp-woo/values-local.yaml
   helm install mcp-extra charts/mcp-extra -n mcp -f charts/mcp-extra/values-local.yaml
   helm install gateway charts/gateway -n mcp -f charts/gateway/values-local.yaml
   helm install dashboard charts/dashboard -n mcp -f charts/dashboard/values-local.yaml
   ```
6. Finish the WordPress install at http://store.localtest.me:8080, install WooCommerce, enable Cash on delivery, set WooCommerce > Settings > Site visibility to Live, and set Permalinks to "Post name".
7. Create the first admin (only works while the users table is empty):
   ```
   kubectl -n mcp exec deploy/gateway -- env ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='choose-a-password' node -e "import('./db.js').then(m=>m.seedAdmin())"
   ```
8. Log in at http://mcp.localtest.me:8080 and register the three servers in the Servers tab with these URLs:
   - `http://mcp-woo.mcp.svc.cluster.local:3000/mcp` (slug `woo`)
   - `http://mcp-notes.mcp.svc.cluster.local:3000/mcp` (slug `notes`)
   - `http://mcp-utils.mcp.svc.cluster.local:3000/mcp` (slug `utils`)

## Using it

**Place an order:** open http://store.localtest.me:8080/shop, add a product, check out with Cash on delivery. The order shows in WooCommerce > Orders.

**Chat agent:** log in at http://mcp.localtest.me:8080, open Chat, and ask for example "Create a product called Demo Pen priced 49" or "What orders came in today?". The tools called are shown under each answer, and the calls appear in the Audit log under your own user.

**External MCP client:** in My API key, generate a key, then connect with only the gateway URL and the key:
- URL: `http://mcp.localtest.me:8080/mcp`
- Header: `Authorization: Bearer <your key>`
- MCP Inspector v0.16.0 works: choose Streamable HTTP, set the URL, and put the key in Authentication. Command line: `npx @modelcontextprotocol/inspector --cli <url> --transport http --header "Authorization: Bearer $KEY" --method tools/list`

## Tool name collisions

Every tool is exposed as `<server-slug>__<tool>`, for example `notes__search` and `utils__search`. The scheme is deterministic, so names never change when a server is added.

## Failure handling

Each upstream connection and call has a timeout (`UPSTREAM_TIMEOUT_MS`). Servers are refreshed in parallel with `Promise.allSettled`, so a dead server only loses its own tools. A failed call returns a clear error and is written to the audit log.

## Upgrade and rollback

```
helm upgrade store charts/store -n store -f charts/store/values-local.yaml --set resources.wordpress.limits.memory=1500Mi
helm history store -n store
helm rollback store 1 -n store
```

## Production-like VPS

The same charts are used with `values-prod.yaml` in each chart folder. Domain, `https`, storage class, image registry and ingress annotations change. **This has not been deployed to a real VPS.** The prod values contain placeholder domains and registry names and were only linted.

## Where things are

- `apps/mcp-woo`: the WooCommerce MCP server
- `apps/mcp-extra`: the notes and utils MCP servers
- `apps/gateway`: gateway, auth, audit log, chat agent
- `apps/dashboard`: React dashboard
- `charts/`: one Helm chart per component
- `docs/`: design note and threat model

## Known issues

- The first request after a restart can be slow (cold WordPress) and may time out once.
- Not implemented: multi-store provisioning, OAuth, tool permissions, SSRF protection, rate limits.
- Upstream credentials are encrypted in the database with AES-256-GCM. The key comes from a Kubernetes Secret.
- Chat uses the Gemini free tier (gemini-3.5-flash-lite), which can be slow or rate-limited.
