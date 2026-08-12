# LibreNMS POC deployment — rootless Podman quadlet set (branch 0.4c)

Target host: `10.121.77.206` (CentOS Stream 9, SELinux Enforcing, Podman 5.6.0, **no sudo**).
Deployed entirely under the deploying account's `$HOME` = `/opt/airlinq/aqaillm`, i.e. `~/nms`.

**This is a POC on a shared host.** The account co-tenants with a third party's Kafka/ZooKeeper
estate and with two of the account's own long-running services (`:8077`, `:5000`). Read the
co-tenancy rules below before touching anything.

## Pinned images

| Service | Image | Published? |
|---|---|---|
| `nms-db` | `docker.io/library/mariadb:11.4` | no |
| `nms-redis` | `docker.io/library/redis:7.4-alpine` | no |
| `nms-rrdcached` | `docker.io/crazymax/rrdcached:1.8.0` | no |
| `nms-influxdb` | `docker.io/library/influxdb:2.7.11` | no |
| `nms-librenms` | `docker.io/librenms/librenms:25.7.0` | no |
| `nms-dispatcher` | `docker.io/librenms/librenms:25.7.0` | no |
| `nms-snmptrapd` | `docker.io/librenms/librenms:25.7.0` | **1162/udp** |
| `nms-syslogng` | `docker.io/librenms/librenms:25.7.0` | **1514/udp** |
| `nms-proxy` | `docker.io/library/nginx:1.27-alpine` | **8080/tcp, 8443/tcp** |
| `nms-keycloak` | `quay.io/keycloak/keycloak:26.0` | no (via `/auth/`) |
| `nms-kcdb` | `docker.io/library/postgres:16-alpine` | no |

No `:latest` anywhere. Verify: `grep -rn "Image=.*:latest" .` → no output.

## Published ports — exactly four

| Host port | Container | Why not the standard port |
|---|---|---|
| `8443/tcp` | proxy 8443 | rootless cannot bind 443 |
| `8080/tcp` | proxy 8080 | rootless cannot bind 80 (so ACME HTTP-01 is impossible) |
| `1162/udp` | snmptrapd 162 | rootless cannot bind 162 — **FR-56a scoped exception** |
| `1514/udp` | syslog-ng 514 | rootless cannot bind 514 — **FR-56a scoped exception** |

Every datastore (MariaDB 3306, InfluxDB v2 8086, Redis 6379) and LibreNMS itself (8000) has
**no host-side listener at all**. On this branch that is the *only* boundary — no host
firewall is available without root — so it is negative-tested at Task 0.6 Step 9a.
There is **no 5432 listener** — TimescaleDB was dropped (ADR 0009); LibreNMS 25.7.0 has no
PostgreSQL/TimescaleDB datastore driver, so the metric store is InfluxDB v2 (native
`InfluxDBv2` datastore, no bridge component). LibreNMS writes over the line protocol; the
BFF reads via the InfluxDB v2 token — both server-side only (ADR 0002 / CON-6).

## SELinux labels per mount, with consumer counts

`:z` = shared label (multiple consumers). `:Z` = private label (single consumer).
Getting this backwards presents as confusing permission-denied errors, not as an obvious
misconfiguration. No `chcon`, no `semanage`, no policy change — Podman relabels our own
files under `$HOME` as our own user, which needs no privilege.

| Mount | Consumers | Count | Label |
|---|---|---|---|
| `~/nms/rrd` | `nms-rrdcached`, `nms-librenms`, `nms-dispatcher` | **3** | **`:z`** |
| `~/nms/rrd-journal` | `nms-rrdcached` (+ future) | 1 | `:z` |
| `~/nms/config/nginx.conf` | `nms-proxy` | 1 | `:Z,ro` |
| `~/nms/config/tls` | `nms-proxy` | 1 | `:Z,ro` |
| `nms-db-data` (named vol) | `nms-db` | 1 | `:Z` |
| `nms-influxdb-data` (named vol) | `nms-influxdb` | 1 | `:Z` |
| `nms-influxdb-config` (named vol) | `nms-influxdb` | 1 | `:Z` |
| `nms-kcdb-data` (named vol) | `nms-kcdb` | 1 | `:Z` |
| `nms-librenms-data` (named vol) | librenms + 3 sidecars | 4 | `:Z` per-unit* |

