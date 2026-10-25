# System design and tradeoffs

## Architecture choices

- **Gateway as client and server.** It is an MCP client to every upstream and an MCP server to users, so clients need one URL and one key and upstream details stay server-side.
- **Streamable HTTP, stateless.** A new MCP server object is created per request, so no session is kept in memory. The limit is SQLite being single-writer, so I run one gateway replica. Scaling out would mean moving to Postgres.
- **SQLite on a PVC.** One file, no extra database to run. It is the reason the gateway uses the `Recreate` strategy.
- **REST API for the store.** Official, authenticated, and needs no shell access to the WordPress pod.
- **nginx in front of the gateway.** Dashboard, `/api` and `/mcp` share one host, so there is no CORS setup.
- **Helm per component.** Five charts. `values.yaml` holds defaults and `values-local.yaml` / `values-prod.yaml` override only what differs.

## Tool aggregation and routing

1. The gateway reads the enabled servers from the database.
2. It refreshes each server's tool list in parallel with `Promise.allSettled`, cached for 10 seconds.
3. Every tool is exposed as `<slug>__<tool>`. Slugs cannot contain underscores, so splitting on the first `__` is unambiguous.
4. On `tools/call` the gateway splits the name, finds the enabled server, calls it with that server's credential, and returns the result.

**Collisions.** `notes__search` and `utils__search` coexist. I always prefix instead of prefixing only on collision, because names would otherwise change when a server is added.

## Failure handling

- Every connect, list and call has a timeout (`UPSTREAM_TIMEOUT_MS`).
- A dead or slow server only loses its own tools. Others keep working.
- A failed call returns a clear tool error and an audit row.
- Disabling a server removes its tools from the chat agent and external clients within the 10-second cache.
- Tested by deleting an upstream pod: the dashboard shows it unreachable until Kubernetes replaces it.

## Credentials

- User API keys are stored as SHA-256 hashes. The raw key is shown once.
- Dashboard passwords use scrypt with a per-user salt.
- Upstream credentials are encrypted at rest with AES-256-GCM, with the key from a Kubernetes Secret.
- The API never returns an upstream credential, only `has_credential: true/false`.

## What changes for production

| Area | Local | Production-like VPS |
|---|---|---|
| DNS | `*.localtest.me` | real domains pointing at the VPS |
| Ingress | k3d Traefik on port 8080 | k3s Traefik on 80/443, TLS via cert-manager |
| Images | `k3d image import` | pushed to a registry, `pullPolicy: Always` |
| Storage class | `local-path` | `local-path` on k3s, or the provider's class |
| Secrets | created by hand with kubectl | by hand, or a secret manager |

I have **not** deployed this to a VPS. The prod values hold placeholders and were only linted. The store chart's Ingress has no TLS block yet.

## Tradeoffs and known limits

- One gateway replica because of SQLite.
- The first request after a restart can time out because WordPress starts slowly.
- No rate limits, tool permissions or SSRF protection.
- Chat uses the free Gemini tier, which can be slow or rate-limited.
