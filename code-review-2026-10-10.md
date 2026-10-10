# 全量代码审查记录 — 2026-10-10

## 基准与范围

PicPeak：dev / c388c125；Bridge：0746de8。当前工作目录只有 Git 元数据，实际源码位于原工作区 outputs/picpeak-zh 与 outputs/pixcake-bridge。本次检查覆盖前后端路由和服务、摄影交付状态、NAS 文件操作、迁移、部署与 CI、语言资源及已退役模块残留。对 498 个后台源码/迁移文件执行本地 require 路径解析检查，无缺失引用。静态扫描和测试不能证明全部运行场景无缺陷。

## 已确认问题

### 1. [P1] 交付目录迁移没有同步迁移数据库文件路径

位置：pixcake-bridge/src/pixcake_bridge/config.py:103–110。

migrate_legacy_delivery_layout 将旧 event-ID-name 下的目录移到项目挂载根，并更新 projects.json，却没有更新 Photo.selected_path、Delivery.snapshot 等数据库路径。已在临时目录与 SQLite 中复现：迁移后真实 RAW 副本存在于新目录，数据库路径指向不存在的旧目录；下一次同步报“RAW 路径发生变化，请人工检查”。历史快照也会失联。

建议：保存并持久化路径映射，在 Engine 启动、使用照片状态之前完成数据库路径迁移；迁移应可重入并覆盖中途重启。

### 2. [P1] 删除精修撤回缺少持久化任务与未知结果恢复

位置：pixcake-bridge/src/pixcake_bridge/engine.py:288；PicPeak backend/src/routes/galleryRetouchWorkflow.js:126–137；photographyWorkflowBridge.js 的 5 秒超时。

恢复 Proof 的远端替换发生在本地状态提交之前，撤回没有类似正常交付的 UPLOADING/UNKNOWN 意图记录。已模拟远端成功、响应丢失：PicPeak original_filename 已恢复 Proof，Bridge delivery_hash 仍非空、current_version 仍为 1。PicPeak 收到失败后还会恢复 green 标记，导致界面显示已交付、实际却是 Proof。代理 5 秒超时也会让较慢但仍在执行的撤回被误判失败。

建议：为撤回创建持久化任务、操作标记和结果查询；恢复 Proof 与本地清理分阶段执行，失败可恢复。代理超时时返回可查询的处理中状态，不盲目补回选片标记。

### 3. [P2] 多项目挂载时返修目录使用默认挂载映射

位置：pixcake-bridge/src/pixcake_bridge/engine.py:102–106。

prepare_next_version_folder 使用全局 delivery_root/delivery_host_root，而不是 delivery_root_for(event_id)/delivery_host_root_for(event_id)。已复现：配置项目专用挂载后，需求返回容器内部路径，未返回 NAS 主机路径。后台照片列表使用项目映射，客户需求使用默认映射，二者不一致。

建议：统一使用项目级路径转换辅助函数，并验证两个项目挂载的 V2/V3 返回路径。

### 4. [P2] 自动生成 RAW 副本就被展示为“精修中”

位置：PicPeak backend/src/routes/galleryRetouchWorkflow.js:23；frontend/src/components/admin/PhotographyWorkflowCard.tsx:200 附近。

客户状态仅看 ready_for_editing。Bridge 在 SELECTING 阶段就会生成 selected_path，所以正常选片同步后状态即变成 editing；“已选片”筛选很快为空，摄影师尚未切换 EDITING，客户已看到精修中。后台照片表也采用同样规则。

建议：明确区分 RAW 已准备与精修已开始；状态计算传入项目阶段，保留追加选片和已交付照片自身状态。

### 5. [P2] 中文专项 CI 没有覆盖现行开发与发布分支

位置：PicPeak .github/workflows/zh-cn.yml:4。

push 仅覆盖 zh-stable、feat/zh-cn、hotfix/**、release/**，没有 dev 或 main。直接推送 dev/main 不会运行专项翻译一致性与中文构建验证；pull_request 无过滤会运行，但不能覆盖直接推送。

建议：将现行分支纳入触发范围，在发布镜像前强制通过相同验证。

### 6. [P2] FINAL 目录在每张照片循环内反复递归扫描

位置：pixcake-bridge/src/pixcake_bridge/engine.py:350–356。

首次交付逐张扫描整个 V1，再逐张扫描整个 FINAL；同阶段 50 张选片即产生 50 次相同 V1 索引与 50 次 FINAL 索引。1000 张目录下会出现数万级重复文件检查，NAS 磁盘忙时还会延长同步与请求超时。

建议：每轮、每版本建立一次索引；legacy 顶层文件索引只建立一次。用扫描调用次数测试验证。

### 7. [P3] 审核状态与原工作流依赖仍有残留

位置：PicPeak frontend/src/components/admin/PhotographyWorkflowCard.tsx:225、231；frontend/src/services/gallery.service.ts:57；backend/src/routes/galleryRetouchWorkflow.js:261、275；frontend/package.json。

后台仍可呈现 moderation 状态，需求取消仍有 moderation 特殊分支。原工作流的 @xyflow/react、@dagrejs/dagre 仍保留依赖，当前源码未发现使用。审核相关存量数据未见专门迁移为 open 的处理，不能直接删分支而遗漏旧记录。

建议：先迁移历史需求状态，再删对应类型、界面、分支及翻译；确认依赖无用途后从清单和锁文件移除。

## 已执行验证

- 前端：108 个测试文件、588 项测试通过；类型检查及生产构建通过。
- Bridge：73 项测试通过；另执行三个故障/迁移/多挂载的临时复现实验。
- 前后端 lint 通过。
- 中文：3194 个键、154 个复数键，键一致性与占位符检查通过；3125 个静态引用检查通过；翻译检查器自身 5 项测试通过。
- 前后端生产依赖 npm audit：本次返回 0 个已知漏洞。
- 后台全套测试：329 个套件通过、2 个失败、4 个跳过；3078 项通过、17 项失败、28 项跳过。单独复核失败套件得到相同 17 项失败，均为 MinIO/S3 初始化创建 bucket 时连接失败；测试服务 localhost:7104 实测 ECONNREFUSED。失败套件中的 17 项本地文件存储测试通过。对象存储场景仍待启动服务后验证。

## 验证边界

Docker 服务未运行，本次未进行真实容器、NAS 部署或跨设备浏览器 E2E；未修改业务源码，未提交或推送。本次没有发现语言资源重新引入第三种语言，当前 locales 只有 en 与 zh-CN。
