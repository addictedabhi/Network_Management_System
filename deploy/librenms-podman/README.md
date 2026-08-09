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
| `nms-timescaledb` | `docker.io/timescale/timescaledb:2.17.2-pg16` | no |
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

Every datastore (MariaDB 3306, TimescaleDB 5432, Redis 6379) and LibreNMS itself (8000) has
**no host-side listener at all**. On this branch that is the *only* boundary — no host
firewall is available without root — so it is negative-tested at Task 0.6 Step 9a.

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
| `~/nms/config/tsdb-init` | `nms-timescaledb` | 1 | `:z,ro` |
| `nms-db-data` (named vol) | `nms-db` | 1 | `:Z` |
| `nms-tsdb-data` (named vol) | `nms-timescaledb` | 1 | `:Z` |
| `nms-kcdb-data` (named vol) | `nms-kcdb` | 1 | `:Z` |
| `nms-librenms-data` (named vol) | librenms + 3 sidecars | 4 | `:Z` per-unit* |

*Named Podman volumes are preferred over bind mounts for database data — they live under
`~/.local/share/containers/` and sidestep both the labelling and the UID-mapping problem.

## Preconditions of first start — NOT deferrable

Both were configured **before** the stack was first started, per the human's option-1 decision:

1. **TimescaleDB retention policy** — `config/tsdb-init/01-retention.sql` runs on first
   database initialisation and installs a **14-day** `add_retention_policy` on `nms_metrics`.
2. **Container log caps** — every unit carries `LogDriver=journald` plus
   `--log-opt max-size=10m`.

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
                      nms-dispatcher nms-librenms nms-timescaledb nms-rrdcached \
                      nms-redis nms-db
rm -f ~/.config/containers/systemd/nms-*.container ~/.config/containers/systemd/nms.network
systemctl --user daemon-reload
podman rm -f $(podman ps -aq --filter name='^nms-') 2>/dev/null || true
podman volume rm nms-db-data nms-tsdb-data nms-kcdb-data nms-librenms-data 2>/dev/null || true
podman network rm nms 2>/dev/null || true
# Remove ONLY our images, by explicit name. NEVER `podman system prune`.
podman rmi docker.io/librenms/librenms:25.7.0 docker.io/library/mariadb:11.4 \
           docker.io/library/redis:7.4-alpine docker.io/crazymax/rrdcached:1.8.0 \
           docker.io/timescale/timescaledb:2.17.2-pg16 quay.io/keycloak/keycloak:26.0 \
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
