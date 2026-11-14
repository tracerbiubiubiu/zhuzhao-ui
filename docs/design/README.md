# 前端设计 — 当前规范与目标合同的阅读入口

> **用途**：查现行UI规则、机制及后续改造合同。**范围/状态**：现行规范与未实施目标分列。**权威**：本仓规范及对应目标合同，准确实施状态回主仓；核对日期2026-11-13。

## 当前实现与在效规范

先读[UI设计规范](frontend-ui.md)，了解当前视口、滚动、表格、交互、会话与内容安全合同；实现页面查[组件指南](../guides/components.md)。修改认证/响应/错误处理前读[请求链路](request.md)，避免在页面重造刷新与会话副作用。部署步骤和时点审计分别回[总入口](../README.md)选择运维或审查路径。

## 目标设计与代表样板

- **全站范围**：[全站重设计](frontend-redesign.md)核对了27个路由视图和9组共享组件，记录12组静态发现、代表页面方案、mock/契约/真实栈分工及验收标准；[逐页清单](frontend-pages.json)保留每页旅程、证据、任务与待验状态，另列4类未来AI页面。清单中的`future_business_journeys`按P7/P8/P9列最薄首期与增强条件，不是已建页面。
- **页面与组件施工**：[施工合同](frontend-implementation-contract.md)细化代表工作区、组件与失败/权限语义；[原型说明](prototypes/README.md)给离线验证范围，[六视图原型](prototypes/lifecycle-workspace.html)供评审。原型未接Vue/真实API，不代替27页迁移或真实角色验收；设备首期已确认仅人工登录。
- **双模式最小接线**：[施工合同对应章节](frontend-implementation-contract.md#独立模式与企业统一认证的最小接线)及逐页清单为现有登录、账号、角色和菜单页补独立模式/企业adapter候选。E01-UAA-P/R在相应企业激活前交功能、来源只读和拒写反馈，U06后续统一视觉；尚未实现或真实联调，企业身份/授权权威在主仓，前端不保存企业秘密或直调企业数据API。
- **全栈一致性与能力消费**：主仓[生态一致性合同](../../../zhuzhao/docs/design/ecosystem-consistency-contract.md)定义统一内容、允许差异和验证；[能力调用合同](../../../zhuzhao/docs/design/capability-invocation-contract.md)定义核心/插件的共同受权执行路径。UI按[最小接线](frontend-implementation-contract.md#所有能力的前端消费与最小接线)复用tokens、Element Plus、ProTable/FilterBar，U02/U07先样板、U03–U06逐页推广；新增能力按钮、权限反馈、运行与结果同批交付。

## 生效、实施与验收边界

Phase5已验收并合入main，后续主线见[全项目路线](../../../zhuzhao/docs/roadmap.md)，唯一排期/依赖见[规划总账](../../../zhuzhao/docs/review/planning-backlog.md)；本仓不复制工期。设计中已拍未做的能力继续标目标，报告只追溯其时点。

现行规范解释当前代码；重设计的替代规则只在对应实施任务中同批更新规范、源码与验证后生效。当前formatter/profile、推荐tokens全站推广、页面改造及三类调用闭环均未实现，不用lint或离线原型证明完成。

测试先行、守卫验牙、真实六件门禁和mock/contract/real分列继续按[测试指南](../guides/testing.md)执行；分档门禁尚未因本页整理启用。共享API/IAM与阶段合同回主仓，不在本目录另建接口或权限真值。
