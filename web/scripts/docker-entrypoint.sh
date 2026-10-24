#!/bin/sh
# Container start: apply database migrations, then run the web server.
# If a migration fails the container exits, so a broken database is never served.
set -eu

# Fail fast with a plain message, before touching the database.
if [ "${#BETTER_AUTH_SECRET}" -lt 32 ]; then
  echo "BETTER_AUTH_SECRET must be at least 32 characters. Set it in .env (openssl rand -base64 32)." >&2
  exit 1
fi
case "${DATABASE_URL:-}" in
  postgres://*|postgresql://*) ;;
  *) echo "DATABASE_URL must be set and start with postgresql://" >&2; exit 1 ;;
esac

cd /app/tools
echo "Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy

cd /app
exec node server.js
