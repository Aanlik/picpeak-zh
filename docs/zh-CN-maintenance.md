# 中文 Fork 的上游同步与发布

## 维护边界

官方来源为 <https://github.com/PicPeak/picpeak> 的 `stable` 分支。当前基线是
`v3.134.1` / `5fc54d9a5e17a7f054c926922a6f820f3c98eda2`，记录在
`.picpeak-upstream-sha`。不要从 `main` 的测试版本直接发布生产镜像。

中文差异仅包括 `zh-CN.json`、locale 文件名识别、语言选择器、部署默认语言、
两份 Dockerfile 的前端构建参数、中文日期与字体适配、中文检查/上游提醒工作流和本维护文档。
另有一个独立的小型兼容补丁：反馈姓名验证允许 Unicode 字母、组合符、数字和
有限姓名标点，解决官方拒绝中文客户姓名的问题。该补丁有 11 项测试，适合单独
向上游贡献；上游接受后应移除 Fork 对应补丁。Bridge 代码全部位于独立仓库。

## 分支与远程

```bash
git remote add upstream https://github.com/PicPeak/picpeak.git # 已配置时跳过
git remote -v
git switch zh-stable
git fetch upstream stable --tags
git switch -c sync/stable-新版本
bash scripts/sync-upstream-zh.sh --merge
```

`origin` 指向自己的 Fork，`upstream` 始终指向官方。保留官方 Git 历史；
禁止 squash 整个上游历史、直接覆盖官方文件、长期从旧版本复制核心后端。
`--merge` 要求工作区干净，遇到冲突会停止，不自动猜测解决方案。

## 解决冲突和补翻译

1. 语言包以新 `en.json` 为准，保留新功能对应键与完整复数形式。
2. 执行 `node scripts/check-zh-cn.mjs`，按缺失键报告补译；检查插值变量
   `{{count}}`、格式参数和模板变量 `{INVOICE}` 等，不把它们翻译成中文。
3. 检查客户侧 green 的中文仍为精修语义；底层 color_label 值仍为 `green`。
4. 若上游已修复带连字符 locale、默认语言或 Unicode 姓名，优先采用上游实现，
   删除本地冗余补丁，不同时维持两份逻辑。
5. 检查 Public API 是否保留 `source_filename`、`mark_source=client`、分页、
   `replaces_photo_id`、替换响应 `photo.id`。若变化，修改独立 Bridge 适配并测试，
   不把 Bridge 同步逻辑加入 PicPeak。

自动提醒工作流每周检查官方 stable 新 SHA，并用最新上游英文语言包运行中文
差异检查。每个 SHA 只创建一次跟进 Issue。提醒不是自动升级；它不会绕过测试
把新代码部署到 NAS。Fork 的默认分支必须是 `zh-stable`，并启用 GitHub Actions
和 Issues，否则定时任务不会运行。

## CI 和本地验证

```bash
node scripts/check-zh-cn.mjs
node --test scripts/check-zh-cn.test.mjs
cd frontend
npm ci --legacy-peer-deps
# 当前上游遗漏 testing-library 的 DOM peer，仅用于测试环境：
npm install --no-save --package-lock=false --legacy-peer-deps @testing-library/dom@10.4.1
npm run build:check
npm test
cd ..
docker build -f Dockerfile.aio --build-arg VITE_DEFAULT_LANGUAGE=zh-CN \
  -t picpeak-zh:新版本-zh.1 .
docker run --rm --entrypoint node picpeak-zh:新版本-zh.1 scripts/test-zh-unicode.cjs
```

在独立 Bridge 仓库执行 `uv sync --extra test --python 3.12`、`uv run pytest -q`，
再运行 `scripts/integration.py` 对真实新 PicPeak 容器验收。不能只凭 mock 通过发布。
集成测试生成合成 RAW 数据用于验证文件不被改变，不替代真实相机/像素蛋糕验收。

## 构建、发布和 NAS 升级

1. 将同步分支提交 PR 到 `zh-stable`；CI 通过后再更新生产分支。
2. 版本采用 `官方版本-zh.修订号`，例如 `3.134.1-zh.1`。同一 tag 不覆盖重发。
3. 为 AMD64/ARM64 构建镜像；发布前分别验收目标平台，不把本地 ARM64 测试
   误认为 AMD64 已通过。
4. 把实际镜像 digest 写入生产 `.env`，禁止 `latest/stable/main` 可变标签。
5. 停止 Bridge，对 PicPeak `/data`、Bridge SQLite（含 WAL）、摄影项目做一致性备份。
6. 先升级 PicPeak，确认迁移和健康检查，再升级 Bridge，人工同步一轮。
7. 验证原分享链接、中文选片、追加、取消、返修与原 RAW 的 SHA256。
8. 如果数据库迁移不兼容回退，必须恢复升级前备份；不能仅切换旧镜像。

发布示例（需要 GHCR packages:write 登录权限）：

```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f Dockerfile.aio --build-arg VITE_DEFAULT_LANGUAGE=zh-CN \
  -t ghcr.io/aanlik/picpeak-zh:3.134.1-zh.1 --push .
```

## 翻译质量

6,331 个英文键和 196 个复数键已完整覆盖；插值和模板占位符自动检查。
初始长尾翻译由本地 Argos Translate 模型生成，客户核心选片、登录、反馈、下载及
通用后台控件已经逐项修订。财务、合同、遥测等长尾专业文字仍需后续人工语言审校。
键齐全和构建成功不代表每一条专业文案都已达到人工翻译质量。

前端初始化默认语言是**构建参数** `VITE_DEFAULT_LANGUAGE`，不是运行时变量。
Compose 的 `PICPEAK_DEFAULT_LANGUAGE` 会传入该构建参数；改它后必须重建镜像。
前端初始化时访客已保存的语言优先；其后使用部署默认值，再参考浏览器语言。
**画廊登录页会采用后台“设置 → 常规 → 默认语言”**，因此完成初始化后还必须
在该处选择“简体中文”。它通过官方 `general_default_language` 设置保存，无需后端
默认值魔改。仅设置 Docker 构建参数不能替代该后台设置。

## 中国摄影工作流：本地账号和链接分享

新增可切换的无邮件部署配置，详见 [本地账号与链接分享模式](zh-CN-no-email.md)。同步上游时需额外检查登录/初始化、管理员账号与发布分享分支；保留邮件翻译 key 与数据库兼容字段，禁止通过去掉验证来开启邮件保护的合同访问。
