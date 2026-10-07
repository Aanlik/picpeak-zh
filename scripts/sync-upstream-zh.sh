#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream https://github.com/PicPeak/picpeak.git
fi
git fetch upstream stable --tags
current=$(cat .picpeak-upstream-sha)
incoming=$(git rev-parse upstream/stable)
case "${1:---check}" in
  --check)
    if [ "$current" = "$incoming" ]; then
      echo "已跟随 upstream stable: $current"
    else
      echo "发现 upstream stable 更新: $current -> $incoming"
      git log --oneline "$current..$incoming" --max-count=20
      exit 2
    fi
    ;;
  --merge)
    if [ -n "$(git status --porcelain)" ]; then
      echo "请先提交当前修改，再合并上游。" >&2
      exit 1
    fi
    git merge --no-ff upstream/stable
    echo "$incoming" > .picpeak-upstream-sha
    echo "上游已合并。请检查中文新增键、CI、真实容器测试，再提交基线文件。"
    ;;
  *) echo "用法: $0 --check | --merge" >&2; exit 1 ;;
esac
