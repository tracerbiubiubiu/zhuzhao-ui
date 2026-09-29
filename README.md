# zhuzhao-ui

zhuzhao（Go 模块化单体 IAM + 工单系统）的前端控制台。**全部页面唯一家**（单仓单 SPA）：system（用户/角色/菜单/组织）、ticket（工单）、task（任务管理）、al（名单，走网关反代 `/al/api/v1`）、audit（审计）。

## 状态

**P4-W4 ticket 域进行中**（2026-09-29 快照）——已交付两批：开工首批=工单列表页（ProTable+状态筛选）+ 详情/发起静态路由骨架（参数路由前缀豁免）+ W4 冒烟；发起表单批=动态字段渲染器（七字段类型+required/regex 预检）+ 组织双源下拉（`GET /user/orgs` 自服务优先、管理面兜底）+ S8 E2E（API 造类型→UI 预检→提交跳详情）。剩余：详情完整批（评论/备注/关联/流转四操作）、类型/字段/模板三件套、后端随批件（`assignee=me` 点亮工作台待办卡+列表姓名回填防 N+1）。此前 W2 壳层、W3 system 域（四管理页+三范例页+个人中心+「我的组织」）已全部交付。E2E 11 spec（S1–S8/FE3/W4 冒烟）打真实三栈全绿，单测 87 例。

## 分支纪律

**不直接在 main 开发**：main 只收合入。建设期每 Wave 开短分支（如 `p4-w3-system`），全量前端门禁（vue-tsc/ESLint/Vitest + pnpm audit）绿后合入即删。对齐主仓 standards §12.7 单主干精神。

## 设计文档（不随本仓，指回主仓）

- **工程设计 SSOT**：`zhuzhao/docs/phase4/01-frontend-design.md`（技术栈/壳层四件/状态分界/范例页/门禁/里程碑）
- 实施计划：`zhuzhao/docs/phase4/02-implementation-plan.md`（P4-W2..W5 + 穿插池）
- 场景与测试矩阵：`zhuzhao/docs/phase4/03-scenarios-and-tests.md`
- 权限矩阵：`zhuzhao/docs/review/12-b13-permission-matrix-2026-09-26.md`

> 口径：Phase 文档统一住主仓 `zhuzhao/docs/`（文档驱动约定）；本仓只放**随仓操作文档**（AGENTS.md + 构建说明）。

## 技术栈（已拍板）

Vue 3 + TypeScript strict + Vite 8 ｜ Element Plus 2.14 ｜ Pinia 4（客户端态）+ vue-query（服务端态，W3 接入）｜ Playwright 1.63（E2E）｜ 类型生成 swagger2openapi + openapi-typescript ｜ 底座 = vue-element-plus-admin v3 种子拷入（degit 不 fork；上游锚点 `.seed-commit`）

## 前端门禁

```bash
pnpm lint        # ESLint（纯检查；修复用 pnpm lint:fix）
pnpm typecheck   # vue-tsc --noEmit（codegen 类型漂移在此报错）
pnpm test        # Vitest（动态路由/请求层/keep-alive 防漂移 单测 87 例）
pnpm build       # 生产构建
pnpm audit --prod # npm 供应链
pnpm test:e2e    # Playwright（S1–S8/FE3/W4 冒烟 11 spec——运行前提见下）
```

### E2E 运行前提（打标准三栈，不用 stub）

```bash
# ① 后端栈：主仓 dev PG/Redis + app（宿主进程）
cd ../zhuzhao && bash scripts/dev-stack.sh up
INTERNAL_JOBS_SK=dev-e2e-callback-sk make dev        # app @33333
# ② 前端 dev server（vite @4000，/api、/al 反代 33333）由 Playwright webServer 自动拉起
cd ../zhuzhao-ui && pnpm test:e2e
```

globalSetup 幂等建号（admin 凭据闭环首跑改密、operator/viewer 预设绑定、S1 重置）——可无限重放；凭据可用 `E2E_ADMIN_PASSWORD` 等 env 覆盖。

### 类型生成（codegen）

```bash
# 主仓侧改动 API 后：先 make swag（主仓），再：
pnpm codegen     # scripts/codegen.sh：swagger 2.0 → openapi 3.0 → src/api/__generated__/
```

生成物随仓提交、不手改（01 §3.3 纪律）；主仓路径非 `../zhuzhao` 时设 `ZHUZHAO_REPO`。
