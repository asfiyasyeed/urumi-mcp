# My notes: MCP Gateway on Kubernetes (Urumi Round 1)

These notes are me explaining the whole project to myself. If I can read a section, close the file, and explain it out loud, I am ready for Round 2. No passwords or keys are written here.

---

## 0. The big picture in 60 seconds

I built a system with four layers, all running in Kubernetes:

1. **Store:** WordPress + WooCommerce + MariaDB. This is a real shop with a storefront and an admin area.
2. **WooCommerce MCP server:** a small program I wrote myself. It exposes the store's products and orders as *tools* that an AI client can call.
3. **Gateway + dashboard:** the gateway is an MCP *client* to every upstream server and also an MCP *server* to users. It merges all the tools into one list behind one URL and one API key per person. The dashboard is a React app where an admin manages servers and members.
4. **Chat agent:** a chat page in the dashboard. It sends my question and the tool list to an LLM (Gemini). When the LLM wants a tool, the gateway runs it **as the logged-in user** and feeds the result back, in a loop, until the model answers.

The most important sentence: **nothing talks to the upstream MCP servers except the gateway.** Both the chat agent and external clients (like MCP Inspector) go through the gateway, and the upstream servers are private inside the cluster.

---

## 1. What was asked (the assignment)

**Company:** Urumi, AI FDE Internship, Round 1 take-home. Round 2 is an interview and live walkthrough of my submission. Round 3 is an interview with the founders.

**Rules about AI:** I may use AI tools, but I must be able to explain what I built, why it works, the Kubernetes resources, the MCP protocol flow, how credentials move, and where isolation is enforced.

**Mandatory requirements, in my own words:**

- Run on local Kubernetes (I used k3d) and be deployable to a VPS (k3s) with the **same Helm charts**, changing only values files. Helm is mandatory (no Kustomize).
- Everything runs in the cluster: store, database, MCP server, gateway, dashboard.
- The database and WordPress content use persistent storage.
- Storefront and dashboard exposed through Ingress with stable URLs. I must document my local domain approach.
- Readiness and liveness probes, and resource requests and limits, on every workload.
- No hardcoded secrets in source. Credentials live in Kubernetes Secrets.
- **WooCommerce MCP server:** written by me, Streamable HTTP, at least these tools: list products, create product, list orders, get order, update order status. Not reachable from outside the cluster. I must document how it talks to the store and why.
- **Gateway:** admins add, edit, disable and remove upstream servers (with an optional static credential). One MCP endpoint lists the tools of every enabled server and routes calls. Two servers may have the same tool name, so I need a documented collision scheme. A slow or dead upstream must not break the others (timeouts, clear errors). Upstream credentials never go to the browser or to MCP clients. At least **three** upstream servers.
- **Team and access:** at least admin and member roles. Each user has their own API key. Keys can be revoked and are stored hashed. Every tool call goes in an audit log (user, server, tool, time, duration, outcome), visible in the dashboard.
- **Chat agent:** uses an LLM to call tools through the gateway, shows which tools it called, acts as the logged-in user (so the audit log shows that user). LLM API key is a secret like all others.
- **Deliverables:** README, source code, Helm charts with local and prod values, a "System design and tradeoffs" note, a threat model note, a demo video, and the GitHub repo.

**The definition of done (what the video must show):** order on the storefront; chat as user A creates a product and finds today's order; external client as user B lists tools, asks the same orders question, and runs a prompt using two upstream servers; revoke B's key (next call rejected); disable a server (its tools disappear from chat and external client); kill an upstream pod (others keep working, dashboard shows it unreachable); every call is in the audit log under the right user.

**Optional:** multi-store provisioning bonus and "stand-out" items (VPS, tool permissions, OAuth, many tools, hosted servers, security hardening, scaling, observability, upgrades and rollback).

**My decisions about the optional parts:** I answered **No** to multi-store (not enough time, and a half-built bonus is risky in an interview). I did **not** deploy to a real VPS. I did upgrade and rollback with Helm on the store and documented it.

---

## 2. Timeline (so I remember how it went)

