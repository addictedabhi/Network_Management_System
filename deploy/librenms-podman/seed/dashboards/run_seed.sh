#!/usr/bin/env bash
# =============================================================================
# run_seed.sh - apply the AIRNMS operator dashboard seed on a FRESH deploy.
# =============================================================================
# Runs seed_dashboards.sql against the LibreNMS MariaDB (container `nms-db`).
# Seeds ALL THREE human-authored dashboards (all owned by the target user):
#     "NOC Triage" (8 widgets), "Executive Service Overview" (6 widgets),
#     "L3 Engineer - Radio, Transport & Platform" (13 widgets).
# Idempotent: safe to re-run - it will not duplicate the dashboards or widgets.
#
# Intended for a FRESH stack (auto-recreate the operator dashboards). It is also
# safe to re-run on an existing stack, but on the LIVE production DB it will
# reset THESE dashboards' widgets to the captured set - run it there only if you
# intend that.
#
# Credential hygiene: the DB password is read KEY-ONLY from ~/nms/.env into a
# shell variable and passed to the client via MYSQL_PWD in the container's env.
# It is NEVER printed. Do not add `set -x` around the password read.
#
# Usage (on the deploy host 10.121.77.206, as the deploy user):
#   ./run_seed.sh                      # target user defaults to nms-testeng
#   TARGET_USERNAME=some-user ./run_seed.sh
#
# Env:
#   DB_CONTAINER     container name (default: nms-db)
#   DB_NAME          database name  (default: librenms)
#   DB_USER          database user  (default: librenms)
#   ENV_FILE         path to the env file holding MARIADB_PASSWORD
#                    (default: $HOME/nms/.env)
#   TARGET_USERNAME  username to own the dashboards (default: nms-testeng)
# =============================================================================
set -euo pipefail

DB_CONTAINER="${DB_CONTAINER:-nms-db}"
DB_NAME="${DB_NAME:-librenms}"
DB_USER="${DB_USER:-librenms}"
ENV_FILE="${ENV_FILE:-$HOME/nms/.env}"
TARGET_USERNAME="${TARGET_USERNAME:-nms-testeng}"
SQL_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/seed_dashboards.sql"

# --- read DB password key-only (value never echoed) --------------------------
if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: env file not found: $ENV_FILE" >&2; exit 2
fi
DB_PASSWORD="$(grep -oE '^MARIADB_PASSWORD=.*' "$ENV_FILE" | cut -d= -f2- || true)"
if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "ERROR: MARIADB_PASSWORD not found in $ENV_FILE" >&2; exit 2
fi

runsql() {
  # Run SQL from stdin inside the DB container. MYSQL_PWD keeps the secret off
  # the process argv and off the terminal.
  podman exec -i -e MYSQL_PWD="$DB_PASSWORD" "$DB_CONTAINER" \
    mariadb -u"$DB_USER" "$DB_NAME" "$@"
}

# --- PRIMARY fail-closed guard: resolve the target user FIRST -----------------
# (The SQL is also self-guarding, but aborting here gives a clear exit code and
#  guarantees we never even source the seed against a missing user. All three
#  dashboards share this one owner.)
UID_FOUND="$(printf "SELECT user_id FROM users WHERE username='%s' LIMIT 1;" "$TARGET_USERNAME" \
             | runsql -N -B 2>/dev/null || true)"
if [[ -z "$UID_FOUND" ]]; then
  echo "ABORT: target user '$TARGET_USERNAME' does not exist in $DB_NAME.users." >&2
  echo "       Create the user first (SSO login provisions it) or set TARGET_USERNAME." >&2
  exit 3
fi
echo "Target user '$TARGET_USERNAME' resolved (user_id present). Seeding dashboards..."

# --- apply the seed (pass the username as a session variable) ----------------
{
  printf "SET @target_username='%s';\n" "$TARGET_USERNAME"
  cat "$SQL_FILE"
} | runsql --table

echo "Seed complete. Re-running this script is safe (idempotent)."
