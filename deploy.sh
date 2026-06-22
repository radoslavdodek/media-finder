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

rsync -avz --delete \
  -e "ssh ${SSH_OPTS}" \
  --exclude '.DS_Store' \
  "${SOURCE_DIR}/" "${SSH_USER}@${SSH_HOST}:${APP_DIR}/"
print_ok

# ---------------------------------------------------------------------------
print_step "Verifying nginx config and reloading if changed"
ssh_run "
  set -e
  sudo nginx -t 2>&1 && sudo systemctl reload nginx
"
print_ok

# ---------------------------------------------------------------------------
echo -e "\n\033[1;32mDeployment complete.\033[0m"
