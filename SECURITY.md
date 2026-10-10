# 安全策略

本策略适用于本仓库的客户选片系统、Bridge 及统一 Docker 镜像。维护对象为本项目最新经过测试的固定版本；不自动跟随原项目发布渠道。

安全报告请使用 [本项目私密漏洞报告入口](https://github.com/Aanlik/picpeak-zh/security/advisories/new)。若入口不可用，请先提交不含漏洞利用细节、令牌或客户数据的 Issue 请求私密联络方式。

Bridge 仅在容器内部或局域网使用。更新前备份两套数据库和配置，保留原始照片只读挂载。
