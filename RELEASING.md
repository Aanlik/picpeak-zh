# 发布流程

1. 在 `dev` 完成改动与回归测试。
2. 完成代码审查、中文检查、依赖扫描、统一镜像启动和真实容器集成测试。
3. 更新当前统一镜像固定版本、README、Compose 和构建工作流。
4. 将经过验证的版本合并 `main`，手动触发 Unified photography project 工作流，并选择发布。
5. 升级前备份 PicPeak 数据及 Bridge 状态，保留 NAS 原片目录只读挂载。

不使用 `latest`、`stable` 或 `main` 镜像标签；不自动合并原项目代码。历史变更记录只用于来源追溯。
