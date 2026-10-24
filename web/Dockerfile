# syntax=docker/dockerfile:1
# HomeGuard web app. Build context: the web/ folder.
# Prisma 7 with the pg adapter has no native query engine, so the app build is the same for
# amd64 and arm64 and runs on the build machine. Only the migration tools stage is built for
# the target platform, because the Prisma CLI downloads a native schema engine.

FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The build needs no database. This secret only satisfies the env check and is not kept.
RUN mkdir -p public \
 && npx prisma generate \
 && BETTER_AUTH_SECRET=build-only-secret-build-only-secret-0000 npm run build

FROM node:22-alpine AS tools
WORKDIR /tools
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && rm -rf node_modules/next node_modules/@next node_modules/react node_modules/react-dom node_modules/@img \
 && npm cache clean --force
COPY prisma ./prisma
COPY prisma.config.ts ./
COPY scripts ./scripts

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl tzdata
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=192
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Migration CLI, schema and admin scripts live apart from the standalone server:
#   docker compose exec web node /app/tools/scripts/reset-password.mjs <email> <new-password>
COPY --from=tools --chown=node:node /tools /app/tools
RUN chmod +x /app/tools/scripts/docker-entrypoint.sh
USER node
EXPOSE 3000
ENTRYPOINT ["/app/tools/scripts/docker-entrypoint.sh"]
