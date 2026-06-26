#!/usr/bin/env bash
#
# publish-github.sh — 将 GridPilot 的「脱敏快照」发布到公开 GitHub。
#
# 两种发布模式（MODE，默认 append）：
#   • append（默认，增量历史）：拉取现有公开分支 → 用最新脱敏快照替换工作树 →
#     追加**一个**脱敏 commit（你自定义的通用信息）→ 普通 push（不 force）。
#     公开仓库保留可读的发布时间线，已 clone 的人可 `git pull`；
#     内部 GitLab 的提交信息一条都不会上去（每次仍是单个脱敏 commit）。
#   • snapshot（彻底重置）：git init 全新空仓库 → 单个孤儿 commit → 强推覆盖。
#     公开仓库永远只有 1 个 commit，适合首次建库或需要抹掉历史重来。
#
# 共同保证（与内部 GitLab 完全分隔、零泄密）：
#   • 仅导出被跟踪文件（git archive），无 .git 历史、无未跟踪的本地 .env。
#   • 脱敏：剔除内部设计文档(docs/superpowers、docs/archive)、密钥(.env.test)、
#     agent/内部基建文件(AGENTS.md 等)；安全闸扫描私钥/非示例 .env，发现即中止。
#   • 以 web3neil <wanxsbus@gmail.com> 名义提交（不改动本仓库的 GitLab 提交身份）。
#
# 用法：
#   DRY_RUN=1 scripts/publish-github.sh                 # 只生成并校验，不推送（建议先跑）
#   scripts/publish-github.sh                           # append（默认）：追加一个脱敏 commit
#   MODE=snapshot scripts/publish-github.sh             # snapshot：强推覆盖为单 commit
#   COMMIT_MSG="release: v0.5.1" scripts/publish-github.sh
#
# 可用环境变量：MODE / GH_REMOTE_URL / GH_BRANCH / PUB_NAME / PUB_EMAIL / COMMIT_MSG / SRC_REF / DRY_RUN
#
set -euo pipefail

MODE="${MODE:-append}"                       # append | snapshot
GH_REMOTE_URL="${GH_REMOTE_URL:-git@github.com:QuantiaAI/grid-pilot.git}"
GH_BRANCH="${GH_BRANCH:-main}"
PUB_NAME="${PUB_NAME:-web3neil}"
PUB_EMAIL="${PUB_EMAIL:-wanxsbus@gmail.com}"
SRC_REF="${SRC_REF:-HEAD}"
DRY_RUN="${DRY_RUN:-0}"
# 提交信息默认按模式区分：snapshot 首发用"Initial public release"，append 用"sync"。
if [ "$MODE" = "snapshot" ]; then
  COMMIT_MSG="${COMMIT_MSG:-Initial public release}"
else
  COMMIT_MSG="${COMMIT_MSG:-chore: sync public snapshot ($(date +%F))}"
fi

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
  ".claude" ".claire" ".superpowers" ".worktrees"
)

say() { printf '\033[36m→\033[0m %s\n' "$*"; }
ok()  { printf '\033[32m✔\033[0m %s\n' "$*"; }
die() { printf '\033[31m✋ %s\033[0m\n' "$*" >&2; exit 1; }

# 校验某个 git 仓库的暂存/跟踪区不含内部文档。
assert_clean() {
  local dir="$1"
  if git -C "$dir" ls-files | grep -qE "superpowers|docs/archive|/AGENTS\.md$|^AGENTS\.md$|e2e/reconcile|\.env\.test|AUDIT-.*\.md|FIX-PLAN-.*\.md"; then
    die "快照仍含应剔除的内部文件，请检查。"
  fi
  ok "校验通过：无内部文档/密钥残留"
}

[ "$MODE" = "append" ] || [ "$MODE" = "snapshot" ] || die "未知 MODE=$MODE（应为 append 或 snapshot）"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

work="$(mktemp -d "${TMPDIR:-/tmp}/gridpilot-tree.XXXXXX")"
pub="$(mktemp -d "${TMPDIR:-/tmp}/gridpilot-pub.XXXXXX")"
cleanup() { [ "$DRY_RUN" = "1" ] || rm -rf "$work" "$pub"; }
trap cleanup EXIT

# ── 1) 仅导出被跟踪的文件 → 脱敏树 $work ───────────────────────────────
say "导出被跟踪文件 @ ${SRC_REF}"
git archive --format=tar "$SRC_REF" | tar -x -C "$work"

say "脱敏：剔除内部文档与密钥"
for p in "${STRIP_PATHS[@]}"; do rm -rf "${work:?}/$p"; done
for b in "${STRIP_BASENAMES[@]}"; do find "$work" -depth -name "$b" -exec rm -rf {} + 2>/dev/null || true; done
find "$work" -depth -type d -name superpowers -exec rm -rf {} + 2>/dev/null || true
if [ -d "$work/docs" ]; then
  for g in "${STRIP_DOC_GLOBS[@]}"; do find "$work/docs" -maxdepth 1 -type f -name "$g" -delete 2>/dev/null || true; done