- Invite email arrived 8 Oct. I started 18 Oct. Deadline: **26 Oct, 11:59 PM IST**. I decided not to message anyone about the process and just work to the deadline.
- 18 Oct: installed tools, made a cluster, practised Kubernetes basics, pushed the repo, tried MCP Inspector.
- 20 Oct: store on Kubernetes (MariaDB, WordPress, Ingress), WooCommerce set up, first COD order, persistence test, REST API keys.
- 21 Oct: wrote the WooCommerce MCP server, containerised it, deployed it privately with a NetworkPolicy, converted the store to Helm.
- 22 to 23 Oct: gateway backend (database, auth, aggregation, audit), extra MCP servers, admin API, dashboard, chat agent.
- 24 Oct: deployed the gateway and dashboard into Kubernetes.
- 25 Oct: rehearsal of the full demo, Helm charts for all components, README, design note, threat model note.
- 26 Oct: record the video and submit (early, not in the last hour).

---

## 3. Tools I installed and what each one is for

| Tool | What it is | Why I need it |
|---|---|---|
| **WSL2 + Ubuntu** | A Linux system inside Windows | Kubernetes tools are built for Linux. All my commands run here. |
| **Docker Desktop** | Runs containers (packaged apps with everything they need) | k3d runs Kubernetes inside Docker, and I build my images with it. |
| **k3d** | Creates a small Kubernetes cluster inside Docker | Same k3s family I'd use on a VPS, so the local-to-prod story is simple. |
| **kubectl** | The remote control for Kubernetes | I send commands to the cluster with it. |
| **helm** | Package manager: templates + values files make Kubernetes YAML | One chart works locally and in production with different values. |
| **Node.js** | JavaScript runtime | Used to write the MCP servers, gateway and dashboard. I started on Node 20 and switched to **Node 22** because npm had a bug (see problems). |
| **git + GitHub** | Version control | Repo is `asfiyasyeed/urumi-mcp`. GitHub does not accept passwords in the terminal, I use a **Personal Access Token**. |

**Cluster command:** `k3d cluster create mcp -p "8080:80@loadbalancer"`. The `-p` flag maps my laptop's port 8080 to the cluster's ingress controller (Traefik, which k3s ships with).

**Local domain approach (the assignment asks me to document this):** `*.localtest.me` is a public domain where every subdomain resolves to 127.0.0.1. So `store.localtest.me:8080` and `mcp.localtest.me:8080` work with no hosts-file edit.

**Restart routine each day:** open Docker Desktop, then `nvm use 22`, `k3d cluster start mcp`, `kubectl get nodes`, check pods are `1/1`, open the store once so WordPress is warm.

---

## 4. Kubernetes concepts, in my own words

