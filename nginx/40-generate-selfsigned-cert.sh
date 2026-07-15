#!/bin/sh
# Generates a self-signed TLS certificate on first start.
# Scripts in /docker-entrypoint.d/ are run automatically by the nginx image.
set -e

SSL_DIR=/etc/nginx/ssl

if [ ! -f "$SSL_DIR/cert.pem" ]; then
    mkdir -p "$SSL_DIR"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$SSL_DIR/key.pem" \
        -out "$SSL_DIR/cert.pem" \
        -subj "/C=FR/O=ft_transcendence/CN=localhost"
    echo "Self-signed TLS certificate generated in $SSL_DIR"
fi
