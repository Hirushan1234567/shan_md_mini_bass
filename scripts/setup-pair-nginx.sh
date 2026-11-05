#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${PAIR_DOMAIN:-panel.shanvps.duckdns.org}"
UPSTREAM="127.0.0.1:3010"
CONF="/etc/nginx/sites-available/shan-pair-api"
ENABLED="/etc/nginx/sites-enabled/shan-pair-api"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/setup-pair-nginx.sh"
  exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
  echo "Nginx is not installed. Install it first: apt update && apt install nginx -y"
  exit 1
fi

if ! curl -fsS "http://${UPSTREAM}/health" >/dev/null; then
  echo "Pair API is not responding at http://${UPSTREAM}/health."
  echo "Keep 'npm run pair' running, then run this script again."
  exit 1
fi

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

if [[ -f "${CONF}" ]]; then
  cp "${CONF}" "${CONF}.bak.$(date +%Y%m%d%H%M%S)"
fi

cat > "${CONF}" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    location = /pair-api {
        return 301 /pair-api/;
    }

    location ^~ /pair-api/ {
        rewrite ^/pair-api/(.*)$ /\$1 break;
        proxy_pass http://${UPSTREAM};
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 240s;
        proxy_send_timeout 240s;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

ln -sfn "${CONF}" "${ENABLED}"
nginx -t
systemctl reload nginx

echo
echo "Nginx reverse proxy configured for ${DOMAIN}/pair-api/"
echo "Local Pair API health check passed."
echo "Test HTTP: curl -i http://${DOMAIN}/pair-api/health"
echo "After DNS points to this VPS, enable HTTPS with:"
echo "  apt install certbot python3-certbot-nginx -y"
echo "  certbot --nginx -d ${DOMAIN}"
