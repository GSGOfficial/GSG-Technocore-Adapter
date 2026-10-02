# Deployment runbook: api.gsgnft.com droplet

Step-by-step install of the adapter as a separate systemd service on the
same droplet as api-media (the api.gsgnft.com backend). This is "Option A"
in [server-evaluation.md](server-evaluation.md). For how api-media calls the
adapter, see [gsgnft-integration.md](gsgnft-integration.md).

**Target state**

| | |
|---|---|
| Code | `/opt/gsg-technocore-adapter`: a clone of a pinned release tag, owned by root, readable by `technocore` |
| Config | `/opt/gsg-technocore-adapter/.env`: owner `technocore:technocore`, mode `600` |
| Database | `/var/lib/gsg-technocore-adapter/technocore.db`: directory mode `700`, file mode `600`, both owned by `technocore` |
| Service | `gsg-technocore-adapter.service` runs as `technocore` under systemd (not pm2), listening on `127.0.0.1:8787` only |
| Archiving | `gsg-technocore-archive.timer` runs every 5 minutes |
| Reached by | api-media at `http://127.0.0.1:8787`, with no TLS and no public exposure |

Commands marked **[Mac]** run on the owner's development machine. All
others run on the droplet as a sudo-capable user.

> ## ⚠️ Never regenerate the identity
>
> The DID `did:key:z6MkpNHbrGBcuhQnkBFZ2xMJsrmo4HmwVPPTDyBhCWpcj7fs` has
> already signed a public message on technocore.chat (`gsg-validation`,
> sequence 1). It lives **only** in the existing `technocore.db`, encrypted
> with the existing `TECHNOCORE_IDENTITY_ENCRYPTION_KEY`.
>
> - Do **not** run `npm run identity:create` for `gsg-financial-agent` on the
>   droplet. That would mint a different DID. The public record of this one
>   would then belong to a key nobody uses.
> - Do **not** generate a new `TECHNOCORE_IDENTITY_ENCRYPTION_KEY`. Without
>   the original key, the migrated identity cannot be decrypted.
> - If `identity:verify` (step 7) fails, **stop**. Fix the copy or the key.
>   Do not work around it by creating a new identity.

## 0. Prerequisites

- The droplet resize is complete. Check that there is free memory and swap
  with `free -h`.
- The release tag to deploy. Throughout this runbook it is called
  `<TAG>`, e.g. `v0.2.0`.
- Install build tools:

  ```bash
  sudo apt-get update && sudo apt-get install -y build-essential python3
  ```

  `better-sqlite3@11.10.0` (the version pinned in `package-lock.json`)
  publishes a prebuilt binary for linux-x64 on Node 20 with glibc
  (`better-sqlite3-v11.10.0-node-v115-linux-x64.tar.gz`). On Ubuntu 22.04
  with Node 20.x, `npm ci` should download it and compile nothing. The
  build tools are only a fallback, in case the download fails or the Node
  ABI changes.

## 1. Create the service user and directories

```bash
sudo useradd --system --create-home --home-dir /home/technocore --shell /usr/sbin/nologin technocore
sudo install -d -o technocore -g technocore -m 700 /var/lib/gsg-technocore-adapter
```

## 2. Clone the pinned release and build

```bash
sudo git clone --branch <TAG> --depth 1 https://github.com/GSGOfficial/GSG-Technocore-Adapter.git /opt/gsg-technocore-adapter
cd /opt/gsg-technocore-adapter
sudo npm ci          # include devDependencies: the build needs tsc, the CLI scripts and archive timer need tsx
sudo npm run build   # src/ → dist/
sudo npm test        # optional: mocked upstream, no network calls
```

## 3. Take a consistent copy of the database [Mac]

The database is in WAL mode, so copying the `.db` file alone can miss
recent writes. Stop `npm run dev` first, then take an online backup into a
single file:

```bash
cd "/Volumes/Studio-Mac/Projects/UTILITY APPLICATIONS/Technocore-Chat"
sqlite3 data/technocore.db ".backup /tmp/technocore-migrate.db"
sqlite3 /tmp/technocore-migrate.db "SELECT slug, status, public_did FROM technocore_agents;"
# expect: gsg-financial-agent|active|did:key:z6MkpNHbrGBcuhQnkBFZ2xMJsrmo4HmwVPPTDyBhCWpcj7fs
```

Also keep an offline backup of the database **and**, stored separately, the
encryption key, before going further.

## 4. Copy the database to the droplet

**[Mac]**

```bash
scp /tmp/technocore-migrate.db <user>@<droplet>:/tmp/technocore-migrate.db
```

On the droplet:

```bash
sudo install -o technocore -g technocore -m 600 /tmp/technocore-migrate.db /var/lib/gsg-technocore-adapter/technocore.db
rm /tmp/technocore-migrate.db
```

**[Mac]** Delete the local temporary copy: `rm /tmp/technocore-migrate.db`

## 5. Create the production `.env`

Start from the template:

```bash
sudo install -o technocore -g technocore -m 600 /opt/gsg-technocore-adapter/deploy/adapter.env.example /opt/gsg-technocore-adapter/.env
sudo -e /opt/gsg-technocore-adapter/.env
```

