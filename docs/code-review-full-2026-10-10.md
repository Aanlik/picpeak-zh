# 合并后的全模块代码审查

> 本文保留修复前的审查基线。12 项问题的修复与复审结果见 [修复验收记录](code-review-fixes-2026-10-10.md)。

审查基线：本地 dev，`72b0190`。日期：2026-10-10。本次为审查，业务代码和部署镜像未修改，未操作生产 NAS。结论：仍有需要修复的问题，不能用现有测试全绿代替这些边界场景的验收。

## 结论

发现 **12 项需处理问题：4 项 P1、7 项 P2、1 项 P3**。P1 应优先修复；P2 是明确功能缺口、运维不一致或依赖维护问题；P3 是诊断缺陷。下文逐项区分运行复现、代码路径确认和依赖公告，不把静态风险冒充已实际发生的事故。

| 编号 | 优先级 | 问题 | 证据类型 |
|---|---|---|---|
| F01 | P1 | 原文件名归档恢复生成重复照片，破坏原 ID 对应关系 | SQLite + 真实 HTTP 路由复现 |
| F02 | P1 | 多客户同时撤回，遗漏最后一次全局撤回 | SQLite + 并发 HTTP 路由复现 |
| F03 | P1 | 重试确认检查在锁外，可绕过 UNKNOWN 确认 | Bridge ASGI 并发复现 |
| F04 | P1 | 归档未冻结上传，文件和数据库快照可能不一致 | 代码路径确认；未做容器并发复现 |
| F05 | P2 | 内置完整备份不包含 Bridge 状态 | 代码路径确认 |
| F06 | P2 | 撤回失败异常计数为零，隐藏重试入口 | Bridge 数据库 + HTTP detail 复现 |
| F07 | P2 | SELECTING 归档恢复后误认为已进入精修 | Bridge 状态与文件复现 |
| F08 | P2 | 删除项目没有解绑 Bridge，残留轮询和项目配置 | 删除与同步路径交叉确认 |
| F09 | P2 | 旧生产 Compose 与支持文档仍指向官方服务 | 配置与文档确认 |
| F10 | P2 | Bridge 锁定了有已知公告的依赖版本 | pip-audit + 维护者公告确认 |
| F11 | P3 | 布局冲突分支引用不存在的 name，抛 NameError | Python 3.12 隔离目录复现 |
| F12 | P2 | SSO 仍执行邮箱匹配和邮箱必填创建，退役清理遗漏 | 可达登录路径确认 |

## 需要优先修复的逻辑问题

### F01 — 原文件名归档恢复生成重复照片

位置：`backend/src/routes/adminArchives.js:502`，关联 `backend/src/services/archiveService.js:132`。

开启原文件名下载时，ZIP 条目使用 original_filename，manifest 仍保存内部 filename。恢复虽然能找到 manifest，但检查已有照片只比较 ZIP 文件名，没有用 manifest 的内部 filename / 稳定 photo_id 查找。正常归档保留了原照片行，因此该检查会漏掉原行，随后插入新行；原行 path 指向并未按内部名称恢复的文件，新行也没有恢复 source_filename。

复现：已有 id=18、filename=`stored_9f8e7d.jpg`、source_filename=`DSC_4242.jpg`；ZIP 内为 `individual/DSC_4242.jpg`。恢复返回 200，却保留旧 id=18 并新增 id=19，新增行 source_filename 为 null。原评论/选片/Bridge 进度仍绑定 id=18，新增照片没有这些关系，原预览路径可能缺文件。

建议：manifest 记录稳定 photo_id 和实际 ZIP 条目名；优先匹配并更新原行与恢复路径，保留 ID/source_filename。旧归档用 manifest 内部 filename 精确回退，存在歧义则停止，不能静默插入重复行。新增实际「归档 → HTTP 恢复 → 原 ID/内容/评论/Bridge」回归测试。当前 100 张 E2E 的 archive_restore_progress 只验证 Engine 阶段恢复，没有覆盖此 HTTP 文件恢复路径。

### F02 — 多客户同时撤回会漏建任务

位置：`backend/src/routes/galleryRetouchWorkflow.js:98`、`:107`、`:116`。

读取其他客户选择发生在删除事务之外。A/B 同时撤回时，两次都读到“另一位还选着”，随后分别删掉自己的标记，两次均走 kept_for_other_participant 分支，不创建全局撤回任务。最后实际已无人选择，但交付成片和 RAW 关联未按删除选项处理。

