#!/bin/bash
set -e

# =============================================================================
# CONFIGURATION
# =============================================================================
SERVER="root@143.198.135.134"
SSH_KEY="~/.ssh/ai_abuse"
DEPLOY_DIR="/opt/aiabusehotline"
# =============================================================================

# =============================================================================
# SSH KEY SETUP (important for future sessions!)
# =============================================================================
# The SSH key has a passphrase. Before deploying, you must add it to ssh-agent:
#
#   ssh-add --apple-use-keychain ~/.ssh/ai_abuse
#
# Enter the passphrase when prompted. This persists across terminal sessions
# on macOS if you use --apple-use-keychain. Without this, deploys will fail
# with "Permission denied (publickey)".
# =============================================================================

echo "=== AI Abuse Hotline Deployment (Bun) ==="

# Create deployment package
echo "Creating deployment package..."
tar -czf /tmp/aiabusehotline.tar.gz \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='data/*.db' \
    --exclude='bun.lockb' \
    src static Caddyfile package.json

# Upload to server
echo "Uploading to server..."
scp -i $SSH_KEY /tmp/aiabusehotline.tar.gz $SERVER:/tmp/

# Run deployment on server
echo "Running deployment on server..."
ssh -i $SSH_KEY $SERVER << 'ENDSSH'
set -e

DEPLOY_DIR="/opt/aiabusehotline"

# Create hotline user if not exists
if ! id "hotline" &>/dev/null; then
    echo "Creating hotline user..."
    useradd -r -s /bin/false hotline
fi

# Create directories
echo "Setting up directories..."
mkdir -p $DEPLOY_DIR/{src,static,data}
mkdir -p /var/log/caddy

# Extract files
echo "Extracting deployment package..."
cd $DEPLOY_DIR
tar -xzf /tmp/aiabusehotline.tar.gz

# Install Bun if not present
if ! command -v bun &> /dev/null; then
    echo "Installing Bun..."
    apt-get update && apt-get install -y unzip
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# Make sure bun is in PATH for this session
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Install dependencies
echo "Installing dependencies..."
cd $DEPLOY_DIR
bun install

# Install Caddy if not present
if ! command -v caddy &> /dev/null; then
    echo "Installing Caddy..."
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update
    apt-get install caddy
fi

# Copy Caddyfile
cp $DEPLOY_DIR/Caddyfile /etc/caddy/Caddyfile

# Create systemd service
echo "Creating systemd service..."

cat > /etc/systemd/system/aiabusehotline.service << 'EOF'
[Unit]
Description=AI Abuse Hotline
After=network.target

[Service]
WorkingDirectory=/opt/aiabusehotline
ExecStart=/root/.bun/bin/bun run src/server.ts
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3000
Environment=DB_PATH=/opt/aiabusehotline/data/hotline.db
Environment=ADMIN_TOKEN=${ADMIN_TOKEN:-changeme}
Environment=NTFY_TOPIC=${NTFY_TOPIC:-}
Environment=OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
User=root
Group=root

[Install]
WantedBy=multi-user.target
EOF

# Set permissions
echo "Setting permissions..."
chown -R root:root $DEPLOY_DIR
chmod 700 $DEPLOY_DIR/data
chmod 755 $DEPLOY_DIR/static
chmod 644 $DEPLOY_DIR/static/*

# Remove old services if they exist
systemctl disable aiabusehotline-node 2>/dev/null || true
systemctl disable aiabusehotline-python 2>/dev/null || true
systemctl stop aiabusehotline-node 2>/dev/null || true
systemctl stop aiabusehotline-python 2>/dev/null || true
rm -f /etc/systemd/system/aiabusehotline-node.service
rm -f /etc/systemd/system/aiabusehotline-python.service

# Reload and start services
echo "Starting services..."
systemctl daemon-reload
systemctl enable aiabusehotline caddy
systemctl restart aiabusehotline
systemctl restart caddy

# Check status
echo ""
echo "=== Service Status ==="
systemctl status aiabusehotline --no-pager -l || true
echo ""
systemctl status caddy --no-pager -l || true

echo ""
echo "=== Deployment complete! ==="
echo "Site should be available at https://aiabusehotline.org"
ENDSSH

# Cleanup
rm /tmp/aiabusehotline.tar.gz

echo "Deployment finished!"
