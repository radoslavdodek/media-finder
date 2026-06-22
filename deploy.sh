#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration — edit these before first use
# ---------------------------------------------------------------------------
SSH_USER="ubuntu"
SSH_HOST="HOST"
SSH_PORT="22"
SSH_KEY="KEY"   # e.g. ~/.ssh/id_ed25519 (leave empty to use default)
APP_DIR="/var/www/indek.eu"                   # absolute path on the server
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="${SCRIPT_DIR}/src"
DEPLOY_STARTED_AT="$(date '+%Y-%m-%d %H:%M:%S')"

print_step() { echo -e "\n\033[1;34m==> $1\033[0m"; }
print_ok()   { echo -e "\033[1;32m    OK\033[0m"; }
print_err()  { echo -e "\033[1;31m    ERROR: $1\033[0m" >&2; exit 1; }

SSH_OPTS="-p ${SSH_PORT} -o StrictHostKeyChecking=accept-new"
[[ -n "$SSH_KEY" ]] && SSH_OPTS="$SSH_OPTS -o IdentitiesOnly=yes -i $SSH_KEY"

ssh_run() {
  ssh $SSH_OPTS "${SSH_USER}@${SSH_HOST}" "$@"
}

# ---------------------------------------------------------------------------
print_step "Connecting to ${SSH_USER}@${SSH_HOST}…"
ssh_run "echo 'Connection OK'" || print_err "Cannot reach server"
print_ok

# ---------------------------------------------------------------------------
print_step "Syncing application to ${APP_DIR}"
[[ -d "$SOURCE_DIR" ]] || print_err "Source directory not found: ${SOURCE_DIR}"

RSYNC_OUTPUT="$(mktemp)"
trap 'rm -f "$RSYNC_OUTPUT"' EXIT

if ! rsync -avz --delete \
  -e "ssh ${SSH_OPTS}" \
  --rsync-path="sudo rsync" \
  --exclude '.DS_Store' \
  "${SOURCE_DIR}/" "${SSH_USER}@${SSH_HOST}:${APP_DIR}/" \
  2>&1 | tee "$RSYNC_OUTPUT"; then
  print_err "rsync failed — see output above"
fi

FILES_SYNCED="$(grep 'Transfer starting:' "$RSYNC_OUTPUT" | sed -E 's/.*: ([0-9]+) files.*/\1/' || true)"
FILES_SYNCED="${FILES_SYNCED:-unknown}"
print_ok

# ---------------------------------------------------------------------------
print_step "Verifying nginx config and reloading if changed"
ssh_run "
  set -e
  sudo nginx -t 2>&1 && sudo systemctl reload nginx
"
print_ok

# ---------------------------------------------------------------------------
DEPLOY_FINISHED_AT="$(date '+%Y-%m-%d %H:%M:%S')"
echo -e "\n\033[1;32mDeployment complete.\033[0m"
echo
echo "Summary"
echo "-------"
echo "  Server:     ${SSH_USER}@${SSH_HOST}:${SSH_PORT}"
echo "  Remote dir: ${APP_DIR}"
echo "  Source:     ${SOURCE_DIR}/"
echo "  Started:    ${DEPLOY_STARTED_AT}"
echo "  Finished:   ${DEPLOY_FINISHED_AT}"
echo "  Files:      ${FILES_SYNCED} synced"
echo "  Steps:      connection, rsync sync, nginx reload"
