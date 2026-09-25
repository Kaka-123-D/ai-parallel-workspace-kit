#!/usr/bin/env bash
# Một task → một worktree + một nhánh + một cổng cho một repo. Chạy lại bao nhiêu lần cũng an toàn.
#   bash .external-assets/worktree/ensure-worktree.sh <TASK> [repo]
# <TASK>: ticket key (ABC-12 → cổng 3012) hoặc slug (them-loc → cổng rảnh kế tiếp từ 3011).
# [repo]: tên thư mục dưới repos/ (FE, BE, CMS, ...). Bỏ trống nếu repos/ chỉ có một repo.
# In ra:  WORKTREE=<path>  PORT=<n>
set -euo pipefail
KEY="${1:-}"; WANT="${2:-}"
[[ "$KEY" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$ ]] || { echo "Tên task chỉ gồm chữ, số, - _ . ; nhận: '$KEY'" >&2; exit 2; }
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; cd "$ROOT"

# 1. repo
REPOS=( $(find repos -mindepth 1 -maxdepth 1 \( -type d -o -type l \) 2>/dev/null | sort) )
if [ -n "$WANT" ]; then REPO="$ROOT/repos/$WANT"; [ -d "$REPO" ] || { echo "Không có repos/$WANT" >&2; exit 2; }
elif [ "${#REPOS[@]}" -eq 1 ]; then REPO="$ROOT/${REPOS[0]}"
else echo "repos/ có ${#REPOS[@]} repo — truyền tên repo làm tham số 2: $(printf '%s ' "${REPOS[@]##*/}")" >&2; exit 2; fi
NAME="$(basename "$REPO")"; WT="$ROOT/.worktrees/$KEY/$NAME"; BRANCH="feat/$KEY"
BASE="${WORKTREE_BASE:-main}"   # nhánh gốc; đổi bằng env nếu dự án dùng develop/prd

# 2. worktree + nhánh
if [ ! -d "$WT" ]; then
  mkdir -p "$(dirname "$WT")"
  if git -C "$REPO" show-ref --verify --quiet "refs/heads/$BRANCH"; then git -C "$REPO" worktree add -q "$WT" "$BRANCH"
  else git -C "$REPO" worktree add -q -b "$BRANCH" "$WT" "$BASE"; fi
  echo "✓ tạo worktree $WT trên nhánh $BRANCH (từ $BASE)" >&2
else echo "· worktree đã có: $WT" >&2; fi

# 3. node_modules: symlink khi lockfile giống
if [ -d "$REPO/node_modules" ] && [ ! -e "$WT/node_modules" ]; then
  if cmp -s "$REPO/package-lock.json" "$WT/package-lock.json" 2>/dev/null || cmp -s "$REPO/package.json" "$WT/package.json"; then
    ln -s "$REPO/node_modules" "$WT/node_modules"; echo "✓ symlink node_modules" >&2
  else echo "! lockfile khác canonical — cần cài dependency riêng trong worktree" >&2; fi
fi

# 4. env: copy template nếu có, không symlink
for f in .env.local .env; do
  [ -f "$ROOT/.workspace/env/$NAME/$f" ] && [ ! -f "$WT/$f" ] && cp "$ROOT/.workspace/env/$NAME/$f" "$WT/$f" && echo "✓ copy env $f" >&2
done

# 5. cổng — có khoá để hai session không tranh nhau
mkdir -p "$ROOT/.workspace"; LOCK="$ROOT/.workspace/.ports.lock"; n=0
until mkdir "$LOCK" 2>/dev/null; do n=$((n+1)); [ $n -gt 100 ] && { echo "Không lấy được khoá" >&2; exit 3; }; sleep 0.1; done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT
REG="$ROOT/.workspace/ports.json"; [ -f "$REG" ] || echo '{}' > "$REG"
if [ -f "$WT/.port" ]; then PORT="$(tr -d '[:space:]' < "$WT/.port")"
else
  if [[ "$KEY" =~ -([0-9]+)$ ]]; then PORT=$((3000 + ${BASH_REMATCH[1]})); else PORT=3011; fi
  while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || grep -q "\"port\": $PORT\b" "$REG"; do PORT=$((PORT + 1)); done
  printf '%s\n' "$PORT" > "$WT/.port"
fi
node -e "const fs=require('fs');const f='$REG';const j=JSON.parse(fs.readFileSync(f,'utf8'));j['$KEY/$NAME']={port:$PORT,worktree:'.worktrees/$KEY/$NAME',branch:'$BRANCH'};fs.writeFileSync(f,JSON.stringify(j,null,2)+'\n')"
echo "✓ cổng $PORT" >&2
echo "WORKTREE=$WT"; echo "PORT=$PORT"