*Named Podman volumes are preferred over bind mounts for database data — they live under
`~/.local/share/containers/` and sidestep both the labelling and the UID-mapping problem.

## LibreNMS config includes (`~/nms/config/*.php`)

LibreNMS core (`/opt/librenms/config.php:46`) runs `foreach (glob("/data/config/*.php")
as $filename) include $filename;` — its own supported override hook. We land additive
`NN-*.php` includes into the `nms-librenms-data` volume's `/data/config/` via `podman cp`
(NOT a core/blade/template edit). After landing any include, run
`podman exec nms-librenms php artisan config:clear` — config is cached and the change
otherwise no-ops.

| Include | Purpose |
|---|---|
| `config/10-influxdbv2.php` | InfluxDB v2 datastore (ADR 0009) |
| `config/20-sso.php` | Keycloak SSO auth mechanism (F-5) |
| `config/30-branding.php` | Native-UI rebrand to "AIRNMS" (config-only, FR-07-compliant): sets `project_name`, `page_title_suffix`, **`title_image`** (`images/custom/airnms_logo.png` — navbar wordmark, served via bind-mount), and **`favicon`** (`/images/custom/airnms_favicon.ico` — browser-tab icon). Value-shapes verified against LibreNMS 25.7.0 source: `title_image` goes through `asset()` (web-root relative), `favicon` is emitted **verbatim** into the `<link>` href (no `asset()` wrap), so it uses a **root-relative** path. Deep docs/install strings remain "LibreNMS" (core-only, out of scope). Rollback: delete the file (host + `/data/config/`) + `config:clear`. |

The `30-branding.php` here is the committed copy of a host artifact applied on
`10.121.77.206`; it is NOT auto-mounted by the quadlets (named volume, not a bind mount).

### Branding assets & bind-mounts

The navbar logo and favicon are served files that must survive container restart. `html/images` is
**baked into the LibreNMS image** (not a volume), so a `podman cp` would be ephemeral — each asset is
a single-file `Volume=` bind-mount in `nms-librenms.container`, `:Z` (single-consumer):

| Repo asset | Host path (`%h` = `/opt/airlinq/aqaillm`) | Served path in container | Config key |
|---|---|---|---|
| `config/airnms_logo.png` (340×64 RGBA, transparent) | `%h/nms/branding/airnms_logo.png` | `/opt/librenms/html/images/custom/airnms_logo.png` | `title_image` = `images/custom/airnms_logo.png` |
| `config/airnms_favicon.ico` (16/32/48 multi-size) | `%h/nms/branding/airnms_favicon.ico` | `/opt/librenms/html/images/custom/airnms_favicon.ico` | `favicon` = `/images/custom/airnms_favicon.ico` |

(`config/airnms_favicon_256x256.png` is kept as the source high-DPI PNG; not required by the native UI.)

### Staged deploy runbook — NOT YET EXECUTED (awaits explicit human authorization)

This round is **repo/staging prep only** — nothing below has been run against the host. When the human
authorizes deploy, apply in order (all rootless, no sudo, `aqaillm` UID, non-destructive):

1. **Back up the current branding include** (rollback point):
   `podman exec nms-librenms sh -c 'cp /data/config/30-branding.php /data/config/30-branding.php.bak' || true`
2. **Copy the new assets to the host bind-mount source dir** (from the repo checkout on the host, or via `scp`):
   `mkdir -p ~/nms/branding` then place `airnms_logo.png` and `airnms_favicon.ico` into `~/nms/branding/`.
   (The logo path already exists from the earlier staging; this replaces it with the new processed asset and adds the favicon.)
3. **Land the updated config include** into the `nms-librenms-data` volume:
   `podman cp deploy/librenms-podman/config/30-branding.php nms-librenms:/data/config/30-branding.php`
