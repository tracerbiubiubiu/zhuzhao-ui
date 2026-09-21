# zhuzhao-ui

zhuzhao（Go 模块化单体 IAM + 工单系统）的前端控制台。**全部页面唯一家**（单仓单 SPA）：system（用户/角色/菜单/组织）、ticket（工单）、task（任务管理）、al（名单，走网关反代 `/al/api/v1`）、audit（审计）。

## 状态

尚未开工（Phase 4 规划完毕，启动波 = P4-W2 前端壳层）。本仓当前仅 LICENSE + 本 README。

## 分支纪律

**不直接在 main 开发**：main 只收合入。建设期每 Wave 开短命分支（如 `p4-w2-shell`），全量前端门禁（vue-tsc/ESLint/Vitest/Playwright + pnpm audit）绿后合入即删；种子拷入也在首个 wave 分支上进行。对齐主仓 standards §12.7 单主干精神。

## 设计文档（不随本仓，指回主仓）

- **工程设计 SSOT**：`zhuzhao/docs/phase4/01-frontend-design.md`（技术栈/壳层四件/状态分界/范例页/门禁/里程碑）
- 实施计划：`zhuzhao/docs/phase4/02-implementation-plan.md`（P4-W2..W5 + 穿插池）
- 规划素材：`zhuzhao/docs/phase4/00-planning-inventory.md`

> 口径：Phase 文档统一住主仓 `zhuzhao/docs/`（文档驱动约定）；本仓只放**随仓操作文档**——W2 首日将落 AGENTS.md（前端门禁/提交规范/变更评审三节适配）与构建说明。

## 技术栈（已拍板）

Vue 3 + TypeScript + Vite ｜ Element Plus ｜ Pinia（客户端态）+ vue-query（服务端态）｜ 底座 = vue-element-plus-admin v3 种子拷入（degit，不 fork；详见主仓 01 号 §9.1）
