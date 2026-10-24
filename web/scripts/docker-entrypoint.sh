#!/bin/sh
# Container start: apply database migrations, then run the web server.
# If a migration fails the container exits, so a broken database is never served.
set -eu

cd /app/tools
echo "Applying database migrations..."
node node_modules/prisma/build/index.js migrate deploy

cd /app
exec node server.js
