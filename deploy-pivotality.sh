#!/usr/bin/env bash
# Deploy AI Abuse Hotline to Hetzner pivotality server
# (simpler version - assumes infrastructure already set up)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVER="root@37.27.92.21"
SSH_KEY="$HOME/.ssh/pivotality"
DEPLOY_DIR="/opt/aiabusehotline"

echo "=== Deploying AI Abuse Hotline ==="

# 1. Deploy files
echo "Deploying files..."
rsync -av -e "ssh -i $SSH_KEY" \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'data/*.db' \
  --exclude 'bun.lockb' \
  --exclude '.env*' \
  "$SCRIPT_DIR/src" \
  "$SCRIPT_DIR/static" \
  "$SCRIPT_DIR/package.json" \
  "$SERVER:$DEPLOY_DIR/"

# 2. Install dependencies and restart
echo "Installing dependencies..."
ssh -i "$SSH_KEY" "$SERVER" "cd $DEPLOY_DIR && bun install && systemctl restart aiabusehotline"

# 3. Test
echo "Testing..."
sleep 2
curl -s "https://aiabusehotline.org/api/v1/health" || echo "(health endpoint may need auth)"

echo ""
echo "=== Done: https://aiabusehotline.org ==="
echo "Logs: ssh -i ~/.ssh/pivotality root@37.27.92.21 'journalctl -u aiabusehotline -f'"