并发 HTTP 复现：两个请求均返回 `{success:true, kept_for_other_participant:true}`；数据库 activeSelections=0，withdrawalIntents=0。客户操作看似成功，后台没有应该执行的清理任务。

建议：在同一个照片级串行事务内删除当前选择、重查剩余有效选择，再决定是否写 outbox。PostgreSQL 使用可跨请求的行锁；SQLite 使用串行写事务，并让新增选择也遵守同一约束。复测同时撤回、撤回期间另一个客户新增选择、共享身份三种情况。

### F03 — 重试可以绕过 UNKNOWN 确认

位置：`bridge/src/pixcake_bridge/app.py:314`、`:326`，关联 `engine.py` 的 retry。

未知任务检查在 engine.lock 外，任务状态重置在锁内。重试请求检查时正在上传的 Delivery 还是 UPLOADING，因此判定没有 UNKNOWN；等待锁时上传丢失响应，状态变成 UNKNOWN。拿到锁后直接重置 PENDING，无需摄影师确认，下一次可能重复上传。

ASGI 复现：模拟当前同步持锁，投递 confirm_unknown=false 请求，再把任务从 UPLOADING 改成 UNKNOWN 并释放锁；接口返回 200，任务被重置为 PENDING。

建议：拿到同一锁后重新查询 UNKNOWN/UPLOADING，完成确认判断与重置；恢复状态不可依赖锁外快照。不能把所有 UNKNOWN 简单当作失败重新发。

### F04 — 归档和替换缺少一致性冻结

位置：`backend/src/services/archiveService.js:46`、`:162`、`:194`，关联 `backend/src/routes/v1/events.js:368`。

归档先读取进度、manifest 和文件列表，完成 ZIP 后才通知 Bridge ARCHIVED。在压缩期间 Bridge 可以提交新的精修替换，而替换会删除旧文件。Public API 上传入口也只检查项目存在，没有归档中/已归档写保护。

由现有顺序可推导：并发替换可能让后续 ZIP 读取旧文件失败；若旧文件已经读入，则 ZIP 包含旧版本、数据库却指向新版本，后续恢复难以保持一致。Bridge 后来拿到阶段锁，不能补救已产生的不一致快照。此项是代码路径确认，尚未做专用容器故障注入复现。

建议：加入持久化 ARCHIVING 状态和照片写入保护，先停止该项目的同步与新替换，再取得稳定文件/数据库快照；归档失败时可靠恢复原阶段。需要涵盖已在飞行中的上传，不能只提前发一次阶段请求。

## 其他明确问题

### F05 — 内置备份遗漏 Bridge 状态

位置：`backend/src/services/backupService.js:744`、`:775`，`backend/src/services/databaseBackup.js`，`compose.yaml` 的两个卷。

PicPeak 备份扫描 STORAGE_PATH 的受控子目录并导出 PicPeak 数据库；未处理 `/bridge-data/bridge.db`、projects.json、布局迁移记录，也没有 Bridge 恢复接口。新主机仅恢复后台“完整备份”不会恢复处理记录、阶段和上传去重状态。README 的手动备份两个卷能规避，但产品内置“完整备份”仍不是合并项目的完整恢复方案。

建议：增加统一备份 manifest、两个数据库的一致性快照及配置恢复；实现前在后台明确备份范围，避免让用户认为已完整保护整个项目。SQLite 应使用 backup API 或停服务的一致性备份，不能只在运行中拷贝单个 .db 而遗漏 WAL。

### F06 — 撤回异常被错误当作恢复成功

位置：`bridge/src/pixcake_bridge/engine.py:161`、`:225`，`bridge/src/pixcake_bridge/app.py:105`，`frontend/src/components/admin/PhotographyWorkflowCard.tsx:154`。

resume_withdrawals 捕获错误后继续同步，没有把失败传给本轮 failed。照片因 pending 被跳过，最后本轮被判成功并把错误日志标记 resolved；异常计数只统计 Photo.error/Delivery FAILED、UNKNOWN，不统计 Withdrawal.error。后台重试按钮依赖异常计数，因此撤回错误会隐藏重试入口。

复现：没有可恢复 Proof 时，Withdrawal=PENDING、error=`RAW 未找到`，detail 中 photo_error=true，但 summary_errors=0、可见错误日志=0。

建议：撤回失败计入本轮失败和异常汇总；只有对应任务成功才能关闭对应错误，不能整项目一律 resolve。测试待处理、UNKNOWN、清理失败和恢复后计数变化。

### F07 — 归档错误设置“已经进入精修”

