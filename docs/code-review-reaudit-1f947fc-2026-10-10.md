# 再次审计 1f947fc（2026-10-10）

> B01、B02 已修复，验证结果见 [修复记录](restore-compatibility-fixes-2026-10-10.md)。

本轮审计本地 dev 的 1f947fc，重点复核备份、恢复、检查点、重启保护，并检查客户选片、撤回、状态标签与下载代码及回归测试。未修改生产代码、未推送远端、未操作 NAS。

结论：上一轮 A01–A03 修复的回归通过；新确认 1 项 P1、1 项 P2。建议修复后再发布。此轮为重点审计，不代表逐行验证全部仓库、全部设备和全部部署模式。

## B01 / P1：旧备份恢复数据库绕过 Bridge 协同保护

位置：`backend/src/services/restoreService.js:391`。

只有 manifest 含 `metadata.workflow_state` 才建立恢复检查点。对于仍允许导入的旧备份，完整或数据库恢复会直接替换 PicPeak 数据库，而 Bridge 继续使用恢复前的项目、照片 ID、交付哈希与待上传任务。数据库回到旧时点后，Bridge 可能忽略实际已回退的交付图片，或把已有任务作用于已改变对应关系的数字 ID；同步也可能与数据库替换并发。

根目录 README 提醒“旧备份不能恢复 Bridge 进度”，但没有阻止该执行路径或提供安全暂停与重新绑定流程。文档提示不能替代写入保护。

复现：使用真实 RestoreService 与临时 SQLite 测试数据库，沿用 workflowRecovery 测试夹具，提供 metadata 为空的旧 manifest，模拟底层数据库导入成功。实际 restore 返回 success=true，checkpoint 和 Bridge restore 均未调用。此故障注入证明编排绕过保护，未使用真实旧生产备份证明错图后果。

建议：所有 full/database 恢复，只要配置了 Bridge 都必须暂停同步。没有精修状态的旧备份应明确拒绝联合恢复，或进入保持暂停、人工重新绑定并核对照片 ID 的迁移流程；不能直接恢复成功并继续同步。增加旧 manifest、Bridge 不可用、同 ID 不同照片等回归用例。

## B02 / P2：解除恢复暂停失败仍报成功，期限提示错误

位置：`backend/src/services/restoreService.js:665`、`:747`，`backend/src/services/workflowBackup.js:36`。

恢复结果先记录 completed 并返回 success=true，finally 中 release 的失败仅写日志。确认后的恢复暂停为无限期，遇到 Bridge 断网、宕机或解除请求失败后会保持暂停；用户看到恢复成功，却无法继续同步。错误文字仍声称“锁最多保持 30 分钟”，会误导管理员等待自动恢复。

复现：真实 RestoreService 与临时 SQLite，含 workflow_state 的 manifest；模拟恢复正常，release 抛出 Bridge release unavailable。实际返回 success=true，restore_runs.status=completed，未返回需要解除暂停的结构化状态。Bridge active restore 无限期由 checkpoints.apply 的 inf 分支确认。

建议：分别记录“数据恢复完成”和“同步暂停未解除”，在返回值和后台显示明确警告及安全重试入口；解除操作应支持幂等确认，避免响应丢失时误判。恢复失败仍保持暂停，不应为了消除提示自动放行。按任务用途给出正确期限说明。

## 验证结果与边界

- 前端全量：110 个文件、600 项通过。
- Bridge 全量：107 项通过，1 条 Starlette TestClient 弃用警告。
- 后端相关回归：3 个套件、16 项通过。
- 临时故障注入：1 个套件、7 项通过，包含 2 条新复现和原 5 条联合恢复测试。
- 中文键一致性：3196 键、154 复数键，插值一致；319 个文件、3134 个静态翻译引用检查通过。
- 生产代码没有变化，未重建镜像。本轮未重新运行后端全部 3106 项、真实 100 张照片容器 E2E 或实体手机测试，上一轮结果不得算作本轮重新执行。

复现仅使用临时测试数据库及模拟导入/网络故障，没有改动 NAS 数据。临时测试文件执行后删除；结构化结果见 [审计证据](audits/2026-10-10-reaudit-1f947fc.json)。
