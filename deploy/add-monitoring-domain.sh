#!/bin/bash
# One-time: add monitoring.saveboxd.com as an extra SAN on the existing
# certificate, on a server where nginx is ALREADY running with a valid cert
# (unlike init-letsencrypt.sh, which bootstraps from nothing — re-running
# that script here would briefly swap in a throwaway self-signed cert first,
# which we don't need since a real cert already exists).
#
# Prerequisite: monitoring.saveboxd.com A record already points at this
# server's IP (same as saveboxd.com/www).
#
# Run from the repo root, after `git pull` on this branch:
#   ./deploy/add-monitoring-domain.sh you@example.com

set -euo pipefail

domain="saveboxd.com"
email="${1:?usage: $0 <email-for-letsencrypt-expiry-notices>}"
compose="docker compose -f docker-compose.prod.yml"

echo "### Requesting the expanded certificate (adds monitoring.$domain)…"
$compose run --rm --entrypoint sh certbot -c "
  certbot certonly --webroot -w /var/www/certbot \
    -d '$domain' -d 'www.$domain' -d 'monitoring.$domain' \
    --email '$email' --agree-tos --no-eff-email --expand"

echo "### Reloading nginx with the expanded certificate…"
$compose exec nginx nginx -s reload

echo "### Done — https://monitoring.$domain now uses the same certificate."
