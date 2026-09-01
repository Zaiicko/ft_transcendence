#!/bin/bash
# One-time: add analytics.saveboxd.com as an extra SAN on the existing
# certificate, on a server where nginx is ALREADY running with a valid cert
# (unlike init-letsencrypt.sh, which bootstraps from nothing — re-running
# that script here would briefly swap in a throwaway self-signed cert first,
# which we don't need since a real cert already exists).
#
# Prerequisite: analytics.saveboxd.com A record already points at this
# server's IP (same as saveboxd.com/www/monitoring).
#
# Run from the repo root, after `git pull` on this branch:
#   ./deploy/add-analytics-domain.sh you@example.com

set -euo pipefail

domain="saveboxd.com"
email="${1:?usage: $0 <email-for-letsencrypt-expiry-notices>}"
compose="docker compose -f docker-compose.prod.yml"

echo "### Requesting the expanded certificate (adds analytics.$domain)…"
$compose run --rm --entrypoint sh certbot -c "
  certbot certonly --webroot -w /var/www/certbot \
    -d '$domain' -d 'www.$domain' -d 'monitoring.$domain' -d 'analytics.$domain' \
    --email '$email' --agree-tos --no-eff-email --expand"

echo "### Reloading nginx with the expanded certificate…"
$compose exec nginx nginx -s reload

echo "### Done — https://analytics.$domain now uses the same certificate."
