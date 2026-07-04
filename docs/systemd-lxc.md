# Systemd Deployment on Proxmox LXC

This is the simple Ubuntu/Debian LXC path. Run the service as a non-root user and keep secrets in environment files, not YAML or source.

## Install

```sh
sudo apt-get update
sudo apt-get install -y nodejs corepack git
sudo corepack enable

sudo useradd --system --home /opt/runtrail --shell /usr/sbin/nologin runtrail
sudo mkdir -p /opt/runtrail /etc/runtrail /var/lib/runtrail /var/log/runtrail
sudo chown -R runtrail:runtrail /opt/runtrail /var/lib/runtrail /var/log/runtrail

sudo git clone https://github.com/redxzeta/runtrail.git /opt/runtrail
cd /opt/runtrail
sudo -u runtrail corepack pnpm install --frozen-lockfile
sudo -u runtrail corepack pnpm build
```

## Configure

Copy non-secret defaults:

```sh
sudo cp /opt/runtrail/config/runtrail.example.yaml /etc/runtrail/config.yaml
```

Use environment variables for secrets and host-specific paths:

```sh
sudo tee /etc/runtrail/runtrail.env >/dev/null <<'EOF'
RUNTRAIL_HOST=0.0.0.0
RUNTRAIL_PORT=8787
RUNTRAIL_DB_PATH=/var/lib/runtrail/runtrail.sqlite
RUNTRAIL_LOG_DIR=/var/log/runtrail
RUNTRAIL_TOKEN=replace-with-a-long-random-secret
RUNTRAIL_URL=http://127.0.0.1:8787
DISCORD_WEBHOOK_URL=
EOF
sudo chmod 600 /etc/runtrail/runtrail.env
sudo chown root:runtrail /etc/runtrail/runtrail.env
```

## Service

```sh
sudo cp /opt/runtrail/systemd/runtrail.service /etc/systemd/system/runtrail.service
sudo systemctl daemon-reload
sudo systemctl enable runtrail
sudo systemctl start runtrail
```

Operate it with:

```sh
sudo systemctl start runtrail
sudo systemctl stop runtrail
sudo systemctl restart runtrail
sudo systemctl status runtrail
journalctl -u runtrail -f
```

Check health:

```sh
curl http://127.0.0.1:8787/health
```

Expose Runtrail only on a trusted LAN or VPN.
