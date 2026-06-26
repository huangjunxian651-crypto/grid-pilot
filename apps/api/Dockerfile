# syntax=docker/dockerfile:1
FROM node:20-alpine
RUN apk add --no-cache openssl \
 && corepack enable && corepack prepare pnpm@10.32.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @gridpilot/shared-types build \
 && pnpm --filter @gridpilot/api exec prisma generate \
 && pnpm --filter @gridpilot/api build \
 && chmod +x apps/api/docker-entrypoint.sh
WORKDIR /app/apps/api
EXPOSE 3301
ENTRYPOINT ["sh", "docker-entrypoint.sh"]