位置：`bridge/src/pixcake_bridge/engine.py:76`。

set_stage 把 ARCHIVED 与 EDITING/DELIVERED 一起设置 has_entered_editing=true。从 SELECTING 直接归档再恢复，阶段虽回到 SELECTING，但历史保护标记仍为 true；此后客户取消选择，待精修 RAW 不会删除。

复现：stage=SELECTING、has_entered_editing=true、cancelled_raw_still_exists=true。

建议：归档保持原来的 has_entered_editing，仅真实进入精修/交付时设为 true；旧数据库若无法准确判断，应明确保守迁移策略。

### F08 — 项目删除没有清理 Bridge 绑定

位置：`backend/src/routes/adminEvents/helpers.js:183`、`:300`，`bridge/src/pixcake_bridge/engine.py:151`，`bridge/src/pixcake_bridge/app.py`。

PicPeak 删除照片/项目并清理自身存储，但没有通知 Bridge 解绑，也没有 Bridge 项目删除/停用端点。Bridge 继续加载 projects.json 中的项目，每轮请求已删除 event，积累 SyncRun/错误，旧配置还占用专属交付目录，后续绑定不能复用。

建议：删除时写持久化解绑意图，Bridge 锁内停用/解绑项目并更新配置及状态；是否清理交付副本需遵守明确的产品范围，绝不删除原 RAW。404 不能直接清空 RAW，权限失败/临时不可用不能被当作永久删除。

### F09 — 旧部署和官方链接仍能误导用户

位置：`docker-compose.production.yml:106`、`:213`；`docs/single-container.md:3`；`docs/zh-CN-maintenance.md:43`；`SUPPORT.md`、`SECURITY.md`。

生产 Compose 仍拉取官方 backend/frontend 的可变 stable 标签，完全绕过当前中文定制、Bridge 和已删模块；部分维护文档仍让用户去独立 Bridge 仓库安装，SUPPORT/SECURITY 把项目反馈导向官方团队。根 README 正确，但旧文件没有全部标记为历史入口，存在两套相互矛盾的安装来源。

建议：只有根 compose.yaml 是当前默认；旧部署移动到明确的历史兼容目录或删除失效入口。生产示例均固定本项目版本。支持、安全反馈链接改成本项目。LICENSE 和来源说明是版权/溯源资料，应保留，不能把它们当作无效代码删除。PostgreSQL 测试/可选能力也不应仅因当前使用 SQLite 就盲删。

### F10 — Bridge 两个依赖版本需升级

位置：`bridge/requirements.lock:40`、`:44`，关联 pyproject.toml、uv.lock、Dockerfile。

锁定 python-multipart=0.0.20、Starlette=0.46.2。pip-audit 返回 26 个公告记录，包含重复标识/别名，不能解释为 26 个独立且可利用的本项目漏洞。已核对维护者公告，例如：

