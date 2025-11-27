#!/bin/bash
set -e

# =============================================================================
# CONFIGURATION
# =============================================================================
SERVER="root@143.198.135.134"
SSH_KEY="~/.ssh/ai_abuse"
DEPLOY_DIR="/opt/aiabusehotline"
# =============================================================================

echo "=== AI Abuse Hotline Deployment ==="

# Create deployment package
echo "Creating deployment package..."
tar -czf /tmp/aiabusehotline.tar.gz \
    --exclude='node_modules' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='.git' \
    --exclude='data/*.db' \
    --exclude='dist' \
    --exclude='.venv' \
    node python static Caddyfile

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
mkdir -p $DEPLOY_DIR/{node,python,static,data}
mkdir -p /var/log/caddy

# Extract files
echo "Extracting deployment package..."
cd $DEPLOY_DIR
tar -xzf /tmp/aiabusehotline.tar.gz

# Install Node.js dependencies and build
echo "Setting up Node.js..."
cd $DEPLOY_DIR/node
if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
npm install
npm run build

# Install Python dependencies
echo "Setting up Python..."
cd $DEPLOY_DIR/python
if ! command -v python3 &> /dev/null; then
    apt-get update
    apt-get install -y python3 python3-pip python3-venv
fi

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install .
pip install uvicorn[standard]
deactivate

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

# Create systemd services
echo "Creating systemd services..."

cat > /etc/systemd/system/aiabusehotline-node.service << 'EOF'
[Unit]
Description=AI Abuse Hotline - Node API
After=network.target

[Service]
WorkingDirectory=/opt/aiabusehotline/node
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PYTHON_INTERNAL_URL=http://127.0.0.1:8000
User=hotline
Group=hotline

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/aiabusehotline-python.service << 'EOF'
[Unit]
Description=AI Abuse Hotline - Python Core
After=network.target

[Service]
WorkingDirectory=/opt/aiabusehotline/python
ExecStart=/opt/aiabusehotline/python/.venv/bin/uvicorn core.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5
Environment=ENV=production
Environment=DB_PATH=/opt/aiabusehotline/data/hotline.db
Environment=ADMIN_TOKEN=${ADMIN_TOKEN:-changeme}
Environment=OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
User=hotline
Group=hotline

[Install]
WantedBy=multi-user.target
EOF

# Set permissions
echo "Setting permissions..."
chown -R hotline:hotline $DEPLOY_DIR/data
chmod 700 $DEPLOY_DIR/data
chown -R hotline:hotline $DEPLOY_DIR/node
chown -R hotline:hotline $DEPLOY_DIR/python

# Reload and start services
echo "Starting services..."
systemctl daemon-reload
systemctl enable aiabusehotline-node aiabusehotline-python caddy
systemctl restart aiabusehotline-python
sleep 2
systemctl restart aiabusehotline-node
systemctl restart caddy

# Check status
echo ""
echo "=== Service Status ==="
systemctl status aiabusehotline-python --no-pager -l || true
echo ""
systemctl status aiabusehotline-node --no-pager -l || true
echo ""
systemctl status caddy --no-pager -l || true

echo ""
echo "=== Deployment complete! ==="
echo "Site should be available at https://aiabusehotline.org"
ENDSSH

# Cleanup
rm /tmp/aiabusehotline.tar.gz

echo "Deployment finished!"
