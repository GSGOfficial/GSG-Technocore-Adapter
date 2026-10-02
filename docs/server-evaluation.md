# Evaluation brief: hosting the GSG Technocore Adapter on the api.gsgnft.com server

**Audience:** the agent operating the api.gsgnft.com DigitalOcean server.
**Your task:** decide whether this adapter can safely be built and run on
your server alongside api.gsgnft.com. Report a go / no-go recommendation
with the findings from §6. **Do not deploy anything, change your server
configuration, or contact technocore.chat while evaluating.** The owner will
approve deployment separately.

> **Outcome (2026-10-02).** The evaluation is done. Decision: **Option A**,
> a separate systemd service on the api.gsgnft.com droplet. Option B is
> ruled out because api-media runs Express 5 and zod 4. Every blocker the
> evaluation raised is resolved in release `v0.2.0`:
>
> - The adapter binds `127.0.0.1` by default.
> - The docs are rewritten for the same-host path.
> - There is an identity-migration runbook.
> - The systemd units and the archive timer now ship in the repo.
>
> To deploy, follow [deployment-runbook.md](deployment-runbook.md). The
> sections below are kept as the evaluation record.

## 1. Where the code is

| | |
|---|---|
| Repository | https://github.com/GSGOfficial/GSG-Technocore-Adapter (public, Apache-2.0) |
| Branch | `Main`. The capital M matters: there is no `main` branch |
| Clone | `git clone --branch Main https://github.com/GSGOfficial/GSG-Technocore-Adapter.git` |
| This document | `docs/server-evaluation.md` in that repo |

The code stays in this repository. It is not copied into the api.gsgnft.com
codebase. The server **pulls** the repo and **compiles** it locally. See §4.

Read these files, in this order:

1. `README.md`: purpose, features, CLI commands.
2. `docs/gsgnft-integration.md`: the intended topology, the proxy code for
   api.gsgnft.com, a systemd unit, and the rollout checklist.
3. `docs/architecture.md`: components, nonce atomicity, the publish flow.
4. `docs/security.md`: threat model.
5. `docs/api.md`: routes and error codes.
6. `src/index.ts`: entry point. It is both a standalone server and an
   importable Express router (see §3, option B).
7. `src/config/env.ts`: every environment variable and the production
   startup checks.
8. `package.json`: scripts and dependencies.
9. `docs/deployment-runbook.md` and `deploy/`: the install procedure,
   systemd units and production env template.

## 2. What the adapter is

A Node/TypeScript Express service. It lets GSG AI agents read from and post
**signed** (Ed25519 `did:key`) messages to the public chat service at
https://technocore.chat. It holds the agents' encrypted private keys,
allocates nonces, signs messages, and archives room traffic. api.gsgnft.com
is meant to call it server-to-server. Agents never call it directly.

Current state: built and tested (82 tests pass as of `v0.2.0`). One signed message has been
published live from a development machine, to room `gsg-validation` at
sequence 1, under DID
`did:key:z6MkpNHbrGBcuhQnkBFZ2xMJsrmo4HmwVPPTDyBhCWpcj7fs`.

## 3. Hosting options to evaluate

### Option A (recommended): a separate service on the same droplet

The adapter runs as its own systemd service, under its own Linux user, in
its own directory (e.g. `/opt/gsg-technocore-adapter`), on `127.0.0.1:8787`.
api.gsgnft.com calls `http://127.0.0.1:8787/api/technocore/...` with a
bearer key. This keeps the two apps isolated: separate processes, separate
dependencies, separate restarts. It needs no TLS and no public exposure.

### Option B: mount it inside the api.gsgnft.com process (ruled out for api.gsgnft.com)

> Ruled out on 2026-10-02. api-media uses `express` ^5 and `zod` ^4, which
> fails the dependency check below. The text is kept for reference only.

`src/index.ts` exports `createTechnocoreRouter(ctx)` and
`buildAdapterContext(config)`. An **Express** host can therefore mount it
with `app.use("/api/technocore", router)`. Consider this only if all of the
following hold:

- api.gsgnft.com is Express, or something that can mount an Express router.
- It runs as **exactly one** Node process. Not PM2 cluster mode, not
  multiple replicas: SQLite assumes a single writer.
- It runs Node 20.6 or later.
- Its dependency versions don't conflict with this repo's (`express` ^4,
  `zod` ^3, `better-sqlite3` ^11).

Option B couples the release cycles of both apps and shares a failure
domain. Prefer A unless there is a concrete reason not to.

## 4. How "pull and compile" works (option A)

```bash
# first install
sudo useradd --system --create-home --shell /usr/sbin/nologin technocore
sudo git clone --branch Main https://github.com/GSGOfficial/GSG-Technocore-Adapter.git /opt/gsg-technocore-adapter
cd /opt/gsg-technocore-adapter
npm ci            # must include devDependencies: the build needs tsc, the CLI scripts need tsx
npm run build     # compiles src/ to dist/
npm test          # optional; all tests use a mocked upstream and make no network calls

# update
git pull --ff-only && npm ci && npm run build && sudo systemctl restart gsg-technocore-adapter
```

- `npm start` runs `node dist/index.js`. It does **not** read `.env`. Under
  systemd, the `EnvironmentFile=` line supplies the environment (see the
  unit in `docs/gsgnft-integration.md` §1).
- The CLI scripts (`npm run identity:verify`, `archive:room`, `smoke-test`)
  read `.env` from the working directory via `tsx --env-file=.env`. Run them
  from the repo root.
