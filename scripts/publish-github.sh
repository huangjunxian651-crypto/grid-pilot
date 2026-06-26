#!/usr/bin/env bash
#
# publish-github.sh — 将 GridPilot 的「脱敏快照」发布到公开 GitHub。
#
# 设计目标（与内部 GitLab 完全分隔）：
#   • checkout / 快照模式：从 git archive 导出**仅被跟踪的文件**到全新空目录，
#     在那里 `git init` 成全新仓库 —— 公开仓库不含任何内部 GitLab 提交历史/提交信息。
#   • 脱敏：剔除内部设计文档(docs/superpowers)、密钥(.env.test 等)、agent/内部基建文件。
#   • 身份：以 web3neil <wanxsbus@gmail.com> 名义提交（不改动本仓库的 GitLab 提交身份）。
#   • 安全闸：发布前扫描私钥/非示例 .env，发现即中止。
#
# 用法：
#   DRY_RUN=1 scripts/publish-github.sh     # 只生成并校验快照，不推送（强烈建议先跑）
#   scripts/publish-github.sh               # 生成快照并强推到 GitHub
#
# 可用环境变量覆盖默认值：
#   GH_REMOTE_URL  目标 GitHub 仓库（默认 git@github.com:QuantiaAI/grid-pilot.git）
#   GH_BRANCH      目标分支（默认 main）
#   PUB_NAME       提交者名（默认 web3neil）
#   PUB_EMAIL      提交者邮箱（默认 wanxsbus@gmail.com）
#   COMMIT_MSG     提交信息（默认 "Initial public release"）
#   SRC_REF        快照来源 ref（默认 HEAD —— 即当前检出的分支）
#   DRY_RUN        1=只生成不推送
#
set -euo pipefail

GH_REMOTE_URL="${GH_REMOTE_URL:-git@github.com:QuantiaAI/grid-pilot.git}"
GH_BRANCH="${GH_BRANCH:-main}"
PUB_NAME="${PUB_NAME:-web3neil}"
PUB_EMAIL="${PUB_EMAIL:-wanxsbus@gmail.com}"
COMMIT_MSG="${COMMIT_MSG:-Initial public release}"
SRC_REF="${SRC_REF:-HEAD}"
DRY_RUN="${DRY_RUN:-0}"

# 脱敏：从公开快照中剔除的路径（相对仓库根；basename 形式会被全树递归删除）。
STRIP_PATHS=(
  "docs/superpowers"            # 内部设计文档（plans/specs）
  "docs/archive"               # 内部归档设计/架构文档
  "e2e/reconcile"              # 内部三所对账台账 / BUG 时间线
  ".env.test"                 # 含 ENCRYPTION_KEY / DB URL 等
  ".obsidian"
)
# 内部、有时效的计划/审计文档（docs/ 顶层，按文件名前缀剔除；保留 ARCHITECTURE/STRATEGY/各 guide）。
STRIP_DOC_GLOBS=( "AUDIT-*.md" "FIX-PLAN-*.md" )
STRIP_BASENAMES=(
  "AGENTS.md"                 # 内部 agent 协作说明（根 + apps/*）
  ".DS_Store"
  ".claude" ".claire" ".superpowers" ".worktrees" ".claire"
)

say() { printf '\033[36m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✔\033[0m %s\n' "$*"; }
die() { printf '\033[31m✋ %s\033[0m\n' "$*" >&2; exit 1; }

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

work="$(mktemp -d "${TMPDIR:-/tmp}/gridpilot-public.XXXXXX")"
cleanup() { [ "$DRY_RUN" = "1" ] || rm -rf "$work"; }
trap cleanup EXIT

# 1) 仅导出被跟踪的文件（无 .git 历史、无未跟踪的 .env 等本地密钥）。
say "导出被跟踪文件 @ ${SRC_REF} → ${work}"
git archive --format=tar "$SRC_REF" | tar -x -C "$work"

# 2) 脱敏：删除内部/敏感路径。
say "脱敏：剔除内部文档与密钥"
for p in "${STRIP_PATHS[@]}"; do rm -rf "${work:?}/$p"; done
for b in "${STRIP_BASENAMES[@]}"; do find "$work" -depth -name "$b" -exec rm -rf {} + 2>/dev/null || true; done
# 兜底：递归剔除任何名为 superpowers 的目录（防止 docs/archive 之外的副本）。
find "$work" -depth -type d -name superpowers -exec rm -rf {} + 2>/dev/null || true
# 剔除 docs/ 顶层的内部时效文档。
if [ -d "$work/docs" ]; then
  for g in "${STRIP_DOC_GLOBS[@]}"; do find "$work/docs" -maxdepth 1 -type f -name "$g" -delete 2>/dev/null || true; done
fi

# 3) 安全闸：发现私钥/非示例 .env 即中止（宁可不发，也不泄密）。
say "安全扫描"
if find "$work" -type f \( -name ".env" -o -name ".env.*" \) ! -name "*.example" | grep -q .; then
  echo "  以下非示例 env 文件仍在快照中："
  find "$work" -type f \( -name ".env" -o -name ".env.*" \) ! -name "*.example"
  die "检测到非示例 .env 文件，已中止。请加入 STRIP 列表后重试。"
fi
if grep -rIlE -- "-----BEGIN (RSA|OPENSSH|EC|PGP|DSA) PRIVATE KEY-----" "$work" >/dev/null 2>&1; then
  grep -rIlE -- "-----BEGIN .* PRIVATE KEY-----" "$work" | head
  die "检测到私钥，已中止。"
fi

file_count="$(find "$work" -type f | wc -l | tr -d ' ')"
ok "脱敏完成：${file_count} 个文件"

# 4) 全新仓库（全新历史 → 零内部提交泄露），以 web3neil 身份单次快照提交。
say "构建全新孤儿快照仓库"
cd "$work"
git init -q -b "$GH_BRANCH"
git add -A
git -c user.name="$PUB_NAME" -c user.email="$PUB_EMAIL" \
    -c commit.gpgsign=false \
    commit -q --author="$PUB_NAME <$PUB_EMAIL>" -m "$COMMIT_MSG"
git remote add github "$GH_REMOTE_URL"
ok "快照提交：$(git log -1 --format='%h  %an <%ae>  %s')"

# 校验：快照里绝不能残留内部文档
if git -C "$work" ls-files | grep -qE "superpowers|docs/archive|/AGENTS\.md$|^AGENTS\.md$|e2e/reconcile|\.env\.test|AUDIT-.*\.md|FIX-PLAN-.*\.md"; then
  die "快照仍含应剔除的内部文件，请检查。"
fi
ok "校验通过：无内部文档/密钥残留"

if [ "$DRY_RUN" = "1" ]; then
  printf '\n\033[33mDRY_RUN=1 → 未推送。\033[0m 快照目录（可人工核查）：\n  %s\n' "$work"
  echo "核查命令：git -C $work ls-files | less"
  exit 0
fi

# 5) 强推到 GitHub（与 origin/GitLab 完全独立的 remote）。
say "强推快照到 ${GH_REMOTE_URL} (${GH_BRANCH})"
git push --force github "$GH_BRANCH"
ok "已发布到 GitHub：$GH_REMOTE_URL ($GH_BRANCH)"
