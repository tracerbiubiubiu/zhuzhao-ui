# zhuzhao-ui

zhuzhao（Go 模块化单体 IAM + 工单系统）的前端控制台。**全部页面唯一家**（单仓单 SPA）：system（用户/角色/菜单/组织）、ticket（工单）、task（任务管理）、al（名单，走网关反代 `/al/api/v1`）、audit（审计）。

## 状态

**W3 system 域已交付**（2026-09-28）——四张管理页全功能化（用户/角色[AssignMenus check-strictly+乐观锁]/菜单只读树/组织两面）+ 三范例页（ProTable 列表/表单乐观锁/树管理）+ 个人中心页 + 「我的组织」自服务面（名册+owner 委托控件，后端 GET /user/orgs+GET /orgs/members/list 两自服务端点随批交付）+ vue-query/ProTable 基建 + codegen 类型接线。E2E 9 spec（S1/S2/S3–S7/FE3）打真实三栈全绿，单测 85 例。W2 遗留欠账（个人中心/三范例页）随本波全部清零。下一波 P4-W4 ticket 域。

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
pnpm test        # Vitest（buildRoutes/tokenStorage/请求层 单测）
pnpm build       # 生产构建
pnpm audit --prod # npm 供应链
pnpm test:e2e    # Playwright（S1/S2/FE3——运行前提见下）
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
