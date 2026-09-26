# zhuzhao-ui

zhuzhao（Go 模块化单体 IAM + 工单系统）的前端控制台。**全部页面唯一家**（单仓单 SPA）：system（用户/角色/菜单/组织）、ticket（工单）、task（任务管理）、al（名单，走网关反代 `/al/api/v1`）、audit（审计）。

## 状态

**W2 壳层已交付**（2026-09-27）——壳层四件（守卫/请求层/会话管理/权限三件套）+ 登录/改密/首页 + system 四占位页 + vitest 单测基建。下一波 P4-W3 system 域。

## 分支纪律

**不直接在 main 开发**：main 只收合入。建设期每 Wave 开短分支（如 `p4-w3-system`），全量前端门禁（vue-tsc/ESLint/Vitest + pnpm audit）绿后合入即删。对齐主仓 standards §12.7 单主干精神。

## 设计文档（不随本仓，指回主仓）

- **工程设计 SSOT**：`zhuzhao/docs/phase4/01-frontend-design.md`（技术栈/壳层四件/状态分界/范例页/门禁/里程碑）
- 实施计划：`zhuzhao/docs/phase4/02-implementation-plan.md`（P4-W2..W5 + 穿插池）
- 场景与测试矩阵：`zhuzhao/docs/phase4/03-scenarios-and-tests.md`
- 权限矩阵：`zhuzhao/docs/review/12-b13-permission-matrix-2026-09-26.md`

> 口径：Phase 文档统一住主仓 `zhuzhao/docs/`（文档驱动约定）；本仓只放**随仓操作文档**（AGENTS.md + 构建说明）。

## 技术栈（已拍板）

Vue 3 + TypeScript strict + Vite 8 ｜ Element Plus 2.14 ｜ Pinia 4（客户端态）+ vue-query（服务端态，W3 接入）｜ 底座 = vue-element-plus-admin v3 种子拷入（degit 不 fork；上游锚点 `.seed-commit`）

## 前端门禁

```bash
pnpm lint        # ESLint
pnpm typecheck   # vue-tsc --noEmit
pnpm test        # Vitest（buildRoutes/tokenStorage/请求层 单测）
pnpm build       # 生产构建
pnpm audit --prod # npm 供应链
```