- Consider pinning deploys to a specific commit or tag rather than tracking
  `Main` blindly.

## 5. Things that are NOT in git

`.env`, `data/` and `*.db` are gitignored. They come from the owner's
machine, not from the repo:

- **`data/technocore.db`**: the SQLite store. It holds the agent's
  encrypted private key and nonce history. The DID above already has a
  public message, so this database must be **migrated**, not regenerated.
  Creating a new identity would create a different public DID.
- **`TECHNOCORE_IDENTITY_ENCRYPTION_KEY`**: it must be the same key the
  database was encrypted with. Without it, the stored identity cannot be
  decrypted.
- Production `.env` must set:
  - `NODE_ENV=production`
  - `TECHNOCORE_BASE_URL=https://technocore.chat` (enforced in production)
  - `TECHNOCORE_DB_PATH`: an absolute path on persistent disk
  - `GSG_TECHNOCORE_API_KEY`
  - `GSG_ALLOWED_ROOMS`
  - `TECHNOCORE_ALLOW_UNSIGNED_DEV=false`

  The process refuses to start in production if any of these are missing
  or invalid.

## 6. What to check on your server

Report each item:

1. **Platform.** Is this a droplet (a VM with a persistent disk), or App
   Platform? App Platform has no persistent local disk, so this adapter
   cannot run there. That would mean no-go for co-location.
2. **Node.** The output of `node --version`. It must be 20.6 or later. If
   api.gsgnft.com needs a different Node version, can the adapter get its
   own Node (nvm, or a separate binary path in its systemd unit)?
3. **Native build.** `better-sqlite3` compiles a native addon if no
   prebuilt binary matches. Are `build-essential` (gcc, make) and
   `python3` available?
4. **How api.gsgnft.com runs.** systemd, PM2, or Docker? What framework?
   How many processes? If it runs in Docker, `127.0.0.1` inside the
   container does not reach a host service. Note what networking change
   would be needed: host networking, `host.docker.internal`, or a shared
   Docker network.
5. **Port 8787.** Is it free? Is it blocked from the internet? The adapter
   currently listens on **all interfaces** (`app.listen(port)` in
   `src/index.ts`) and has no `HOST` setting. The droplet firewall or the
   DigitalOcean Cloud Firewall must block inbound 8787. Otherwise unauthenticated
   read routes are publicly reachable: `/agents`, `/rooms`, `/contributions`
   and the message lists. A small code change to bind `127.0.0.1` is
   planned. State whether you consider it a prerequisite.
   **Resolved in v0.2.0:** `HOST` defaults to `127.0.0.1`, and the systemd
   unit pins it.
6. **Resources.** `node_modules` is about 124 MB and `dist/` is about
   400 KB. Expect tens of MB of RAM at idle. Is there disk and memory
   headroom?
7. **Backups.** Is the droplet backed up (DigitalOcean backups or
   snapshots)? Would a file at the chosen `TECHNOCORE_DB_PATH` be included?
   The encryption key must be backed up **separately** from the database.
8. **Outbound network.** Can the server reach `https://technocore.chat`
   (HTTPS, port 443)? Check with a read-only `curl -sI https://technocore.chat`.
9. **Secrets handling.** Where does api.gsgnft.com keep its secrets today?
   Can it hold `TECHNOCORE_ADAPTER_BASE_URL` and the shared bearer key the
   same way? Neither may ever reach a browser or an agent runtime.
10. **Proxy layer.** Can api.gsgnft.com's backend add the server-side proxy
    described in `docs/gsgnft-integration.md` §3–5? That covers idempotency
    keys derived from job IDs, and handling `TECHNOCORE_RATE_LIMITED` and
    `TECHNOCORE_UNKNOWN_PUBLISH_RESULT`.

## 7. Known limitations and open issues

- **Single writer.** Run one adapter process per database file. No
  horizontal scaling without swapping the store.
- ~~**Binds all interfaces.**~~ Resolved in v0.2.0: `HOST` defaults to
  `127.0.0.1`.
- **Shared bearer key.** Auth is one static key (`src/api/auth.ts`). This
  is a placeholder for api.gsgnft.com's own auth, and fine for the
  localhost-only option A.
- ~~**No built-in archive scheduler.**~~ Resolved in v0.2.0:
  `deploy/systemd/gsg-technocore-archive.timer` runs `scripts/archive-all.ts`
  every 5 minutes.
- **Signed-write reply parsing was fixed in the latest commit.** Writes now
  request `format=json`, and a test now asserts it. The fix has not yet been
  exercised by a live publish. The owner must approve one test publish to
  `gsg-validation` before go-live.
- ~~**Unclear validation errors.**~~ Resolved in v0.2.0: a malformed
  request body or query on any route now returns `400
  TECHNOCORE_INVALID_MESSAGE` and names the invalid fields.
- **No admin dashboard.** The API routes exist; there is no UI.

## 8. Go / no-go criteria

**Go (option A)** if all of these hold:

- The server is a droplet with persistent disk and backups.
- Node 20.6 or later is available to the adapter.
- `better-sqlite3` installs.
- Port 8787 is or will be firewalled from the internet.
- api.gsgnft.com can reach `127.0.0.1:8787`, or you can name the networking
  change that makes it reachable.

**No-go, recommend a separate small droplet** if the server is App Platform,
has no headroom, can't keep 8787 private, or co-locating would put
api.gsgnft.com's stability at risk.

Report the platform, how api.gsgnft.com runs, the answers to §6, your
recommended option (A, B or separate droplet), and any prerequisites you
would require before deployment.
