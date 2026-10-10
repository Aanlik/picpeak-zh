# PicPeak 简体中文摄影工作流

这是一个由 Aanlik 自行维护的 PicPeak 摄影项目版本，面向 NAS / Docker 部署，提供简体中文客户选片与摄影师后台，并集成 PixCake Bridge 的精修交付流程。

## 项目范围

- 客户通过分享链接浏览照片、批量选择精修照片、评论和提交返修或追加需求。
- 摄影师在后台查看项目进度、客户需求、同步状态和精修版本。
- 支持关联 NAS 中的现有照片目录；Bridge 负责选片同步、RAW 匹配和精修成片交付。
- 可继续使用 Photoshop、Lightroom、像素蛋糕等外部修图软件；修图软件只需按项目约定读取和导出文件。

日常 NAS 安装、目录映射、初始化、更新和备份步骤见 [PixCake Bridge 一体化部署说明](https://github.com/Aanlik/pixcake-bridge/blob/main/README.md)。PicPeak 与 Bridge 的源码分仓维护；一体化部署镜像由 Bridge 项目构建。需要独立运行 AIO 时见[单容器部署说明](docs/single-container.md)。

## 自主管理策略

本仓库**不再常规合并 PicPeak 官方更新**，也不配置上游更新检查或自动同步。功能修复、依赖升级、安全修复和镜像发布均由本项目自行评估、测试和维护。部署时使用本项目发布的固定版本镜像，不使用官方 PicPeak 的 `main`、`stable` 或 `latest` 镜像替代。

当前源码沿用 PicPeak `v3.134.1` stable 的代码基线，并在其上维护本项目改动。此信息仅用于追溯代码来源，不代表会继续跟随上游。来源与许可证说明见 [代码来源记录](docs/source-provenance.md)。

必要时可以单独评估并移植某项安全修复，但必须作为本项目自己的变更审查、测试和发布；不合并上游分支或整批官方更新。

## 本地开发与验证

前端构建与测试：

```bash
cd frontend
npm ci --legacy-peer-deps
npm run build:check
npm test
```

中文 locale 检查：

```bash
node scripts/check-zh-cn.mjs
node scripts/check-locale-usage.mjs
node --test scripts/check-zh-cn.test.mjs
```

构建独立 PicPeak AIO 镜像：

```bash
docker build -f Dockerfile.aio --build-arg VITE_DEFAULT_LANGUAGE=zh-CN -t picpeak-zh:<版本> .
```

Bridge 集成验收及 NAS 部署以 Bridge 仓库中的说明为准。发布前应备份 PicPeak 数据、Bridge SQLite 数据和项目照片目录，并在目标 NAS 上验证原分享链接、照片反馈、返修版本和 RAW 文件校验值。

## 许可证

本项目保留 PicPeak 上游的 MIT 许可证及来源声明，详见 [LICENSE](LICENSE)。本仓库不代表 PicPeak 官方项目或其维护者。
