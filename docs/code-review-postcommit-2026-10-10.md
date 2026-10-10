# 提交后复审（2026-10-10）

> 后续修复：R01、R02 已按 [恢复修复记录](recovery-fixes-2026-10-10.md) 处理。下文保留原始发现及复现结果。

审核基线：dev 的 a1f6099（81 个文件）。本轮聚焦修复涉及的归档、身份认证、客户并发标记、备份恢复、Bridge 解绑与手机下载，以及部署配置和锁定文件。

结论：发现两项仍需修复的问题，不建议在修复前发布这一版本。上一轮通过的测试不能覆盖下面这两条中断路径。

## R01 / P1：恢复末尾失败会造成 PicPeak 与 Bridge 进度不一致

位置：backend/src/services/restoreService.js:623、731。

Bridge 恢复成功后，workflowApplied 设为 true。此后更新 restore_runs 完成状态等操作仍可能失败；catch 会回滚 PicPeak，但 finally 因 workflowApplied 为 true 跳过 Bridge 的恢复前检查点，并解除同步暂停。下一轮同步因此会使用与 PicPeak 不一致的交付版本和选择记录。

复现：在真实测试 SQLite 的 restore_runs 上添加临时触发器，使 status 更新为 completed 时抛错；运行实际 RestoreService.restore，仅替换数据库文件导入及远程 Bridge 调用。确认 PicPeak 安全回滚被调用一次，Bridge restore 只收到 backup 状态，没有收到 before 状态，随后暂停被解除。故障注入测试通过，证明该异常路径存在；不是完整生产数据库恢复测试。

建议：记录整个恢复是否成功及 PicPeak 回滚是否成功。PicPeak 成功回滚时，必须恢复 Bridge 的恢复前检查点；两侧回滚失败应保留暂停并明确报告部分恢复状态，不能静默继续同步。增加末尾数据库写入失败的永久回归测试。

## R02 / P2：解绑中断后可能生成无法恢复的精修状态备份

位置：bridge/src/pixcake_bridge/app.py:406、419；bridge/src/pixcake_bridge/state_backup.py:22。

解绑先替换 projects.json 和内存配置，再提交 SQLite 删除。若进程在两步之间中断或数据库提交失败，配置已没有该项目，而数据库仍有其状态。export_state 会完整导出数据库且没有一致性校验，检查点接口可能报告成功，后续 restore_state 却拒绝同一份备份。

复现：建立一个已同步项目，将配置置为解绑后的空项目列表，保留数据库记录，模拟中断留下的状态。export_state 成功输出 configured_projects=0、database_projects=1；将输出交给 restore_state，得到“备份项目配置与数据库不一致”。真实 HTTP 解绑事务中断未注入；配置/数据库中间状态及备份拒绝已经复现。

建议：为解绑增加可恢复日志，启动时完成未提交的解绑；导出检查点前检查配置与数据库一致性，无法协调时明确拒绝备份。增加提交失败、解绑后重启及备份可恢复性测试。

## 已校正：Bridge 本地包锁定版本

pyproject.toml 的版本为 0.1.10，而 uv.lock 的本地 editable 包版本仍为 0.1.9。使用 uv 重新生成该条目，其他依赖版本未改变；通过 --locked 验证后补充提交。

## 本轮验证及边界

- R01：实际 RestoreService 异常路径故障注入测试 1 项通过。
- R02：独立 SQLite 状态复现确认备份导出成功但恢复拒绝。
- Bridge 全量测试再次执行，结果见同日 postcommit 验证 JSON。
- 中文键与翻译引用检查、差异格式检查通过。
- 上一轮后端 3093、前端 600 项通过及手机浏览器 3 项通过的结果继续作为基线证据；本轮没有重新启动手机浏览器或重建镜像，不将之前结果算作新测试。
- 本轮没有推送远端或修改 NAS；现有镜像仍是上一轮生成的镜像，两项新发现尚未修复。