- [Starlette 大文件 multipart 事件循环阻塞](https://github.com/Kludex/starlette/security/advisories/GHSA-2c2j-9gv5-cj73)：当前版本在受影响范围内。
- [python-multipart 无界 part headers 导致 CPU 消耗](https://github.com/Kludex/python-multipart/security/advisories/GHSA-pp6c-gr5w-3c5g)：当前版本在受影响范围内。

当前 Bridge 只监听容器内回环地址，PicPeak 代理的表单也不是任意原始 multipart 转发；本轮未证明匿名外网客户可利用这些问题。某些公告要求非默认上传配置或 FileResponse/Windows 等功能，本项目未使用，不能全部归为可达漏洞。

建议：联合升级 FastAPI/Starlette 的兼容版本与 python-multipart，重新生成两套锁文件，复测表单绑定、身份认证、并发、镜像启动。统一 CI 补 Python 依赖审计；npm 的生产依赖审计本轮均为 0，但这不代表 Python 或系统软件也为 0。

### F11 — 迁移冲突报错使用不存在的变量

位置：`bridge/src/pixcake_bridge/config.py:105`。

name 只存在于生成 moves 的列表推导式局部作用域；冲突分支 f-string 引用 name 会抛 NameError。Python 3.12 复现新旧 03_SELECTED_RAW 都有文件时，实际错误是 `NameError: name 'name' is not defined`，而不是预期中文冲突说明。它仍会停止迁移，没有证据表明因此覆盖文件，但诊断失效。

建议：使用 source.name 或在循环中携带目录名，并补新旧都有文件的冲突用例。

### F12 — 邮箱身份业务仍残留在 SSO 中

位置：`backend/src/services/oidcService.js:564`、`:606`、`:655`、`:676`，关联 `backend/src/routes/auth.js` 的 SSO 回调和 `frontend/src/pages/admin/AdminLoginPage.tsx:98`。

SSO 配置开启后，仍按 verified email 自动关联管理员，自动创建账号还要求 email claim，并把邮箱直接作为 username。这是当前可执行业务分支，不是迁移注释，和此前「去除全部邮箱内容、改用户名登录」目标不一致。默认本地用户名登录不会触发，因此已有本地登录测试通过不能证明邮箱逻辑已清理完。

建议：若保留 SSO，按 issuer+subject 建立绑定，使用 preferred_username/name 或受控用户名生成，不再把邮箱作为必要身份字段；旧账号需要明确迁移绑定，不能用不可靠的姓名自动合并。数据库遗留非空 email 列和 `@local.invalid` 占位值应通过兼容迁移逐步处理，不能仅删 insert 字段导致旧安装无法创建账号。`require_name_email` 目前已映射为昵称要求，属于历史键兼容，应另行命名迁移，不能误认为仍收集客户邮箱。

## 清理候选和性能观察（不额外计入 12 项）

- `bridge/src/pixcake_bridge/app.py:382` 的 slug 计算已无消费者，交付目录不再按项目名称生成；删除该语句后 re 导入也可以删除。属于已确认的小量死代码。
- Bridge 模板变量/退役模块关键词的命中应逐个分类。运行源码扫描没有发现仍在执行的 WhatsApp、SMTP 发信、reCAPTCHA、双重认证或报表分析模块；邮箱身份业务残留见 F12，备份统计属于流程必要计数；历史迁移和 legacyDeleteReferences 是旧数据库兼容保护，不应直接删掉。
- `engine.py:233`、`:241` 对每张选中照片每轮读取 RAW 和副本做全量 SHA256。默认 30 秒轮询，50 张、每张 80 MiB 时，每轮约 8000 MiB 读取；这是计算估算，不是 NAS 压测值。建议首轮校验+元数据变化触发+低频完整校验，保留原片保护。
- `SyncRun` 每轮新增且没有保留策略；单项目 30 秒轮询一年约 105 万行，长期应归档/限量。`Stability.seen` 也未移除旧路径，反复版本导出会积累条目。
- 前端构建仍有大 chunk 提示；当前不阻塞构建，但应作为性能优化事项。

## 审查覆盖与验证证据

覆盖方式：全仓库配置/文档入口核对，全部运行源码的静态检索、相对依赖解析，以及关键业务状态路径逐段审查。不是宣称每一行都已人工阅读，也不是生产 NAS 或全部浏览器的现场验收。

| 项目 | 结果 |
|---|---|
| 源码清单 | frontend/src 436、backend/src 274、bridge/src 8，共 718 文件，含测试/资源 |
| JS/TS 相对依赖解析 | 574 个非测试源码文件，2350 处引用，无缺失目标 |
| 后台完整 Jest | 333 测试集、3085 用例通过，28 跳过 |
| 前端完整 Vitest | 108 测试文件、589 用例通过 |
| Bridge pytest | 84 用例通过 |
| 前端类型检查/生产构建 | 通过 |
| 中英键/插值/复数 | 3194 键、154 复数键通过 |
| 翻译静态引用 | 317 文件、3126 引用通过 |
| 翻译检查器自身测试 | 5 用例通过 |
| npm production audit | 前后端均 0 已报告漏洞 |
| Python 锁文件审计 | 2 个包命中公告，已做可达性区分 |
| 新增隔离复现 | 6 个运行问题成立；复现用于证明现状，不是修复后的回归验收 |

后台 28 个跳过用例依赖 S3/MinIO；本轮未新增对象存储或生产 NAS 环境。临时复现用例运行后已移除，未混入正常测试集。

证据文件：

- [Bridge 状态复现](audits/2026-10-10-reproductions.json)
- [多人撤回和 HTTP 归档恢复复现](audits/2026-10-10-http-reproductions.json)
- [相对导入扫描](audits/2026-10-10-imports.json)
- [Python 依赖公告标识](audits/2026-10-10-python-dependencies.json)

修复顺序建议：F01/F02/F03 → F04 一致性保护 → F05/F06/F07/F08 生命周期闭环 → F09/F10/F11/F12 维护与清理。每项单独补能够在旧实现上失败的回归测试，完成后再构建和更新生产镜像。
