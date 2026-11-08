# UI 文档 — 按任务选择阅读路径

本仓是 zhuzhao 控制台的文档归属仓。操作步骤、前端设计和正式审查报告均在这里维护；机器协作要求保留在根 [AGENTS.md](../AGENTS.md)。五仓的分类、命名、时点与引用约定见主仓[文档维护约定](../../zhuzhao/docs/documentation.md)。

## 我现在要做什么

- **第一次启动或联调**：先读[开发与联调](guides/development.md)，确认后端/上游在位，再读[请求链路](design/request.md)。
- **提交一个改动**：读[贡献指南](contributing.md)，按工作树安装 hooks、检查真实待推窗口，交付附摘要/影响/证据。
- **新增或修改页面**：先读[UI 设计约束](design/frontend-ui.md)，再按[页面与组件开发](guides/components.md)步骤选骨架、分页与共用组件；CRUD/表单控制器见[hooks](guides/hooks.md)。
- **新增测试或解释失败**：读[测试指南](guides/testing.md)，分清静态扫描、单测、真栈场景与人工布局检查各自范围。
- **构建、部署或回退**：依次读[部署](ops/deployment.md)和[发布](ops/releasing.md)，区分构建参数与运行时反代配置。
- **核查旧结论**：从[审查入口](review/README.md)沿基线→修复→复验查报告；其中旧数字和失败仍属于原时点。

## 文档归属与状态

[设计](design/README.md)解释当前机制与约束，[指南](guides/README.md)给执行步骤，[运维](ops/README.md)给部署验证和回退，[审查](review/README.md)解释状态与证据。仅建立有内容的分类，本仓不另造 API/迁移权威副本或空阶段目录。

共享工程公约见主仓 [standards.md](../../zhuzhao/docs/standards.md)；Phase 4 工程来源见[前端设计](../../zhuzhao/docs/phase4/01-frontend-design.md)，跨仓 Phase 5/6 规划分别见[Phase 5](../../zhuzhao/docs/phase5/README.md)、[Phase 6](../../zhuzhao/docs/phase6/README.md)。已批准的未来设计仍需实施与验证，不能据文档中的勾选推断已交付。

`doc/` 是本地参考；执行卡、原日志、截图和临时验证产物留在 `.codex/` 等忽略目录。正式报告已迁至 `review/reports/`，旧 `deliverables/`、`outputs/`、`audit-reports/` 不再是受控文档入口。
