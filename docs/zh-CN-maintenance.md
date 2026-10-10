# 自主管理、测试与发布

## 维护政策

本仓库按独立产品维护，不再常规合并 PicPeak 官方分支，不运行上游同步脚本，也不设置上游版本监控。所有代码变更通过本仓库自己的分支、评审和 CI；生产镜像使用本项目发布的不可变版本标签或 digest。

PicPeak 的代码来源和许可证基线记录在 [代码来源记录](source-provenance.md)。保留原始 MIT 许可证和版权声明。来源记录用于许可证与缺陷追溯，不是上游同步基线。

若遇到安全漏洞或严重缺陷，可单独研究上游或其他来源的修复思路；移植后必须在本项目中独立审查、编写必要测试、运行完整验证并以本项目版本发布。不得直接合并上游分支或把整批官方代码更新带入生产。

## 自行维护清单

- 定期检查 Node.js、前端和后端依赖的安全公告，升级后运行锁文件审计、构建和测试。
- 针对认证、分享链接、客户权限、文件上传和下载、NAS 路径处理、归档恢复等边界做安全回归。
- 中文翻译以本仓库的 `frontend/src/i18n/locales/en.json` 为键集合，运行 locale parity、占位符和静态引用检查；此检查只比较本仓库语言文件，不依赖上游。
- PicPeak 的 Public API 与 PixCake Bridge 之间维持显式接口契约。变更照片 ID、`source_filename`、客户反馈、替换照片、分页或认证语义时，必须同步更新 Bridge 适配并运行真实容器集成测试。
- 数据库变更必须新增向前迁移，并验证备份、恢复及旧数据兼容；不要删除既有迁移历史。
- 发布前分别验证目标架构的镜像，锁定镜像 digest；在 NAS 上检查健康状态、中文客户选片、追加、取消、返修、归档和分享链接。

## 本地验证

```bash
node scripts/check-zh-cn.mjs
node scripts/check-locale-usage.mjs
node --test scripts/check-zh-cn.test.mjs
cd frontend
npm ci --legacy-peer-deps
npm run build:check
npm test
cd ..
docker build -f Dockerfile.aio --build-arg VITE_DEFAULT_LANGUAGE=zh-CN -t picpeak-zh:<版本> .
docker run --rm --entrypoint node picpeak-zh:<版本> scripts/test-zh-unicode.cjs
```

Bridge 侧执行其仓库记录的单元与真实 PicPeak 容器集成测试。发布前对 PicPeak `/data`、Bridge SQLite（含 WAL）以及摄影项目目录做一致性备份；先验证升级，再决定是否在生产切换镜像。若迁移后需回退，恢复升级前备份，不能只切换旧镜像。

## 产品与 Bridge 边界

PicPeak 管理客户、项目、照片、评论、评分、分享访问与媒体呈现。Bridge 是独立代码库，维护客户选择轮询、RAW 匹配、版本目录、交付同步和精修状态。PicPeak 只通过内网代理读取和触发这些工作流；Bridge 不向公网开放。详细边界见 [中文摄影界面与精修状态](zh-CN-photography-ui.md)。

## 部署版本

版本标签应体现本项目自己的版本，不再承诺与 PicPeak 官方版本保持对应。生产环境禁止使用可变的 `latest`、`main` 或 `stable` 标签。NAS 的部署、目录映射和升级步骤以 [Bridge 一体化部署说明](https://github.com/Aanlik/pixcake-bridge/blob/main/README.md) 为准。

## 翻译质量基线

当前语言包包含 4,834 个中英文键、178 个复数键和插值/模板占位符检查；静态提取器管理 4,075 个源码引用键。键齐全和构建成功不等于每条专业文案都已经过人工语言审校，重点工作流文案仍需在版本验收中检查。

前端默认语言是构建参数 `VITE_DEFAULT_LANGUAGE`。Compose 中的默认语言配置需要传入该构建参数；修改后必须重建镜像。访客已保存的语言优先，其次使用部署默认值，再参考浏览器语言。画廊登录页还需在后台“设置 → 常规 → 默认语言”中选择简体中文。
