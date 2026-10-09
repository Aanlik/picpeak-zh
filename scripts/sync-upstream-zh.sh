#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

remote="${PICPEAK_UPSTREAM_REMOTE:-upstream}"
branch="${PICPEAK_UPSTREAM_BRANCH:-stable}"
filter_script="scripts/upstream-filter.mjs"
baseline_file=".picpeak-upstream-sha"
mode="${1:---plan}"
strategy="${2:-}"

case "$mode" in
  --plan|--check|--merge) ;;
  *)
    echo "用法：$0 --plan|--check|--merge --all|--exclude-retired" >&2
    exit 2
    ;;
esac

case "$strategy" in
  --all)
    strategy_label="完整同步官方代码（包含本 Fork 已删除的模块）"
    ;;
  --exclude-retired)
    strategy_label="剔除本 Fork 已删除的模块"
    ;;
  *)
    echo "必须明确选择同步方式：--all 或 --exclude-retired。" >&2
    echo "用法：$0 --plan|--check|--merge --all|--exclude-retired" >&2
    exit 2
    ;;
esac

if ! git remote get-url "$remote" >/dev/null 2>&1; then
  git remote add "$remote" https://github.com/PicPeak/picpeak.git
fi
if [[ "${PICPEAK_SKIP_FETCH:-false}" == "true" ]]; then
  if ! git show-ref --verify --quiet "refs/remotes/$remote/$branch"; then
    echo "本地没有缓存的 $remote/${branch}；去掉 PICPEAK_SKIP_FETCH 后重新运行以获取官方更新。" >&2
    exit 1
  fi
  echo "提示：使用本地缓存的 $remote/${branch}，仅用于离线预览，不代表已检查远端最新版本。" >&2
else
  git fetch "$remote" "$branch" --tags
fi

baseline="$(tr -d '\r\n' < "$baseline_file")"
incoming="$(git rev-parse "$remote/$branch")"
if ! git cat-file -e "$baseline^{commit}" 2>/dev/null; then
  echo "基线 $baseline 不在本地 Git 历史中；请先补齐官方历史，不能安全同步。" >&2
  exit 1
fi

if [[ "$baseline" == "$incoming" ]]; then
  echo "已跟随 upstream ${branch}：$baseline"
  exit 0
fi

classify_args=(--classify "$baseline" "$incoming")
if [[ "$strategy" == "--all" ]]; then
  classify_args+=(--all)
fi
plan_json="$(node "$filter_script" "${classify_args[@]}")"
show_plan() {
  PLAN_JSON="$plan_json" STRATEGY_LABEL="$strategy_label" node --input-type=module -e '
    const p = JSON.parse(process.env.PLAN_JSON);
    console.log(`上游提交：${p.base.slice(0, 12)} → ${p.incoming.slice(0, 12)}`);
    console.log(`所选方式：${process.env.STRATEGY_LABEL}`);
    console.log(`本次变更：保留 ${p.included.length} 个路径；按 Fork 策略过滤 ${p.excluded.length} 个路径；共享文件需复核 ${p.overlapping.length} 个路径。`);
    if (p.excluded.length) {
      console.log("自动过滤的已移除模块：");
      for (const path of p.excluded) console.log(`  - ${path}`);
    }
    if (p.included.length) {
      console.log("本次保留并纳入同步的上游路径：");
      for (const path of p.included) console.log(`  + ${path}`);
    }
    if (p.overlapping.length) {
      console.log("Fork 与上游都改动的共享文件（这些不会被自动覆盖）：");
      for (const path of p.overlapping) console.log(`  ! ${path}`);
    }
  '
  echo "上游提交摘要："
  git log --oneline "$baseline..$incoming" --max-count=20
}

case "$mode" in
  --check|--plan)
    show_plan
    if [[ "$mode" == "--check" ]]; then
      echo "需要人工审阅后运行 --merge。"
      exit 2
    fi
    ;;
  --merge)
    if [[ -n "$(git status --porcelain)" ]]; then
      echo "请先提交或妥善保存当前改动；同步只在干净工作区运行。" >&2
      exit 1
    fi
    if git rev-parse -q --verify MERGE_HEAD >/dev/null; then
      echo "当前已有未完成的合并，请先完成或中止它。" >&2
      exit 1
    fi
    if ! git merge-base --is-ancestor "$baseline" HEAD; then
      echo "当前分支不包含记录的上游基线 $baseline；请先核对分支和基线。" >&2
      exit 1
    fi

    show_plan
    filter_args=(--filter "$incoming" "$baseline")
    if [[ "$strategy" == "--all" ]]; then
      filter_args+=(--all)
    fi
    filtered_json="$(node "$filter_script" "${filter_args[@]}")"
    filtered_commit="$(FILTER_JSON="$filtered_json" node --input-type=module -e 'console.log(JSON.parse(process.env.FILTER_JSON).filteredCommit)')"
    excluded_count="$(FILTER_JSON="$filtered_json" node --input-type=module -e 'console.log(JSON.parse(process.env.FILTER_JSON).excluded.length)')"

    set +e
    git merge --no-ff --no-commit "$filtered_commit"
    merge_status=$?
    set -e

    conflicts=()
    non_excluded_conflicts=()
    while IFS= read -r -d '' path; do
      conflicts+=("$path")
      if [[ "$strategy" == "--exclude-retired" ]] && node "$filter_script" --is-excluded "$path"; then
        git rm -r -f --ignore-unmatch -- "$path" >/dev/null
      else
        non_excluded_conflicts+=("$path")
      fi
    done < <(git diff --name-only --diff-filter=U -z)

    if ((${#non_excluded_conflicts[@]})); then
      git merge --abort
      echo "发现共享文件冲突，已自动中止合并，工作区已恢复。请先逐项比对：" >&2
      printf '  - %s\n' "${non_excluded_conflicts[@]}" >&2
      echo "脚本只会自动剔除登记过的模块路径，不会用整份 Fork 文件覆盖官方改动。" >&2
      exit 2
    fi
    if ((merge_status != 0)) && ((${#conflicts[@]} == 0)); then
      git merge --abort || true
      echo "Git 合并失败（没有可自动处理的模块路径冲突），请检查上方错误。" >&2
      exit "$merge_status"
    fi

    printf '%s\n' "$incoming" > "$baseline_file"
    git add "$baseline_file"
    echo "已准备合并；自动从上游树中过滤 $excluded_count 个移除模块路径。"
    echo "现在检查 staged diff、补齐中文、运行 CI/真实容器测试；全部通过后再提交合并。"
    ;;
  *)
    echo "用法：$0 --plan|--check|--merge --all|--exclude-retired" >&2
    exit 2
    ;;
esac
