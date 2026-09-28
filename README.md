# zhuzhao-ui

zhuzhao（Go 模块化单体 IAM + 工单系统）的前端控制台。**全部页面唯一家**（单仓单 SPA）：system（用户/角色/菜单/组织）、ticket（工单）、task（任务管理）、al（名单，走网关反代 `/al/api/v1`）、audit（审计）。

## 状态

**W2 壳层已交付 + 出口闭合**（2026-09-27）——壳层四件（守卫/请求层/会话管理/权限三件套）+ 登录/改密/首页 + system 四占位页 + vitest 单测基建 + **出口三件**：Playwright E2E（S1 强制改密/S2 工作台冒烟/FE3 viewer 只读，打标准三栈）+ codegen 类型链（`pnpm codegen`）+ CI（lint/typecheck/build + test）。出口后加固三批（2026-09-28）：守卫三段分流 + `/session-error` 可重试页、W3 开工前小修批（hasAny 前缀/keep-alive/错误提示层/useCrud 分页契约）、图标映射表 + 403 页 + errorHandler + noopener（当前 75 例）。**三范例页与个人中心页移入 W3 首批补交付**（主仓 01 §8-W2 修订记录）。下一波 P4-W3 system 域。

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