4. **Reload the favicon bind-mount** (the quadlet gained a new `Volume=` line, so the unit must be re-created, not just restarted):
   `systemctl --user daemon-reload && systemctl --user restart nms-librenms` (targeted; do NOT touch other units).
5. **Clear the cached config** (config is cached; the include otherwise no-ops):
   `podman exec nms-librenms php artisan config:clear`
6. **Verify (authenticated — an unauthenticated curl returns the SSO gate HTML, not the asset):**
   - `<title>` still `… | AIRNMS`, footer/About still "AIRNMS".
   - Navbar renders `<img src=".../images/custom/airnms_logo.png" alt="AIRNMS">` (0 `<svg>` glyph, 0 brand-red `#e30613`).
   - `<link rel="shortcut icon" href="/images/custom/airnms_favicon.ico">` present in the page `<head>`; the `.ico` serves `200 image/x-icon` (or `image/vnd.microsoft.icon`) authenticated.
   - Re-serve the identical sha256 after a `systemctl --user restart nms-librenms` to prove the bind-mount is durable (not an ephemeral `podman cp`).
7. **Rollback (one step):** restore `30-branding.php.bak` → `/data/config/30-branding.php`, `config:clear`, restart `nms-librenms`. Assets are additive files under `images/custom/` — removing the bind-mount lines and re-creating the unit reverts to the stock glyph/favicon.

FR-07: config + custom-asset only. No core file, blade, or template is edited — `images/custom/` is a
docs-sanctioned custom dir; the shipped `librenms_logo.png`/`favicon.ico` core files are untouched.

## Post-install: seed the operator dashboards (FRESH deploy)

On a **fresh** LibreNMS deploy the human's custom operator dashboards are not present — LibreNMS
ships only stock "Default" dashboards. The seed recreates **all three human-authored dashboards**
(all owned by the target user):

| Dashboard | Widgets |
|-----------|---------|
| NOC Triage | 8 |
| Executive Service Overview | 6 |
| L3 Engineer - Radio, Transport & Platform | 13 |

Recreate them from the repo-tracked seed **after the DB is up and after the target user exists**
(the SSO user is provisioned on first login; seed after that first login, or point the seed at an
already-provisioned user).

This is **DB DATA seeding via SQL only** — it is **NOT** a LibreNMS core edit (FR-07 intact).

**Run (on the host, as the deploy user):**
```bash
# after `nms-db` is healthy AND the target user (default: nms-testeng) exists:
cd deploy/librenms-podman/seed/dashboards
./run_seed.sh                        # default target user = nms-testeng
# or target a different provisioned user:
TARGET_USERNAME=<provisioned-username> ./run_seed.sh
```

`run_seed.sh` reads the DB password **key-only** from `~/nms/.env` (never printed), resolves the
target user **by username**, and **aborts** if that user does not exist (fail-closed — never orphans
a dashboard on a missing/`0` user_id). It then applies `seed_dashboards.sql` inside the `nms-db`
container.

**Idempotent** — safe to re-run: each dashboard row is existence-guarded on `(user_id, name)` and its
widget set is replaced scoped to that one `dashboard_id`, so a second run yields the same 3 dashboards
(8 + 6 + 13 = 27 widgets) with no duplication. Validated against throwaway shadow tables
(fresh → re-run → bad-username no-op) without touching live data; evidence in
`.claude/team/artifacts/nms-platform-foundation/dashboard-capture/`.

**user_id portability:** the captured owner's user_id is NOT hardcoded (user_ids differ per install).
All three dashboards are attached to whichever user matches `TARGET_USERNAME` (all three share one
owner). Change the default by setting that env var or editing `@target_username` at the top of
`seed_dashboards.sql`. Note the `L3 Engineer` graph widgets reference devices by numeric `graph_device`
id (captured property, preserved byte-for-byte) — on a fresh install those ids resolve to whatever
device holds them.

