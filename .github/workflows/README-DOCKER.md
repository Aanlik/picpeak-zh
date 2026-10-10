# 统一镜像 CI

`unified.yml` 是当前发布入口。dev/main 和 PR 自动检查前端、后台、中文翻译和 Bridge，通过后构建根目录 Dockerfile，并执行容器启动/重启测试与 100 张照片真实 E2E。

仅 main 上的手动 workflow_dispatch，且 publish 勾选为 true 时，才在验证完成后推送 `ghcr.io/<仓库所有者>/picpeak-pixcake:<固定版本>`。不推送 latest，不自动合并上游，也不分别发布前后端和 Bridge。

发布前同步更新 Dockerfile、构建脚本、Compose、.env.example、README 和 workflow 中的版本。保留测试数据库隔离：E2E 只操作 pixcake- 开头的临时容器，不复用生产卷。
