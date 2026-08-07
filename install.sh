#!/usr/bin/env bash
# GridPilot 一键安装：检测 Docker → 准备 .env → docker compose up --build -d
# 只依赖 Docker，不需要 Node/pnpm。可重复运行（幂等）。
set -euo pipefail
cd "$(dirname "$0")"

info() { printf '\033[36m[install]\033[0m %s\n' "$1"; }
fail() { printf '\033[31m[install]\033[0m %s\n' "$1" >&2; exit 1; }

if ! command -v docker >/dev/null 2>&1; then
  fail "未检测到 Docker，请先安装：https://docs.docker.com/engine/install/"
fi

if ! docker compose version >/dev/null 2>&1; then
  fail "Docker 已安装，但缺少 Compose 插件，请参考：https://docs.docker.com/compose/install/"
fi

if ! docker info >/dev/null 2>&1; then
  fail "无法连接 Docker daemon（是否未启动，或当前用户无权限访问？）"
fi

if [ ! -f .env ]; then
  info "未找到 .env，从 .env.example 生成"
  cp .env.example .env
fi

if grep -q '^ENCRYPTION_KEY=your-key-REPLACE' .env 2>/dev/null || ! grep -q '^ENCRYPTION_KEY=.\+' .env; then
  info "生成随机 ENCRYPTION_KEY"
  key=$(openssl rand -base64 32)
  # macOS/BSD sed 与 GNU sed 的 -i 参数不兼容，用临时文件规避
  awk -v key="$key" '/^ENCRYPTION_KEY=/{print "ENCRYPTION_KEY=" key; next} {print}' .env > .env.tmp
  mv .env.tmp .env
fi

info "构建镜像并启动 postgres + redis + api + web（首次构建可能需要几分钟）"
docker compose up --build -d

web_port=$(grep '^WEB_PORT=' .env | cut -d= -f2)
web_port=${web_port:-3300}

info "等待服务健康检查通过..."
deadline=$((SECONDS + 120))
until curl -fsS "http://localhost:${web_port}/" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    fail "超时：服务未在 120 秒内就绪，运行 'docker compose logs' 排查"
  fi
  sleep 3
done

info "启动完成，访问 http://localhost:${web_port}/"
