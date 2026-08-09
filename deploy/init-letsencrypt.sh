#!/bin/bash
# First-deployment bootstrap for Let's Encrypt.
#
# Chicken-and-egg problem: the prod nginx config references certificates that
# don't exist yet, so nginx can't start; but certbot needs nginx running to
# answer the ACME HTTP challenge. Classic fix (wmnnd/nginx-certbot pattern):
#  1. create a throwaway self-signed cert so nginx agrees to start,
#  2. delete it and request the real certificate through the running nginx,
#  3. reload nginx with the real certificate.
#
# Run ONCE on the server, from the repo root, after DNS points to it:
#   ./deploy/init-letsencrypt.sh you@example.com

set -euo pipefail

domain="saveboxd.com"
email="${1:?usage: $0 <email-for-letsencrypt-expiry-notices>}"
compose="docker compose -f docker-compose.prod.yml"
live="/etc/letsencrypt/live/$domain"

echo "### Throwaway certificate so nginx can start…"
$compose run --rm --entrypoint sh certbot -c "
  mkdir -p '$live' &&
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout '$live/privkey.pem' -out '$live/fullchain.pem' -subj '/CN=$domain'"

echo "### Starting nginx…"
$compose up -d --build nginx

echo "### Requesting the real certificate…"
$compose run --rm --entrypoint sh certbot -c "
  rm -rf '$live' '/etc/letsencrypt/archive/$domain' '/etc/letsencrypt/renewal/$domain.conf' &&
  certbot certonly --webroot -w /var/www/certbot \
    -d '$domain' -d 'www.$domain' \
    --email '$email' --agree-tos --no-eff-email"

echo "### Reloading nginx with the real certificate…"
$compose exec nginx nginx -s reload

echo "### Done — https://$domain is live (start the rest with:"
echo "###   $compose up -d --build )"
