#!/usr/bin/env bash
# One-command public deploy for the bot hosting panel.
#
#   needs: a Linux box with docker, ports 80/443 open, and DNS A record -> this box
#
#   curl -fsSL https://raw.githubusercontent.com/alaxaishere-cmyk/bot-hosting/arena/01a06fa3-bot-hosting/deploy/deploy.sh \
#     | sudo env DOMAIN=bot.example.com bash
#
# Re-runnable: it recreates the containers, your data stays in $DIR/data.
set -euo pipefail

DOMAIN="${DOMAIN:?set DOMAIN=your.domain  (e.g. sudo env DOMAIN=bot.example.com bash)}"
REPO="${REPO:-https://github.com/alaxaishere-cmyk/bot-hosting}"
REF="${REF:-arena/01a06fa3-bot-hosting}"
IMAGE="${IMAGE:-ghcr.io/alaxaishere-cmyk/bot-hosting:latest}"
DIR="${DIR:-/srv/bot-hosting}"
ADMIN="${PANEL_ADMIN_USER:-admin}"
PASS="${PANEL_ADMIN_PASS:-$(head -c 12 /dev/urandom | base64 | tr -d '/+=' )}"

command -v docker >/dev/null || { echo "install docker first:  curl -fsSL https://get.docker.com | sh"; exit 1; }
mkdir -p "$DIR/data"; chmod 700 "$DIR/data"

if ! docker pull --quiet "$IMAGE"; then
  echo "→ $IMAGE not pullable (private package?) — building from source instead"
  [ -d "$DIR/src/.git" ] || git clone --depth 1 --branch "$REF" "$REPO" "$DIR/src"
  ( cd "$DIR/src" && git pull --ff-only || true )
  docker build -q -t bot-hosting:local "$DIR/src" -f "$DIR/src/Dockerfile" >/dev/null
  IMAGE=bot-hosting:local
fi

# a bare IP gets plain http (no certificate possible); a domain gets auto HTTPS
if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then SITE="http://$DOMAIN"; else SITE="$DOMAIN"; fi

cat > "$DIR/Caddyfile" <<EOF
$SITE {
	encode gzip
	reverse_proxy 127.0.0.1:3000 {
		flush_interval -1
	}
}
EOF

docker rm -f bot-panel bot-caddy >/dev/null 2>&1 || true

docker run -d --name bot-panel --restart unless-stopped \
  --memory 4g --cpus 4 --pids-limit 4096 \
  -v "$DIR/data:/app/data" \
  -e PANEL_ADMIN_USER="$ADMIN" -e PANEL_ADMIN_PASS="$PASS" \
  -e PANEL_ALLOWED_HOSTS="$DOMAIN" \
  -p 127.0.0.1:3000:3000 \
  "$IMAGE" >/dev/null

docker volume create caddy_data >/dev/null; docker volume create caddy_config >/dev/null
docker run -d --name bot-caddy --restart unless-stopped \
  -v "$DIR/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v caddy_data:/data -v caddy_config:/config \
  -p 80:80 -p 443:443 -p 443:443/udp \
  caddy:2-alpine >/dev/null

sleep 4
echo
echo "  waiting for the container…"
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000/healthz" || true)
  [ "$code" = "200" ] && break
  sleep 1
done
echo "  panel health on localhost: ${code:-none}"
echo
echo "  ─────────────────────────────────────────────"
echo "  public url   :  $([ "$SITE" = "$DOMAIN" ] && echo https || echo http)://$DOMAIN"
echo "  first login  :  $ADMIN  /  $PASS"
echo "  (only works on the very first boot — after that the password lives in the db)"
echo "  data + logs  :  $DIR/data"
echo "  logs         :  docker logs -f bot-panel"
echo "  per user     :  308 MiB RAM · 719 MiB disk · 25% CPU (locked)"
echo "  ─────────────────────────────────────────────"
echo
