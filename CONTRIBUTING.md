# 开发规范

本仓库已合并客户选片前后端与独立 Bridge 服务。开发使用 `dev`，通过审查和自动化测试后合并 `main`。所有流程变更必须补充对应的回归测试，RAW 原目录始终只读。

提交前运行前后端测试、中文键值与插值检查、Bridge 测试、依赖安全检查及统一镜像验证。涉及交付、撤回、归档、备份时，还应验证重启恢复和幂等性。

发布操作见 [RELEASING.md](RELEASING.md)。反馈使用 [本项目 Issues](https://github.com/Aanlik/picpeak-zh/issues)，安全问题使用 [SECURITY.md](SECURITY.md)。
