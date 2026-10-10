# 单容器运行 PicPeak AIO

本文从**本项目源码**构建 PicPeak AIO。此镜像不包含 PixCake Bridge；摄影项目的完整 NAS 流程请使用 [Bridge 一体化部署说明](https://github.com/Aanlik/pixcake-bridge/blob/main/README.md)。不要用 PicPeak 官方 `main`、`stable` 或 `latest` 镜像代替本项目镜像。

在源码仓库根目录构建一个固定版本：

```bash
docker build -f Dockerfile.aio \
  --build-arg VITE_DEFAULT_LANGUAGE=zh-CN \
  --build-arg VITE_NO_EMAIL_MODE=true \
  -t picpeak-zh:3.134.1-zh.20 .
```

运行并持久保存数据库、设置密钥和媒体：

```bash
docker run -d \
  --name picpeak-zh \
  --restart unless-stopped \
  -p 3000:3000 \
  -e NO_EMAIL_MODE=true \
  -v picpeak-zh-data:/data \
  picpeak-zh:3.134.1-zh.20
```

首次启动后访问 `http://NAS地址:3000`。若初始化页要求令牌，可在容器中读取：

```bash
docker exec picpeak-zh cat /data/db/SETUP_TOKEN
```

如需让 PicPeak 只读访问 NAS 中现有的照片目录，添加只读挂载并设置 `EXTERNAL_MEDIA_ROOT`，例如：

```bash
-e EXTERNAL_MEDIA_ROOT=/external-media \
-v /NAS/共享目录/Camera:/external-media/Camera:ro
```

目录选择入口只能浏览已挂载到容器中的路径。PicPeak AIO 单容器适合独立选片和照片交付；RAW 到精修成片的自动同步、返修版本及 Bridge 状态需要使用一体化 Bridge 镜像。

升级时先备份整个 `/data` 卷，再切换到本项目新构建的固定版本。不要直接拉取官方镜像，也不要假设数据库迁移可通过换回旧镜像自动撤销；必要时恢复升级前备份。
