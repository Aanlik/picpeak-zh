# 单容器部署

当前项目使用统一镜像，同时包含客户选片界面和精修同步服务。部署入口为仓库根目录的 [README](../README.md)、[compose.yaml](../compose.yaml) 和 [.env.example](../.env.example)。

生产环境使用已验证的固定版本。旧的官方多容器部署文件已删除；PostgreSQL 测试配置仅用于测试。更新本项目不会自动同步官方代码。
