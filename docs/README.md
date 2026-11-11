# UI 文档 — 按任务选择阅读路径

本仓是 zhuzhao 控制台的文档归属仓。操作步骤、前端设计和正式审查报告均在这里维护；机器协作要求保留在根 [AGENTS.md](../AGENTS.md)。五仓的分类、命名、时点与引用约定见主仓[文档维护约定](../../zhuzhao/docs/documentation.md)。

## 我现在要做什么

- **第一次启动或联调**：先读[开发与联调](guides/development.md)，确认后端/上游在位，再读[请求链路](design/request.md)。
- **提交一个改动**：读[贡献指南](contributing.md)，按工作树安装 hooks、检查真实待推窗口，交付附摘要/影响/证据。
- **新增或修改页面**：先读[UI 设计约束](design/frontend-ui.md)；涉及Phase6后续改造时同时查[全站重设计](design/frontend-redesign.md)与[逐页清单](design/frontend-pages.json)，再按[页面与组件开发](guides/components.md)复用资产；CRUD/表单控制器见[hooks](guides/hooks.md)。
- **新增测试或解释失败**：读[测试指南](guides/testing.md)，分清大量合成mock、契约校验、真实栈关键链路和视觉/键盘检查各自能证明什么。
- **构建、部署或回退**：依次读[部署](ops/deployment.md)和[发布](ops/releasing.md)，区分构建参数与运行时反代配置。
- **核查旧结论**：从[审查入口](review/README.md)沿基线→修复→复验查报告；其中旧数字和失败仍属于原时点。

## 文档归属与状态

[设计](design/README.md)解释当前机制与约束，[指南](guides/README.md)给执行步骤，[运维](ops/README.md)给部署验证和回退，[审查](review/README.md)解释状态与证据。仅建立有内容的分类，本仓不另造 API/迁移权威副本或空阶段目录。

共享工程公约见主仓 [standards.md](../../zhuzhao/docs/standards.md)；Phase 4 工程来源见[前端设计](../../zhuzhao/docs/phase4/01-frontend-design.md)，跨仓 Phase 5/6 规划分别见[Phase 5](../../zhuzhao/docs/phase5/README.md)、[Phase 6](../../zhuzhao/docs/phase6/README.md)。已批准的未来设计仍需实施与验证，不能据文档中的勾选推断已交付。

Phase5已验收并合入main；重规划统一以主仓[规划总账](../../zhuzhao/docs/review/planning-backlog.md)维护任务、依赖和排期。本仓维护UI设计与逐页验收，不另建相互冲突的日历或工期估算。平台定位是数据聚合与安全全生命周期管控；模型、专业安全与知识能力以已有服务接入消费为主，平台特有领域Agent可做受控配置，前端不建设模型部署或通用Agent开发平台。

`doc/` 是本地参考；执行卡、原日志、截图和临时验证产物留在 `.codex/` 等忽略目录。正式报告已迁至 `review/reports/`，旧 `deliverables/`、`outputs/`、`audit-reports/` 不再是受控文档入口。

当前可看[六视图原型](design/prototypes/lifecycle-workspace.html)并按[施工合同](design/frontend-implementation-contract.md)评审；审计阶段、已确认与owner待决统一回[规划收口](../../zhuzhao/docs/review/planning-closeout.md)。
