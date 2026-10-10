# PicPeak 选片与精修交付

面向摄影师的中文照片选片系统：客户在线选片、评分、评论和提出返修，摄影师在同一个后台管理选片、RAW、精修版本与交付。PicPeak 与 PixCake Bridge 已合并为一个仓库、一个 Docker 镜像，今后一起测试和发布。

支持飞牛 fnOS、群晖、威联通及其他支持 Docker 的 NAS / Linux 主机。像素蛋糕、Photoshop、Lightroom 等后期软件通过文件夹配合，无需软件 API 或插件；需要将导出目录与文件名按下面约定设置，并非完全无需配置。

## 工作流程

1. 将 RAW / JPG 放在项目目录，在后台引用 NAS 照片目录，原片只读。
2. 把项目分享链接发给客户；客户填写昵称即可参与选片、评论和返修。
3. 在后台「选片与精修进度」绑定项目，选择工作阶段；Bridge 同步选片并生成待精修 RAW。
4. 后期软件读取 `03_SELECTED_RAW`；导出 JPG 到后台给出的 `04_FINAL/V1`。
5. 文件稳定后自动替换预览，保留照片 ID、评论、评分、排序与分享链接。
6. 返修时使用后台给出的 `V2` / `V3` 等版本目录，保持原 stem，例如 `DSC00125.ARW` → `DSC00125.JPG`。

```text
Camera/拍摄项目/
├── RAW、JPG 或已有子目录         ← 只读引用，保留原有组织方式
└── PixCakeDelivery/            ← 仅这一子目录单独挂载可写
    ├── 03_SELECTED_RAW/
    ├── 04_FINAL/
    │   ├── V1/
    │   └── V2/
    └── 05_HISTORY/
```

同一个项目的交付目录中不再嵌套项目名。不同目录下同 stem 的照片会报告冲突，需明确对应关系后处理，系统不会猜测或覆盖原片。

阶段包含待选片、精修中、已交付、已归档，支持回退和归档恢复。精修开始前取消可移除 RAW 副本；开始后取消保留正在处理的副本。已交付照片撤回时，客户明确选择保留或删除成片：保留则保留精修预览；删除则恢复 Proof，并清理该照片的交付与历史文件。两种方式均解除待精修 RAW 关联，不删除原 RAW。

## 镜像与端口

当前固定标签：`picpeak-pixcake:3.134.1-zh.22-bridge.0.1.10`。禁止使用 `latest` 作为生产更新来源。

统一镜像内有两个独立进程：PicPeak 提供网页；Bridge 只监听容器内 `127.0.0.1:8080`，由 PicPeak 后台访问，不发布 Bridge 端口。PicPeak 与 Bridge 保持各自的数据卷和数据库，以便迁移、备份与故障隔离。合并仓库和镜像不代表数据库已合并。

## NAS 全新安装

1. 下载本仓库，复制 `.env.example` 为 `.env`；填写随机管理密码、NAS 局域网 IP、实际目录与 UID/GID。不要提交 `.env`。
2. 预先创建 `NAS_DELIVERY_ROOT` 和项目的 `PixCakeDelivery` 目录。只把交付目录挂载可写；`NAS_CAMERA_ROOT` 始终只读。Compose 不会自动创建缺失的 NAS 路径。
3. 首次设置 `BRIDGE_ENABLED=false`，构建后启动：

```sh
./scripts/build-unified.sh
docker compose -f compose.yaml -f compose.nas-camera.yaml up -d
```

4. 打开 `http://NAS局域网IP:3000` 完成初始化并创建管理员用户名。初始化令牌存放于容器数据卷，需要时在 NAS 的容器终端读取 `/data/db/SETUP_TOKEN`，不要连续猜测令牌。
5. 在 PicPeak 创建专用 Public API Token，仅授权 `read`、`write`；填入 `.env` 的 `PICPEAK_TOKEN`，设置 `BRIDGE_ENABLED=true`。
6. 创建项目并引用 Camera 中的照片目录。确认项目 ID，将 `.env` 的 `PROJECT_DELIVERY_MOUNTS` 中示例 ID `1` 换成实际 ID；`host` 填实际交付路径，`container` 对应 Compose 的 `/delivery-project`。
7. 再次执行上述启动命令，进入项目「选片与精修进度」绑定并同步，核对 NAS 的待精修目录。

新增项目时添加一条专属可写挂载和对应的映射记录，重建容器后绑定。系统可以自动建立进度子目录，但无法绕过 Docker 为新项目增加宿主机挂载，需要修改部署配置。`compose.nas-camera.yaml` 用于按 Camera 所有者 UID 运行 PicPeak；其他 NAS 按实际权限选择使用，不修改原片权限。

后期软件是否自动发现新增 RAW 取决于软件；无法自动发现时刷新或重新导入目录。导出文件名保留原 stem，不使用 NAS 自动添加的序号作为返修版本标记。默认稳定等待 10 秒，最大单文件 100 MiB，历史保留最近 3 个交付版本，均可配置。

跨设备访问使用 PicPeak 设置中的客户访问地址。局域网以外需要独立可匿名访问的 HTTPS 入口，FN Connect 未登录客户访问尚未完成现场验证，不能视为可用方案。穿透或 DDNS 只对外提供 PicPeak 网页，Bridge 无需公网。

## 下载与备份说明

