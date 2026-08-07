# syntax=docker/dockerfile:1
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.32.0 --activate
WORKDIR /app

FROM base AS build
# 先复制 manifest 以最大化依赖层缓存
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared-types/package.json packages/shared-types/
RUN pnpm install --frozen-lockfile
COPY . .
# NEXT_PUBLIC_* 在 build 时内联进客户端 bundle（浏览器视角，默认指向宿主暴露端口）
ARG NEXT_PUBLIC_API_URL=http://localhost:3301
ARG NEXT_PUBLIC_API_PORT=3301
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_PORT=$NEXT_PUBLIC_API_PORT
# API_URL 供 next.config 的 rewrites() 使用：Next.js 在 build 时把 rewrites 目标烘焙进
# routes-manifest.json，运行期 docker-compose 的 environment.API_URL 对已生成的 manifest 不生效，
# 必须在此处以 build arg 形式传入 Docker 内网地址（compose 里通过 build.args 提供）
ARG API_URL=http://localhost:3301
ENV API_URL=$API_URL
# next.config 的 loadRootEnv() 要求根目录存在 .env，构建期用 example 兜底
RUN cp .env.example .env
RUN pnpm --filter @gridpilot/shared-types build
RUN pnpm --filter web build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
# standalone 自带精简 node_modules，保留 monorepo 目录结构
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
# 运行期 next.config 仍会执行 loadRootEnv()，提供 .env 兜底；但 rewrites() 目标已在 build 阶段
# 由上面的 API_URL build arg 固化进 routes-manifest.json，这里的 .env / compose environment
# 对 rewrites 目标不再生效（其余运行期读取的变量如 WEB_URL 不受此限制）
COPY --from=build /app/.env.example ./.env
EXPOSE 3300
CMD ["node", "apps/web/server.js"]