**Schema note (25.7.0):** uses `dashboards(dashboard_id,user_id,dashboard_name,access)` and
`users_widgets(user_widget_id,user_id,widget,col,row,size_x,size_y,title,refresh,settings,dashboard_id)`
— note the widget table is `users_widgets` (plural). If a future LibreNMS version changes these
columns, update the seed before running.

## Preconditions of first start — NOT deferrable

Both were configured **before** the stack was first started, per the human's option-1 decision:

1. **InfluxDB v2 bucket retention** — the `nms-influxdb` unit sets
   `DOCKER_INFLUXDB_INIT_RETENTION=14d` at first-start setup, so the `librenms` bucket is
   created with a **14-day** retention period. This replaces the former TimescaleDB
   `add_retention_policy` (ADR 0009); it is set BEFORE first start for the same shared-disk
   reason. Verify with `podman exec nms-influxdb influx bucket list`.
2. **Container log caps** — every unit carries `LogDriver=k8s-file` plus
   `--log-opt max-size=10m` (`journald` silently ignores `max-size` — proven by file size,
   not `podman inspect`).

Rationale: `$HOME` sits on `vg_opt-lv_opt`, the same filesystem as the third party's Kafka
log directory, and the pre-flight VM snapshot was **waived**. An unbounded store filling
this volume has no rollback.

## Disk guardrail

**Always `df -h /opt/airlinq`** (device `vg_opt-lv_opt`). `df -h /` is meaningless here — it
measures a filesystem nothing we write ever touches. Standing abort at **80% used**.

## Co-tenancy rules — violating any of these breaks someone else's workload

- **Never `podman system prune`** (blanket) — it would destroy the account's pre-existing
  `amx-mcp-server` and `node:22-alpine` images. Prune only `nms-`-prefixed images explicitly.
- **Never `loginctl disable-linger`** while the account's own `:8077` (`cli/serve.py`) and
  `:5000` (`local_rag`) services are running — the teardown list below omits it deliberately.
- **Never touch** `/opt/airlinq/Thunder_Sprint_1` or any path not owned by `aqaillm`.
- **Never modify** the account's crontab (it carries the third party's `@reboot` line).
- Off-limits listeners: **9092, 2181, 8077, 5000** — count must stay 4 at every checkpoint.

## Teardown — the co-tenancy promise made concrete

Every artifact carries the `nms-` prefix so this list is enumerable, not archaeological.

```bash
systemctl --user stop nms-proxy nms-keycloak nms-kcdb nms-syslogng nms-snmptrapd \
                      nms-dispatcher nms-librenms nms-influxdb nms-rrdcached \
                      nms-redis nms-db
rm -f ~/.config/containers/systemd/nms-*.container ~/.config/containers/systemd/nms.network
systemctl --user daemon-reload
podman rm -f $(podman ps -aq --filter name='^nms-') 2>/dev/null || true
podman volume rm nms-db-data nms-influxdb-data nms-influxdb-config nms-kcdb-data nms-librenms-data 2>/dev/null || true
podman network rm nms 2>/dev/null || true
# Remove ONLY our images, by explicit name. NEVER `podman system prune`.
podman rmi docker.io/librenms/librenms:25.7.0 docker.io/library/mariadb:11.4 \
           docker.io/library/redis:7.4-alpine docker.io/crazymax/rrdcached:1.8.0 \
           docker.io/library/influxdb:2.7.11 quay.io/keycloak/keycloak:26.0 \
           docker.io/library/postgres:16-alpine docker.io/library/nginx:1.27-alpine
rm -rf ~/nms
# Delete our two commented lines from ~/.ssh/authorized_keys (the comment identifies them).
# DO NOT run `loginctl disable-linger` — see co-tenancy rules above.
```

## TLS trust caveat

The certificate is **self-signed**, generated on the host during deployment (human decision 6).
Browsers and API clients **will warn**, and any client must either trust the certificate
explicitly or skip verification. This is **not a production posture** — a corporate CA is
required for production. The BFF host must be configured to trust this certificate, and
failing to do so presents as a Task 6 code bug rather than as a configuration error.