手机多选下载会显示逐张下载列表，每个文件单独点击保存，保留原文件名，不打包 ZIP。Safari 由浏览器处理保存确认；微信内无法保存时，请从菜单选择在浏览器打开。列表里的“已发起下载”表示已请求下载，不能替代设备实际保存结果。桌面仍可直接发起多个文件下载。

后台生成的新完整备份会在清单内保存 Bridge 项目配置、精修阶段、版本、交付哈希、撤回任务和异常状态。备份过程中暂停 Bridge 同步，并持续续期；Bridge 不可用或状态清单写入失败时，不把备份标记为完整。完整或数据库恢复会同时恢复这份精修状态，且拒绝越界或重叠的目录。旧备份不包含这份状态，不能凭旧备份恢复 Bridge 进度。

NAS 原片、外部样片及 `PixCakeDelivery` 文件仍需由 NAS 单独备份；状态清单不复制外部照片、原片或历史成片，也不包含运行环境的 API 令牌。建议同时保留 `/data`、`/bridge-data` 和挂载配置的卷备份。

标准分离目录会从 `01_RAW` 的相邻 `02_PROOF` 读取撤回所需的原样片；两种格式的原目录都保持只读。文件监听器不会因文件被移除而自动删除照片记录，项目和照片的删除通过后台操作完成。

## 已有安装升级

升级前停止旧容器并备份两个卷：PicPeak 的 `/data`、Bridge 的 `/bridge-data`，同时备份 `.env`、挂载配置与交付目录。**保留原数据卷名称**，不同 Compose 项目名会产生新卷，误接空卷会表现为重新初始化。

```sh
docker compose -f compose.yaml -f compose.nas-camera.yaml config
./scripts/build-unified.sh
docker compose -f compose.yaml -f compose.nas-camera.yaml up -d
```

核对配置中的真实宿主机路径和卷后才替换容器，不运行 `down -v`。旧独立部署需要显式将既有卷挂到新服务；旧项目仍使用 `/delivery` 时保留该挂载及映射。新版示例变量是 `NAS_PROJECT_DELIVERY_ROOT`，替代原来示例中的 `NAS_PROJECT_5_DELIVERY_ROOT`。API 令牌、管理员账号和照片数据库无需重建。

旧布局目录迁移和数据库路径重映射支持中断恢复；遇到新旧路径同时存在数据会停止，避免覆盖。回退时恢复升级前的一致性备份，不能仅换回旧镜像。更多说明见 [合并与迁移](docs/monorepo-migration.md)。

不能在 NAS 构建时，在另一台 Docker 主机运行构建并导出，再使用 NAS 的镜像导入功能：

```sh
docker save picpeak-pixcake:3.134.1-zh.22-bridge.0.1.10 -o picpeak-pixcake.tar
# 导入完成后，使用相同固定标签与原数据卷重建容器
```

## 开发与验证

`frontend/` 为客户和摄影师界面，`backend/` 为 PicPeak 服务，`bridge/` 为文件同步服务；根目录 `Dockerfile` 是发布构建入口。保留内部模块边界，不依赖官方仓库自动同步。

```sh
npm ci --prefix frontend --legacy-peer-deps
npm ci --prefix backend
uv sync --directory bridge --frozen --python 3.12 --extra test
node scripts/check-zh-cn.mjs
node scripts/check-locale-usage.mjs
npm --prefix frontend test
npm --prefix frontend run build:check
SKIP_S3_TESTS=true npm --prefix backend test -- --runInBand
uv run --directory bridge pytest -q
./scripts/build-unified.sh
STACK_IMAGE=picpeak-pixcake:3.134.1-zh.22-bridge.0.1.10 bridge/docker/integrated/smoke.sh
```

S3 用例需要另行提供对象存储测试环境，默认本地卷部署不依赖 S3。真实容器 E2E 使用 `bridge/scripts/integration.py`，必须是专用、全新、名称以 `pixcake-` 开头的测试容器；不能对生产实例运行。统一 CI 执行前后端、中文键/插值/复数检查、Bridge 测试、Python 依赖扫描、容器重启、100 张照片 E2E 和手机浏览器下载测试，全部通过后才允许 main 手动发布固定标签镜像。

## 维护与限制

- 撤回和归档恢复使用持久化任务；服务断开后会继续处理，撤回未完成时禁止重新选择，避免交付与选择状态相互覆盖。
- 上传响应丢失时先核对服务端文件标记，不自动重复上传。无法确认时保留任务并提示摄影师检查，核对后使用「重试失败任务」。
- RAW 根目录只读。hardlink 仅用于原 inode 已只读的条件，其次 reflink、最后 copy；不使用 symlink。后期软件可能改写文件时可设置 `RAW_MATERIALIZE_MODE=copy`。
- 同项目多客户的昵称、评论与选择保持原有身份机制。目录格式约定不等同于任意同名文件可自动识别。
- 本次合并已保留现有功能，不重新引入邮件、审核、报表、双重认证、Webhook 或自动更新模块。
- 旧 PicPeak 本地仓库存在缺失历史对象，本仓库从完整的当前提交源码以浅历史接续，Bridge 通过 subtree 导入；旧仓库未改动。更早历史需要恢复原仓库后查阅。

保留原代码的许可证与必要版权声明；删除产品界面中的推广入口不等于删除许可证义务。
