# UI 文档 — 按任务选择阅读路径

> **用途**：按角色和任务定位当前操作、目标设计或历史证据。**范围/状态**：本页仅导航，文档与原型不代表已实现。**权威**：实施状态和排期回主仓，各类验证按本仓指南；核对日期2026-11-13。

本仓维护 zhuzhao 控制台的操作步骤、前端设计和正式报告。机器协作要求见根 [AGENTS.md](../AGENTS.md)，五仓分类、命名、时点与引用约定见主仓[文档维护约定](../../zhuzhao/docs/documentation.md)。

## 按角色选择阅读路径

- **所有者评审**：先看主仓[规划收口](../../zhuzhao/docs/review/planning-closeout.md)，确认已讨论、已实现与待细化的区别；每批按[三节短审阅卡](../../zhuzhao/docs/phase6/implementation-handoff.md#单维护者短审阅卡)看行为、权限/数据影响及证据。评审页面方案时再看[施工合同](design/frontend-implementation-contract.md)和[六视图原型](design/prototypes/lifecycle-workspace.html)，原型范围与限制见[原型说明](design/prototypes/README.md)。
- **开发与测试**：按下节找到当前指南/规范，再进入对应目标合同；当前获准批继续测试先行、因目标行为跑红、实现到绿。真实门禁及mock/contract/real职责以[测试指南](guides/testing.md)为准，分档规则尚未因文档整理启用。
- **运维与联调**：先确认[开发与联调](guides/development.md)中的服务/配置归属，再读[部署](ops/deployment.md)和[发布](ops/releasing.md)，核准确构建、上游及运行时反代；恢复或回退按对应操作手册留证。

## 我现在要做什么

- **第一次启动或联调**：先读[开发与联调](guides/development.md)，确认后端/上游在位，再读[请求链路](design/request.md)。
- **提交一个改动**：读[贡献指南](contributing.md)，按工作树安装 hooks、检查真实待推窗口，交付附摘要/影响/证据。
- **新增或修改页面**：先读当前[UI 设计约束](design/frontend-ui.md)和[页面与组件开发](guides/components.md)，CRUD/表单控制器见[hooks](guides/hooks.md)。涉及后续改造时再核[全站重设计](design/frontend-redesign.md)、[逐页清单](design/frontend-pages.json)及本批施工合同；目标方案的替代规则随实施同批生效。
- **新增测试或解释失败**：读[测试指南](guides/testing.md)，分清大量合成mock、契约校验、真实栈关键链路和视觉/键盘检查各自能证明什么。
- **构建、部署或回退**：依次读[部署](ops/deployment.md)和[发布](ops/releasing.md)，区分构建参数与运行时反代配置。
- **核查旧结论**：从[审查入口](review/README.md)沿基线→修复→复验查报告；其中旧数字和失败仍属于原时点。

## 按文档效力选择入口

- **当前实现与操作**：[设计](design/README.md)区分现行规范和目标合同，[指南](guides/README.md)给执行步骤，[运维](ops/README.md)给部署验证和回退。只有实际代码、配置和对应收据能证明运行行为。
- **目标设计与实施计划**：全站范围/旅程、施工合同和离线原型由本仓维护；当前任务、依赖、估算统一回主仓[规划总账](../../zhuzhao/docs/review/planning-backlog.md)，全项目路线见[roadmap](../../zhuzhao/docs/roadmap.md)。本仓不另建日历或工期，新增能力与既有页面改造分别验收。
- **验收历史与追溯**：[审查](review/README.md)按基线→修复→复验查正式时点报告。旧数字、失败、重试与NOT_RUN保留当时含义，不外推到新候选、远端CI或生产部署。

## 跨仓权威与材料归属

共享工程公约见主仓 [standards.md](../../zhuzhao/docs/standards.md)。Phase 4 工程来源见[前端设计](../../zhuzhao/docs/phase4/01-frontend-design.md)，[Phase 5](../../zhuzhao/docs/phase5/README.md)保留已验收并合main的阶段记录，[Phase 6](../../zhuzhao/docs/phase6/README.md)是后续近期切片；不能从目录名或勾选推断实现。当前仅整理设计导航，未启动新业务开发。

平台定位是数据聚合与安全全生命周期管控。模型、专业安全与知识能力以已有服务接入消费为主，平台特有领域Agent可做受控配置；前端不建设模型部署或通用Agent开发平台，也不直连企业数据API。仅建立有内容的文档分类，不另造API/迁移权威副本或空阶段目录。

`doc/`是本地参考；执行卡、原日志、截图和临时验证产物留在`.codex/`等忽略目录。正式报告统一在`review/reports/`，旧`deliverables/`、`outputs/`、`audit-reports/`不再是受控入口。文档、代码、mock及示例继续遵守公司信息隔离规则。