fi

# ── 2) 安全闸 ──────────────────────────────────────────────────────────
say "安全扫描"
if find "$work" -type f \( -name ".env" -o -name ".env.*" \) ! -name "*.example" | grep -q .; then
  find "$work" -type f \( -name ".env" -o -name ".env.*" \) ! -name "*.example"
  die "检测到非示例 .env 文件，已中止。请加入 STRIP 列表后重试。"
fi
if grep -rIlE -- "-----BEGIN (RSA|OPENSSH|EC|PGP|DSA) PRIVATE KEY-----" "$work" >/dev/null 2>&1; then
  grep -rIlE -- "-----BEGIN .* PRIVATE KEY-----" "$work" | head
  die "检测到私钥，已中止。"
fi
ok "脱敏完成：$(find "$work" -type f | wc -l | tr -d ' ') 个文件"

commit_as() { git -C "$pub" -c user.name="$PUB_NAME" -c user.email="$PUB_EMAIL" -c commit.gpgsign=false \
    commit -q --author="$PUB_NAME <$PUB_EMAIL>" -m "$COMMIT_MSG"; }

# 远端是否已存在目标分支（决定 append 能否真正"接着写"）。
remote_has_branch() { git ls-remote --exit-code --heads "$GH_REMOTE_URL" "$GH_BRANCH" >/dev/null 2>&1; }

if [ "$MODE" = "snapshot" ]; then
  # ── snapshot：全新孤儿仓库 + 强推覆盖 ────────────────────────────────
  say "MODE=snapshot：构建全新孤儿快照仓库"
  cp -R "$work"/. "$pub"/
  git -C "$pub" init -q -b "$GH_BRANCH"
  git -C "$pub" add -A
  commit_as
  assert_clean "$pub"
  ok "快照提交：$(git -C "$pub" log -1 --format='%h  %an <%ae>  %s')"
  if [ "$DRY_RUN" = "1" ]; then
    printf '\n\033[33mDRY_RUN=1 → 未推送（snapshot）。\033[0m 快照目录：%s\n' "$pub"; exit 0
  fi
  say "强推快照到 ${GH_REMOTE_URL} (${GH_BRANCH})"
  git -C "$pub" remote add github "$GH_REMOTE_URL"
  git -C "$pub" push --force github "$GH_BRANCH"
  ok "已发布（snapshot/强推覆盖）：$GH_REMOTE_URL ($GH_BRANCH)"
  exit 0
fi

# ── append：在现有公开历史上追加一个脱敏 commit（不 force）────────────
if remote_has_branch; then
  say "MODE=append：拉取现有公开分支 ${GH_BRANCH}"
  git clone -q --depth 1 --branch "$GH_BRANCH" "$GH_REMOTE_URL" "$pub"
  base_existing=1
else
  say "MODE=append：远端无 ${GH_BRANCH} 分支，将创建首个 commit"
  git -C "$pub" init -q -b "$GH_BRANCH" 2>/dev/null || { git init -q -b "$GH_BRANCH" "$pub"; }
  git -C "$pub" remote add origin "$GH_REMOTE_URL"
  base_existing=0
fi

# 用最新脱敏树**替换**公开仓库工作树（先清空再覆盖，确保删除也被记录；保留 .git）。
say "用最新脱敏快照替换工作树"
find "$pub" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$work"/. "$pub"/
git -C "$pub" add -A
assert_clean "$pub"

if git -C "$pub" diff --cached --quiet; then
  ok "公开内容无变化，跳过提交与推送。"
  exit 0
fi

git -C "$pub" status --short | head -20
say "暂存变更：$(git -C "$pub" diff --cached --numstat | wc -l | tr -d ' ') 个文件"

if [ "$DRY_RUN" = "1" ]; then
  printf '\n\033[33mDRY_RUN=1 → 未提交/推送（append）。\033[0m 预演仓库：%s\n' "$pub"
  echo "核查命令：git -C $pub diff --cached --stat | less"
  exit 0
fi

commit_as
ok "追加提交：$(git -C "$pub" log -1 --format='%h  %an <%ae>  %s')"
say "推送到 ${GH_REMOTE_URL} (${GH_BRANCH})（不 force）"
if [ "$base_existing" = "1" ]; then
  git -C "$pub" push origin "$GH_BRANCH"
else
  git -C "$pub" push -u origin "$GH_BRANCH"
fi
ok "已发布（append/增量历史）：$GH_REMOTE_URL ($GH_BRANCH)"