- **Pod:** one or more containers running together. The smallest unit.
- **Deployment:** keeps N identical pods running. If I delete a pod, a new one appears (self-healing). Used for stateless apps.
- **StatefulSet:** like a Deployment but pods have stable names (`mariadb-0`) and their own disk. Used for databases.
- **Service:** a stable internal address and DNS name in front of pods, because pod IPs change. **ClusterIP** means reachable only inside the cluster.
- **Ingress:** routes outside HTTP traffic by hostname to a Service. Traefik is the controller doing the work.
- **PVC (PersistentVolumeClaim):** a request for disk that outlives the pod. With k3s the storage class is `local-path`.
- **Secret:** holds passwords and keys, outside my code. Pods read them as environment variables via `secretKeyRef`. A Secret only works in its own namespace, so I copied `woo-api-keys` into `mcp`.
- **ConfigMap:** non-secret config (I didn't need one).
- **Namespace:** a folder inside the cluster. I used `store` for the shop and `mcp` for everything MCP.
- **Probes:** **readiness** = "can I receive traffic?" (if it fails, the pod is removed from the Service but not restarted). **liveness** = "am I stuck?" (if it fails, Kubernetes restarts the container).
- **Requests / limits:** request = guaranteed minimum CPU/memory. Limit = hard cap. Going over a memory limit gets the container killed (OOMKilled).
- **NetworkPolicy:** a firewall rule between pods. Mine says "only pods labelled `app: gateway` may reach the MCP servers on port 3000."
- **Helm:** a *chart* is templates plus `values.yaml`. A *release* is one installed copy of a chart. Local and prod differ only by values files.

---

## 5. Part A: the store on Kubernetes

### What I built

All in namespace `store`, later managed by the Helm chart `charts/store`.

1. **Secret `store-secrets`** with keys `db-root-password`, `db-password`, `wp-admin-password`. Created with `kubectl create secret generic`, never committed.
2. **MariaDB as a StatefulSet** (`mariadb:11.4`), a headless Service, a 2Gi PVC via `volumeClaimTemplates`, readiness probe with `healthcheck.sh`, liveness TCP probe on 3306, requests 100m/256Mi, limits 500m/512Mi. Why a StatefulSet: stable identity and its own disk per replica.
3. **WordPress as a Deployment** (`wordpress:6-apache`) with a 2Gi PVC at `/var/www/html`, a Service, strategy **Recreate** (a ReadWriteOnce disk attaches to one pod at a time, so the old pod must stop first), `fsGroup: 33` (so the `www-data` user can write the volume), DB password from the Secret.
4. **`WORDPRESS_CONFIG_EXTRA`** sets `WP_HOME` and `WP_SITEURL` to the public address, and treats a request as HTTPS when the header `X-Forwarded-Proto: https` is present. I need that later for the REST API.
5. **Ingress** routing `store.localtest.me` to the WordPress Service.

### Setting up WooCommerce (done in the browser)

- Finished the WordPress install, installed WooCommerce, enabled **Cash on delivery**, set permalinks to **Post name** (the REST API needs clean URLs like `/wp-json/wc/v3/...`).
- New WooCommerce hides the storefront in "Coming soon" mode. I had to set **WooCommerce > Settings > Site visibility > Live**. Without it the shop asks for a login.
- Created the product `Test Mug` at 199 and placed a COD order from the storefront. It appeared under WooCommerce > Orders.

### Persistence test (goes in the demo)

Deleted `mariadb-0` and the WordPress pod. After they came back, the product, the order and the plugin were still there. That proves the PVCs work.

### Problem I hit: "no available server"

After installing WooCommerce the page showed "no available server" (Traefik message). `kubectl get pods` showed WordPress `0/1 Running`. The pod's Events said: `Readiness probe failed ... context deadline exceeded`. The probe was an HTTP check on `/wp-login.php` with the default **1 second timeout**, and WordPress was slower than that (and that URL redirects to the public hostname).

I first guessed it was memory (OOM) or CPU. **Those guesses were wrong**. The pod was using about 335Mi and 148m, well below the limits. The real evidence was the event line. The fix: switch to a **TCP probe** with `timeoutSeconds: 10` and `failureThreshold: 6`, and raise limits to CPU 1 and memory 1Gi.

**What to say in the interview:** a failing readiness probe removes the pod from the Service (so Traefik says "no available server") without restarting it. A failing liveness probe restarts it. Probes have a timeout (default 1s) and a slow app like WordPress needs more. Always read the Events before guessing.

---

## 6. Part B: the WooCommerce MCP server (`apps/mcp-woo`)

### How it talks to the store, and why

It uses the **WooCommerce REST API** (`/wp-json/wc/v3`), authenticated with a **consumer key and secret** (like a username and password for programs) created in WooCommerce > Settings > Advanced > REST API with Read/Write permission. They live in the Kubernetes Secret `woo-api-keys` (keys `consumer-key`, `consumer-secret`).

**Why REST:** it is the official, stable, authenticated interface, and it needs no shell access to the WordPress pod. WP-CLI would need `kubectl exec` into the pod, which is fragile and gives far too much power.

### Details I must remember

- Inside the cluster the server calls `http://wordpress.store.svc.cluster.local`. But `store.localtest.me` resolves to 127.0.0.1 inside a pod (the pod itself), so it cannot be used. The server therefore sends the header **`Host: store.localtest.me:8080`** (WordPress expects its public hostname) and **`X-Forwarded-Proto: https`** (WooCommerce only accepts key/secret auth when it thinks the request is HTTPS).
- It is built with Node, `express`, the official `@modelcontextprotocol/sdk` and `zod` (describes each tool's inputs).
- **Five tools:** `list_products`, `create_product`, `list_orders` (has an `after` date filter so "today's orders" works), `get_order`, `update_order_status`.
- **Streamable HTTP** at `POST /mcp`, **stateless** mode: a fresh server and transport per request, no sessions kept in memory. `GET` and `DELETE` on `/mcp` return "Method not allowed" on purpose (a browser GET shows that message, which is normal). `GET /healthz` is for probes.
- A **10-second timeout** on calls to WordPress, and errors come back as tool errors (`isError`) with clear text instead of crashing.
- Dockerfile: `node:20-alpine`, `npm ci --omit=dev`, runs as the non-root `node` user.

### How I tested

First locally with a `kubectl port-forward` and MCP Inspector (list tools, run all five). Then inside the cluster with a temporary `curlimages/curl` pod calling `tools/list` and `tools/call list_orders`.

### How it is kept private

- Its Service is **ClusterIP** and it has **no Ingress**.
- A **NetworkPolicy** allows ingress only from pods labelled `app: gateway`. I proved it: a random curl pod got no answer after 5 seconds, and the gateway could connect.
- Lives in namespace `mcp`, with its own copy of the `woo-api-keys` Secret.
- k3d cannot see images on my laptop, so after `docker build` I run `k3d image import`. On a VPS I would push to a registry instead.

---

## 7. Part C: the two extra MCP servers (`apps/mcp-extra`)

The brief needs at least three upstreams. I wrote one small codebase that runs as two servers, chosen by the environment variable `SERVER_KIND`:

- **notes:** tools `search`, `add_note`, `list_notes` (in-memory notes, reset on restart).
- **utils:** tools `search` (a tiny e-commerce glossary), `current_time`, `calculate`.

**Both have a tool named `search` on purpose**, to prove my collision scheme. Each runs as its own Deployment and Service with probes, limits and the same NetworkPolicy idea (only the gateway may connect).

---

## 8. Part D: the gateway (`apps/gateway`), the core of the project

### The database (SQLite file, on a PVC in Kubernetes)

- `users` (email, role `admin` or `member`, password hash)
- `api_keys` (user, key prefix, **key hash**, created, revoked_at)
- `servers` (slug, name, url, optional auth header, **encrypted credential**, enabled)
- `audit_log` (time, user, source `chat` or `mcp-client`, server, tool, duration, outcome, error)
- `sessions` (dashboard login tokens, stored hashed, with expiry)

### How secrets and keys are stored

- **Dashboard passwords:** scrypt with a random salt (slow on purpose, because passwords are short and guessable).
- **Gateway API keys (`gw_...`):** I store only the **SHA-256 hash**. The raw key is shown **once**. SHA-256 is fine here because keys are long random strings.
- **Dashboard session tokens (`ses_...`):** hashed, expire after 8 hours. Separate from API keys so a leaked browser session can't be used as a long-lived key, and a key can be revoked on its own.
- **Upstream credentials:** encrypted with **AES-256-GCM** (it also detects tampering) using `CREDENTIAL_KEY`, which comes from a Kubernetes Secret. The API never returns a credential, only `has_credential: true/false`. If the key changes, saved credentials can't be decrypted, so I never change it.

### How it acts as an MCP client (`upstream.js`)

For each call it opens a short connection to an upstream with the SDK client, attaches that server's credential header, runs `tools/list` or `tools/call`, and closes. Connect, list and call all have a timeout (`UPSTREAM_TIMEOUT_MS`).

### How it aggregates and routes (`aggregator.js`)

1. Read the **enabled** servers from the database.
2. Refresh each server's tool list **in parallel** with `Promise.allSettled`, caching for 10 seconds. One dead server never breaks the others, and a failed server is marked `unreachable` with the error text.
3. Expose every tool as **`<slug>__<tool>`**, for example `woo__list_orders`, `notes__search`, `utils__search`. Slugs only allow lowercase letters, digits and hyphens (no underscores), so splitting on the first `__` is unambiguous.
4. On `tools/call`: split the name, find the enabled server, call it with its decrypted credential, and write an audit row either way.

**Why I always prefix** instead of prefixing only on collision: names would change when a new server is added and break saved prompts. Always-prefix is deterministic.

### How it acts as an MCP server (`index.js`)

`POST /mcp` with `Authorization: Bearer gw_...`. It hashes the key, looks it up (must not be revoked), and then builds a new MCP server object bound to that user for that request (stateless). Invalid or revoked key gives HTTP 401 `Invalid or revoked API key`.

### How a tool call travels (very likely interview question)

Client (Inspector or Claude Code) → Ingress (Traefik) → nginx in the dashboard pod → gateway Service → gateway pod (checks key hash, finds user) → splits `woo__list_orders` → MCP client connection to `mcp-woo.mcp.svc.cluster.local:3000` (only the gateway is allowed by the NetworkPolicy) → mcp-woo calls WordPress REST API with the consumer key → WooCommerce → MariaDB → result goes back the same way → the gateway writes the audit row (user, server, tool, ms, outcome).

### The admin API (`api.js`)

Login (returns `ses_` token), logout, `/me`, list tools, **servers** (list with live status and tools, add, edit, enable/disable, remove, admin only), **users** (list, add, remove, admin only), **keys** (create, list, revoke), **audit** (admins see all, members see only their own), and **chat**. Adding a server validates the slug and that the URL starts with http or https. **There is no SSRF protection** (an admin could point at an internal address). That is a known gap.

### Problems I hit and what they taught me

- **`better-sqlite3` would not install:** it is a native module that needs a compiler, and Ubuntu had no `make`. Fix: `sudo apt install build-essential python3`. Later, switching to Node 22 gave `NODE_MODULE_VERSION` errors until I ran `npm rebuild better-sqlite3`. In Docker I compile in a build stage.
- **A call timed out at 8 seconds once** (audit log showed 8483 ms, `error`). When I measured directly, mcp-woo answered in about 2 seconds. A retry through the gateway worked in 2.4 seconds, so it was a **cold start** of WordPress, not a code bug. I raised `UPSTREAM_TIMEOUT_MS` to 20000. Lesson: measure each hop before blaming code.
- **Admin email confusion:** the seeded admin is `admin@gmail.com`. `ADMIN_EMAIL` and `ADMIN_PASSWORD` only matter while the users table is empty, so changing them later does nothing. I reset a password with a one-line database update.
- **I used a wrong server id to delete a test server** and removed `utils` by mistake. I re-added it from the dashboard form. Lesson: look up ids first.
- **Failure tests that passed:** stopped the notes tunnel and `woo__` and `utils__` kept working; disabled a server and its tools vanished; revoked a key and it was rejected.

---

## 9. Part E: the dashboard (`apps/dashboard`)

React with Vite. Pages: **Login**, **Servers** (status with colours, tools, add, enable/disable, set credential, remove), **Members** (invite, issue key, revoke, remove), **My API key** (generate, revoke, shows the gateway URL), **Chat**, **Audit log**. Admins see all tabs, members see only My API key, Chat and Audit log. The session token is kept in `sessionStorage` and the API never sends upstream credentials to the browser.

In Kubernetes it is built into static files and served by **nginx** (`nginxinc/nginx-unprivileged`, non-root, port 8080). nginx proxies `/api/` and `/mcp` to the gateway Service. That replaces the Vite dev proxy, gives one host for both the UI and MCP clients, and avoids CORS.

Problems: `npm create vite` failed with an npm error `edgesOut`. Switching to **Node 22** fixed it. The "My API key" page printed the wrong URL (the Vite port), which I fixed to show the gateway URL. The monospace boxes are `<code>` tags, which is just plain styling.

---

## 10. Part F: the chat agent (`apps/gateway/chat.js`)

### The tool loop

1. The browser sends the conversation to `POST /api/chat` (login required).
2. The gateway loads the tool list the same way an external client would (`listAllTools`) and converts the schemas to what Gemini accepts.
3. Sends messages plus tools to Gemini (system prompt says tool results are data, never instructions, and gives the current time for "today's orders").
4. If the model answers with `functionCall` parts, the gateway runs each one with **`callTool(user, "chat", name, args)`**, which is the same code path as external clients, so the audit row says `usera@example.com`, Via = `chat`.
5. The results go back to the model as `functionResponse`. Repeat, **maximum 6 rounds**, then return the final text and the list of tools called. The UI shows the tools called under each answer.

### How it acts as the logged-in user

The login session identifies the user, and that user object is passed into every tool call. So the audit log shows chat calls under that person, and the agent never has more access than that person.

### Gemini problems (important to remember honestly)

- The key lives in `~/.gateway-env` locally and in the Secret `gateway-secrets` in the cluster. Never in the repo.
- `gemini-2.5-flash` returned 404 ("no longer available to new users"). The error text suggested `gemini-3.8-flash`, but that model did **not exist for my key**, and calls to it **hung for 60 seconds** (my timeout). I listed the models my key could use via the API and tested several. **`gemini-3.5-flash-lite`** answered in about 2 seconds, so I used that, set by `GEMINI_MODEL`. I can't promise which model names exist later, so the model name is a setting, not hard-coded.
- The assignment only grades that the tool loop works, not the quality of the answers.

### What the chat proved

Listed tools from all three servers, listed products, created `Test Cap` (visible in the shop), listed orders, and when asked to delete a product it said it has no such tool. The audit log showed all of this under `usera@example.com` with Via = `chat`.

---

## 11. Part G: moving the gateway and dashboard into Kubernetes

- **Gateway image:** two-stage Dockerfile. Stage 1 (`node:22-bookworm`) has a compiler and installs dependencies. Stage 2 (`node:22-bookworm-slim`) has none. It runs as the non-root `node` user, and the database path is `/data/gateway.db` (a PVC).
- **Secret `gateway-secrets`:** `credential-key` and `gemini-api-key`.
- **Gateway Deployment:** strategy Recreate (SQLite is a single file, one writer), `fsGroup: 1000`, probes on `/healthz`, requests 100m/128Mi, limits 500m/384Mi, PVC `gateway-data` 1Gi.
- **Copying my local database into the PVC** took retries. The new pod had created its own empty database first, so my first copy was ignored. The fix: scale the gateway to 0, start a temporary `busybox` pod mounting the PVC, remove the pod's files (`gateway.db`, `-wal`, `-shm`), `kubectl cp` my database in, `chown 1000:1000`, delete the helper pod, scale back to 1. Then I updated the three server URLs from `localhost` to `http://mcp-woo.mcp.svc.cluster.local:3000/mcp` and similar.
- **Dashboard:** Deployment, Service and an **Ingress for `mcp.localtest.me`**. I first forgot to apply it and got a Traefik "404 page not found". Lesson: a plain 404 with no styling means the cluster has no route for that host.
- After this, no tunnels were needed. An external client called `http://mcp.localtest.me:8080/mcp` with only a key and got all 11 tools.
- One more cold start: the first chat call after a restart timed out, then worked on retry.

---

## 12. Part H: Helm for everything

Five charts, each with `values.yaml` (defaults), `values-local.yaml` and `values-prod.yaml`:

| Chart | Namespace | Notes |
|---|---|---|
| `store` | store | MariaDB, WordPress, Ingress |
| `mcp-woo` | mcp | Deployment, Service, NetworkPolicy |
| `mcp-extra` | mcp | One template loops over a `servers` list to create notes and utils |
| `gateway` | mcp | PVC has annotation `helm.sh/resource-policy: keep` so `helm uninstall` won't delete my database |
| `dashboard` | mcp | Includes the Ingress, and an optional TLS block |

**Adoption:** my objects already existed (created by `kubectl apply`). To have Helm take them over without restarting or deleting anything, I added the label `app.kubernetes.io/managed-by=Helm` and the annotations `meta.helm.sh/release-name` and `meta.helm.sh/release-namespace`, then ran `helm install`. For `mcp-woo` the install said "cannot re-use a name" because it was already installed. `helm list -A` shows all five `deployed` (plus `traefik` and `traefik-crd`, which are k3s's own).

**Secrets are not in the charts.** Charts only reference Secrets by name, so secret values never reach Git. I created them with `kubectl` by hand. I ran `git grep` for key patterns and it printed nothing.

**What changes between local and production (values only):**
- hostnames (`*.localtest.me:8080` to real domains), `scheme` `http` to `https`, and the port
- image repository and `pullPolicy` (a registry and `Always` instead of `k3d image import`)
- ingress class and annotations, optional TLS via cert-manager
- storage class and sizes, resource sizes, timeouts

**Honest note:** `values-prod.yaml` files contain **placeholder domains and registry names** and were only checked with `helm lint`. I did **not** deploy to a VPS. The store chart's Ingress template has no TLS block yet.

**Upgrade and rollback (I did this on the store):**
```
helm upgrade store charts/store -n store -f charts/store/values-local.yaml --set resources.wordpress.limits.memory=1500Mi
helm history store -n store
helm rollback store 1 -n store
```
`store` is at revision 3 (install, upgrade, rollback). Helm keeps every revision, so a rollback just re-applies an older one.

I deleted the old `raw/` YAML folders once all releases were deployed.

---

## 13. The two-user rehearsal and the MCP Inspector saga

Everything passed: chat as user A (create product, order it, ask about orders), external client as user B (list tools, run `woo__list_orders`), revoke B's key (rejected), disable a server (tools gone), delete the utils pod (the others kept working, the dashboard showed it unreachable then recovered), and the audit log listed everything under the right users.

**Inspector problems (so I don't panic during the video):**
- The newest Inspector web UI opened its built-in example server (an `example-server.modelcontextprotocol.io` login page). I did **not** click through that.
- Its "Add server" form had **no header field**, so the gateway returned 401 (correct). It also tried OAuth discovery, and nginx answered those `/.well-known/` paths with the dashboard's `index.html` (harmless).
- The **command line** worked: `npx @modelcontextprotocol/inspector --cli http://mcp.localtest.me:8080/mcp --transport http --header "Authorization: Bearer $KEY" --method tools/list` printed all 11 tools.
- **Inspector 0.16.0** (`npx @modelcontextprotocol/inspector@0.16.0`) has an Authentication section with a bearer token field. It needed the proxy session token (use the full link the terminal prints), and the key typed **without** the word `Bearer`. After that, it listed all 11 tools. Only one Inspector can run at a time (port 6274).
- Claude Code and Cursor are optional. The brief says "Claude Code, Cursor or MCP Inspector", and one is enough.

---

## 14. Security: what I must be able to explain

- **API keys:** hashed (SHA-256), shown once, revocable. Revoking takes effect on the next call.
- **Passwords:** scrypt with per-user salt.
- **Upstream credentials:** encrypted at rest (AES-256-GCM), key from a Secret, never returned by the API, sent only to their own server.
- **Why client tokens are not passed to upstreams:** (1) *confused deputy*: upstreams would have to trust tokens they never issued, (2) a leaked or logged key at an upstream would compromise the gateway account, (3) I can revoke a user instantly without touching upstream credentials, and rotate upstream credentials without touching users. The gateway uses each server's own static credential.
- **Shared credential:** a member never sees it but can use it indirectly through tools, so a member can do whatever the exposed tools allow. Attribution comes from the **audit log**, since the upstream sees only the shared credential. Per-role tool permissions would fix this and I did **not** build them.
- **What a member can do:** use all enabled tools, manage only their own keys, see only their own audit entries, chat as themselves. **Cannot:** see servers or credentials, add or remove servers or users, see other people's keys or audit rows. **Admin:** manages servers, members, keys, sees everything.
- **Untrusted or malicious upstream:** it controls its tool names, descriptions and results, which can contain prompt injection aimed at the model. Mitigations I have: system prompt says results are data, tools are namespaced so one server can't replace another's tool, only admins can add servers, the chat loop is capped at 6 steps, and everything is audited. **Missing:** no URL allow-list or SSRF protection, no description scanning, no human confirmation before write tools. So a malicious server could still trick the model into a write tool such as `woo__create_product` within the member's access.
- **Network:** MCP servers are ClusterIP with a NetworkPolicy allowing only the gateway. Only the storefront and the dashboard have Ingress. Containers run as non-root where I built the images.
- **What one member can do to another:** nothing with keys or the audit log, but they share the same upstream data (a product or order change affects everyone), and the notes server's list is shared.

---

## 15. What I did NOT do (say this honestly)

- Multi-store provisioning bonus (answered **No** on the form).
- Real VPS deployment (prod values are placeholders, only linted).
- Tool permissions, OAuth, SSRF protection, rate limits, scaling beyond one gateway replica, observability and metrics.
- Default-deny NetworkPolicies everywhere (I only restrict the MCP servers).
- TLS for the storefront Ingress.
- One gateway replica, because SQLite is single-writer. Scaling out means moving to Postgres.

---

## 16. Likely interview questions, with my short answers

1. **Walk me through a tool call.** See section 8, "How a tool call travels".
2. **How do you handle two servers with the same tool name?** Always prefix with `<slug>__`. Slugs can't contain underscores, so splitting is unambiguous. Always-prefix keeps names stable when servers are added.
3. **What if an upstream is slow or dead?** Timeouts on connect, list and call, `Promise.allSettled` so the others continue, `unreachable` status with the reason, and an audit row with the error.
4. **Where is each credential stored and who can read it?** User keys: hashed in SQLite. Upstream credentials: AES-GCM encrypted in SQLite, key in a Kubernetes Secret, decrypted only in gateway memory. LLM key and consumer key: Kubernetes Secrets. Admin users with cluster access could read Secrets, which is a limit of Kubernetes Secrets.
5. **Why is the MCP server private and how is it enforced?** ClusterIP only, no Ingress, plus a NetworkPolicy allowing only `app: gateway` pods.
6. **Why a StatefulSet for MariaDB but a Deployment for WordPress?** The database needs stable identity and its own disk. WordPress is stateless apart from its files (on a PVC), and uses Recreate because of the ReadWriteOnce disk.
7. **Why REST and not WP-CLI?** Official, authenticated, no shell access to the pod needed.
8. **How does the chat agent act as the user?** The session identifies the user and the same `callTool` function is used, so audit rows carry that user.
9. **What does `helm upgrade` / `rollback` do?** Upgrade applies new values and keeps a revision. Rollback re-applies an older revision.
10. **What changes for production?** Only values: domain, scheme, ingress class and TLS, storage class, image registry and pull policy, resource sizes, and secrets created in the target cluster.
11. **What happens if an admin adds a malicious server?** It can feed manipulative descriptions and results to the model, and could receive its own credential only. It cannot read other servers' credentials. Gaps: no SSRF protection and no write confirmation (section 14).
12. **Why SQLite and one replica?** Simple and enough for a team. Single writer, so one replica. Postgres would be needed to scale.
13. **What went wrong and how did you debug it?** The readiness probe timeout (read Events, not guess), the cold start (measured each hop), the Gemini model name (listed what the key can use), the database copy (the pod had already created its own file).

---

## 17. Useful commands (cheat sheet)

```
# status
kubectl get nodes
kubectl -n store get pods
kubectl -n mcp get pods,svc,ingress,pvc,secret
kubectl get ns
helm list -A
helm history store -n store

# debugging
kubectl -n mcp logs deploy/gateway
kubectl -n mcp describe pod -l app=gateway     # read the Events at the bottom
kubectl top pod -n store

# demo: kill an upstream pod
kubectl -n mcp delete pod -l app=mcp-utils

# NetworkPolicy proof (should hang and print nothing)
kubectl -n mcp run curltest --rm -it --image=curlimages/curl --restart=Never -- curl -s -m 5 http://mcp-woo.mcp.svc.cluster.local:3000/healthz

# external client (CLI)
KEY=gw_...
npx @modelcontextprotocol/inspector --cli http://mcp.localtest.me:8080/mcp --transport http --header "Authorization: Bearer $KEY" --method tools/list
```

URLs: storefront `http://store.localtest.me:8080`, dashboard and MCP `http://mcp.localtest.me:8080` (MCP endpoint at `/mcp`).

---

## 18. Submission checklist

- [ ] Warm up WordPress (open the store, click around) before recording.
- [ ] Record the video: design, Kubernetes (namespaces, Secrets, volumes, Ingress, probes and limits, public vs internal), the two-user flow, the control tests, MCP internals, security and honest gaps, local-to-VPS story with upgrade and rollback.
- [ ] Upload the video (YouTube unlisted or Drive "anyone with the link"), test it in an incognito window.
- [ ] Make the GitHub repo **public**, test it logged out.
- [ ] Form: repo URL, video URL, live deployment URL **empty**, multi-store bonus **No**, stand-out items: only "Upgrades and rollback", LLM: Gemini (gemini-3.5-flash-lite) via Google AI Studio free tier, "anything else": known issues and where to find things.
- [ ] Submit well before the evening of 26 Oct.

---

## 19. Mistakes I made and lessons (good to mention honestly)

- Guessed causes (OOM, CPU) before reading Events. Always read the evidence first.
- Ran commands from the wrong folder several times. Check the prompt shows the right folder.
- Lost a GitHub token because it is shown only once. Save secrets in a private place.
- Forgot that environment variables disappear in a new terminal window.
- Pasting only part of a multi-step guide skipped files (for example, the API router wasn't plugged in). Check with `grep`.

---

## 20. UI polish and the dashboard upgrade (added last)

- I replaced the plain styling with one stylesheet (`src/index.css`): slate neutrals, one blue accent, 1px borders, status pills for connected/unreachable/disabled and success/error, and chat bubbles with tool-call chips. No logic changed, only classes and CSS.
- The "My API key" page now has a "Connect an MCP client" panel with Copy buttons for the URL and header, and the Claude Code example in a collapsed section. The full key is still shown once.
- Deploy: built `mcp-dashboard:0.1.1`, imported it into k3d, bumped `tag` in the dashboard chart values, ran `helm upgrade`. The `dashboard` release is now at revision 2, so `helm rollback dashboard 1 -n mcp` would bring back the old UI. The README build line was updated to 0.1.1 too.
- Domain: I kept `localtest.me` on purpose. A real domain needs a real server and DNS. In production only the `host` values change.
