# Bridge 内部服务

本目录已合并进 PicPeak 仓库。部署、构建、版本升级和目录挂载以根目录 [README](../README.md)、[Dockerfile](../Dockerfile) 和 [compose.yaml](../compose.yaml) 为准。

Bridge 保留独立 Python 模块、SQLite 状态和测试，不单独对外开放端口。开发测试：

```sh
uv sync --directory bridge --extra test
uv run --directory bridge pytest -q
```

原来的双仓库构建流程已停止使用。原项目来源、许可证与迁移说明见 [合并说明](../docs/monorepo-migration.md)。