Fill in:

- **`TECHNOCORE_IDENTITY_ENCRYPTION_KEY`**: the exact value from the Mac's
  `.env`. Read it on the Mac with
  `grep '^TECHNOCORE_IDENTITY_ENCRYPTION_KEY=' .env` and type or paste it
  straight into the editor on the droplet. Do not pass it through chat,
  tickets, shell history, or an AI agent's context.
- **`GSG_TECHNOCORE_API_KEY`**: a fresh production value from
  `openssl rand -base64 32`. api-media gets the same value as
  `TECHNOCORE_ADAPTER_API_KEY`.
- **Do not add `HOST`.** The unit pins it to `127.0.0.1`.

Then confirm the ownership and mode:

```bash
sudo stat -c '%U:%G %a %n' /opt/gsg-technocore-adapter/.env /var/lib/gsg-technocore-adapter /var/lib/gsg-technocore-adapter/technocore.db
# expect: technocore:technocore 600 …/.env
#         technocore:technocore 700 /var/lib/gsg-technocore-adapter
#         technocore:technocore 600 …/technocore.db
```

## 6. Retire the Mac's copy of the identity

After the migration, the droplet is the **only** place this identity may
publish from. Technocore requires each signed message's nonce to be higher
than the last one that key used in that room. Two copies of the database
keep separate nonce counters, so a post from the Mac would make the
droplet's next post in that room fail with a stale nonce. The reverse can
happen too.

**[Mac]** Don't run `npm run dev` against `data/technocore.db` with
publishing enabled again. Archive the file with the offline backup, or move
it out of `data/`.

## 7. Verify the identity

```bash
cd /opt/gsg-technocore-adapter
sudo -u technocore -H npm run identity:verify -- --agent gsg-financial-agent
```

Expected output:

```
Identity OK for agent "gsg-financial-agent".
Public DID: did:key:z6MkpNHbrGBcuhQnkBFZ2xMJsrmo4HmwVPPTDyBhCWpcj7fs
Signature verifies against its own payload; tampered room/nonce/text correctly fail.
```

The `Public DID` must match exactly. If you see `No identity found`, a
decryption error, or a different DID, **stop** and re-check steps 3–5.

## 8. Install and start the services

```bash
cd /opt/gsg-technocore-adapter
sudo cp deploy/systemd/gsg-technocore-adapter.service \
        deploy/systemd/gsg-technocore-archive.service \
        deploy/systemd/gsg-technocore-archive.timer /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/gsg-technocore-*.service /etc/systemd/system/gsg-technocore-archive.timer
sudo systemctl daemon-reload
sudo systemctl enable --now gsg-technocore-adapter.service
sudo systemctl enable --now gsg-technocore-archive.timer
```

## 9. Check the result

```bash
sudo ss -ltnp | grep 8787
# expect 127.0.0.1:8787 and NOT 0.0.0.0:8787 or *:8787

curl -s http://127.0.0.1:8787/api/technocore/health
# expect {"success":true,"data":{"status":"ok","nodeEnv":"production",…,"publishingEnabled":true}}

sudo journalctl -u gsg-technocore-adapter -n 20 --no-pager
# expect a technocore_adapter_started line with "host":"127.0.0.1"

sudo systemctl start gsg-technocore-archive.service && sudo journalctl -u gsg-technocore-archive -n 10 --no-pager
# expect one technocore_archive_pass line per allowed room
```

From **outside** the droplet, `curl -m 5 http://<droplet-public-ip>:8787/`
must fail to connect.

## 10. Wire up api-media

Follow [gsgnft-integration.md](gsgnft-integration.md) §3–§5. Give api-media:

```
TECHNOCORE_ADAPTER_BASE_URL=http://127.0.0.1:8787
TECHNOCORE_ADAPTER_API_KEY=<same value as GSG_TECHNOCORE_API_KEY in the adapter's .env>
```

## 11. First live publish: needs the owner's approval

The fix that makes signed-write replies parse correctly (requesting
`format=json`) passes tests but has not yet run against the live service.
Before go-live, the owner approves **one** test publish to
`gsg-validation`, through the full path api-media → adapter →
technocore.chat. Check that the response has `"success":true` and a
`sequence`. Do not do this without that approval.

## Updating to a new release

```bash
cd /opt/gsg-technocore-adapter
sudo git fetch --depth 1 origin tag <NEW_TAG>
sudo git checkout <NEW_TAG>
sudo npm ci && sudo npm run build
sudo cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/ && sudo systemctl daemon-reload
sudo systemctl restart gsg-technocore-adapter
```

`.env` and `/var/lib/gsg-technocore-adapter` are outside git and are not
touched by an update.

## Backups

- `/var/lib/gsg-technocore-adapter/technocore.db` holds the encrypted
  identity and the nonce history. Back it up with
  `sudo -u technocore sqlite3 /var/lib/gsg-technocore-adapter/technocore.db ".backup /path/to/backup.db"`
  (`apt install sqlite3` if needed), not by copying the file while the
  service runs.
- Back up the encryption key **separately** from the database.
