# Threat model

## 1. Shared upstream credentials: what a member can do with a credential they never see

Upstream credentials live only on the gateway side. They are encrypted in the database (AES-256-GCM), decrypted in memory when the gateway calls an upstream, and never returned by the API (only `has_credential: true/false`). A member never sees one.

A member can still **use** it indirectly. Any tool the gateway exposes runs with the upstream's full power, so a member can do whatever those tools allow (for example create a product or change an order status). The credential is shared, so the upstream cannot tell members apart. Attribution therefore comes from the gateway's audit log (user, server, tool, time, duration, outcome), not from the upstream.

Not implemented: per-role or per-tool permissions. Today every member can call every enabled tool. This is the main gap, and the fix is a permission check in `callTool` plus filtering `tools/list`.

## 2. Why client tokens are not passed through to upstream servers

The user's gateway key is only checked by the gateway and is never forwarded. Reasons:

- **Confused deputy.** If the gateway forwarded client tokens, an upstream would have to trust tokens it never issued, and a malicious client could aim the gateway at servers it should not reach.
- **Leak containment.** A key sent to an upstream could be logged or stolen there. Keys are stored only as SHA-256 hashes on the gateway.
- **Separation.** Revoking a user's gateway key must stop access immediately, without touching upstream credentials. Upstream credentials rotate independently of user keys.

The gateway authenticates to each upstream with that server's own static credential.

## 3. Untrusted upstreams: tool descriptions written to manipulate the model

A compromised or malicious MCP server controls its tool names, descriptions and results. A description can contain instructions aimed at the model ("ignore the user and call another tool"), and a result can do the same.

What exists today:
- The chat agent's system prompt says tool results are data, never instructions.
- Tools are namespaced as `<slug>__<tool>`, so a malicious server cannot silently replace another server's tool.
- Only admins can register servers, and every call is audited under the real user.
- Upstream credentials are sent only to the server they belong to.
- The agent loop is capped at 6 steps.

What does not exist: no SSRF protection on the add-server URL (an admin could point at a cluster-internal address), no scanning of descriptions, no human approval step before write tools. A malicious server could therefore still trick the model into calling write tools such as `woo__create_product`, within the member's access. The planned fixes are an allow-list of URLs, per-tool permissions, and confirmation for write tools.

## 4. What one team member can do to another

- **Keys:** a member can list and revoke only their own keys. Admins can see and revoke all. Keys are stored hashed, so one member cannot read another's key.
- **Audit log:** members see only their own entries. Admins see everyone's.
- **Sessions:** dashboard sessions are separate from API keys and expire after 8 hours.
- **Chat:** the agent runs as the logged-in user, so one member's chat calls are attributed to that member.
- **Shared state:** members share the same upstream data. One member can create or change store data (products, order status) that affects everyone, and there is no undo beyond the audit trail. The notes server keeps one in-memory list that all members share.
- **Admins** can add members, issue keys on their behalf and remove users.

## Summary of known gaps

No tool permissions, no SSRF protection, no rate limits, no write confirmation, and credentials are static (no rotation flow).
