# 函数级与故障边界代码审查 — 2026-10-10

审查基准：PicPeak dev/c388c125；Bridge 0746de8，业务源码没有变更。本轮在上一份全量审查之后，进一步沿函数内的每次 await、文件删除、数据库提交和前端状态赋值核查。范围包括照片替换、客户反馈、返修撤回、项目绑定、阶段变更、归档恢复、上传确认、快照和回复草稿。本报告是上述关键路径的深入审查，不代表已经穷尽每行源码的全部执行组合。

## 新增发现

### A1 [P1] 照片替换失败时旧文件已经删除

位置：picpeak-zh/backend/src/services/photoReplacementService.js:184–210。

旧原图、缩略图和衍生图的删除先于 storage.putFromFile 和数据库更新。磁盘空间不足、权限错误、S3 上传失败时，照片行仍指向旧文件，但旧文件已不存在。已用该实际函数进行故障注入：putFromFile 抛出 disk full；返回 success:false；旧文件已被删除。数据库更新失败也有相同风险。

修复方向：先用唯一新键写入并验证，成功更新数据库指向后才清理旧资产；数据库失败保留旧资产并清理新孤儿。不要复用旧键作为覆盖目标。

### A2 [P1] 同一项目并发绑定生成重复持久配置，重启失败

位置：pixcake-bridge/src/pixcake_bridge/app.py，add_project 的重复检查、await engine.client.photos、配置文件写入之间。

重复检查在异步 API 验证之前，没有锁，也未在提交时再次验证。两个同时进入的请求都通过检查，随后都追加相同 event_id。已通过真实 FastAPI ASGI 入口并发提交复现：两次 HTTP 303；cfg.projects 中 event_id=9 出现两次；projects.json 写入 [7,9,9]。Config.load 明确拒绝重复 event_id，因此下一次 Bridge 启动失败。

修复方向：API 连通性检查可在锁外执行；配置提交应持锁、重读并去重，数据库/配置持久化采用可恢复步骤；重复请求返回既有绑定或明确冲突。

### A3 [P2] 归档阶段变更与同步不共享锁，归档后仍上传

位置：pixcake-bridge/src/pixcake_bridge/engine.py:36、115–132；app.py 的 /api/projects/{event_id}/stage。

sync 持 engine.lock，但阶段 API 调用同步 set_stage 未获取它。sync 读取非归档状态后等待远端，阶段 API 此时可写入 ARCHIVED，sync 随后使用旧 ORM 对象继续处理。已复现：在远端读取暂停期间归档，释放读取后产生一次照片上传，而持久项目阶段是 ARCHIVED。

修复方向：阶段变更与同步使用同一串行化机制，并定义归档完成前是否等待正在执行的上传；不能仅在同步开头检查阶段。

### A4 [P2] 非法成功响应没有转为 UNKNOWN，后续轮询重新上传

位置：pixcake-bridge/src/pixcake_bridge/client.py:71–72；engine.py:403–420。

HTTP 2xx 响应解析 JSON 抛 ValueError，或 JSON 不是对象导致结构访问异常时，未包装为 uncertain ApiError。引擎在写入 UPLOADING 后没有可靠地转入 UNKNOWN；同进程下下一轮可再次上传。已模拟 JSON 解析异常：连续三轮同步（第一轮用于稳定检测）实际发起两次上传，最终任务仍为 UPLOADING。不能假定每个 2xx 都有合法响应；异常时远端是否写入尚不确定。

修复方向：对传输后所有响应解码/结构校验失败归为 UNKNOWN；下轮先核对 marker，核对不到则阻塞并提示人工确认。

### A5 [P2] 自动刷新无条件覆盖尚未保存的摄影师回复

位置：picpeak-zh/frontend/src/components/admin/PhotographyWorkflowCard.tsx:84、95。

每 30 秒 refresh 都用服务器已保存值重建整个 replies；输入框则把未保存草稿存在同一个 replies。摄影师正在写回复时，轮询完成就覆盖输入。保存其他请求也触发 refresh，导致其他照片的草稿丢失。此项由实际赋值链确认，尚未进行真实浏览器录制复现。

修复方向：服务器值与草稿分离，记录 dirty 状态；只更新未编辑项，保存成功后仅清除对应草稿，项目切换时隔离请求结果。

### A6 [P2] 归档恢复成功后 Bridge 失败没有补偿，项目长期停止同步

位置：picpeak-zh/backend/src/routes/adminArchives.js:593–609；pixcake-bridge/src/pixcake_bridge/engine.py:122–123。

恢复先将 PicPeak is_archived 清为 false，再调用 Bridge restore；失败只记录 warning，仍按恢复成功继续。Bridge 如果当时离线，恢复后其项目仍为 ARCHIVED，正常轮询永远跳过，没有机会自愈。相同问题适用于归档时 setWorkflowStage 失败只记录警告，造成两边阶段不一致。

修复方向：持久化阶段同步任务，连接恢复后重试并查询确认；后台显示“归档恢复完成、精修同步待恢复”，避免静默成功。此项为跨服务控制流确认，未实测 NAS 断网。

### A7 [P3] 快照失败清理可能删除调用前就存在的目标

位置：pixcake-bridge/src/pixcake_bridge/files.py:123、137–138。

dest.open('xb') 本意是拒绝覆盖，但 FileExistsError 被统一 except 捕获，随后 dest.unlink 删除已有文件。已复现：目标包含 existing history，调用 snapshot 返回 FileExistsError 后，目标不存在。当前调用方使用 UUID pending 名，正常碰撞概率极低，故列为低优先级，但函数的“不覆盖已有文件”契约仍被破坏。

修复方向：仅当本次调用成功排他创建目标后，才允许异常清理删除它；已有目标一律保留。

## 验证与边界

A1、A2、A3、A4、A7 已完成最小故障/并发复现；均只操作临时目录、临时 SQLite、ASGI 测试入口或模拟存储，无生产照片操作。A5、A6 已追踪控制流，尚未做真实浏览器/NAS 演练。

上一报告中的 7 项问题仍未修复，本轮没有将它们重复计为新增。没有修改业务源码、提交、推送或部署。现有正常路径测试通过不能覆盖上述异常与竞争时序。真实 Docker/NAS/E2E 验证仍受 Docker 未启动的限制。

专项回归测试结果：客户返修工作流与下载文件名相关的 3 个套件、17 项测试通过。它们没有覆盖本轮新增的故障与并发案例，因此没有据此将上述问题判为通过。
