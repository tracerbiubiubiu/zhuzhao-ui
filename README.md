# zhuzhao-ui

[![CI](https://github.com/tracerbiubiubiu/zhuzhao-ui/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tracerbiubiubiu/zhuzhao-ui/actions/workflows/ci.yml?query=branch%3Amain)

zhuzhao（Go 模块化单体 IAM + 工单系统）的前端控制台。**全部页面唯一家**（单仓单 SPA）：system（用户/角色/菜单/组织）、ticket（工单）、task（任务管理）、al（名单，走网关反代 `/al/api/v1`）、audit（审计）。

## 状态

**Phase 4 完成定义达成（2026-09-29 收官，四轮审计后 2026-09-30 终态）**——主仓 02 §5.2 四条终验全绿：四波（W2 壳层/W3 system/W4 ticket/W5 三域）+P4-9 部署件+穿插池点名五件（通知/字典/导出/验证码/P2 小件）+加成交付（PAT/P4-8 四件套/cron 收归 B-1 根治）。四轮审计 31 项处置：24 解决（P1-1/P1-2/P1-3/P3-8 于 10-01、P3-5/6/7/11 于 10-03 快赢批、P2-7/11/12 用户价值批、P2-8/9/10 卫生批闭环）/ 3 设计取舍 / 3 遗留待办 / 1 撤回——逐项基线见 `outputs/审计复检报告-四轮审计全量-2026-10-01.md`（E2E 断言加固为真数据级）。E2E 18 spec / 19 用例打真实栈全绿（W5 场景五栈），Vitest 13 文件 / 105 用例。i18n 英文面显式暂不启用（2026-10-02 拍板，触发器=英文用户出现；locales 为预留基建——详见主仓 02 §5.4）。

## 分支纪律

**不直接在 main 开发**：main 只收合入。建设期每 Wave 开短分支（如 `p4-w3-system`），六件门禁（见上）全绿后合入即删。对齐主仓 standards §12.7 单主干精神。

## 设计文档（不随本仓，指回主仓）

- **工程设计 SSOT**：`zhuzhao/docs/phase4/01-frontend-design.md`（技术栈/壳层四件/状态分界/范例页/门禁/里程碑）
- 实施计划：`zhuzhao/docs/phase4/02-implementation-plan.md`（P4-W2..W5 + 穿插池）
- 场景与测试矩阵：`zhuzhao/docs/phase4/03-scenarios-and-tests.md`
- 权限矩阵：`zhuzhao/docs/review/12-b13-permission-matrix-2026-09-26.md`

> 口径：Phase 文档统一住主仓 `zhuzhao/docs/`（文档驱动约定）；本仓只放**随仓操作文档**（AGENTS.md + 构建说明）。审计/复检类时点报告住 `outputs/`，命名 `<类型>-<YYYY-MM-DD>.md`。

## 技术栈（已拍板）

Vue 3 + TypeScript strict + Vite 8 ｜ Element Plus 2.14 ｜ Pinia 4（客户端态）+ vue-query（服务端态，W3 接入）｜ Playwright 1.63（E2E）｜ 类型生成 swagger2openapi + openapi-typescript ｜ 底座 = vue-element-plus-admin v3 种子拷入（degit 不 fork；上游锚点 `.seed-commit`）

## 前端门禁

```bash
pnpm lint        # ESLint（纯检查；修复用 pnpm lint:fix）
pnpm typecheck   # vue-tsc --noEmit（codegen 类型**部分接线** 4/14——漂移仅接线面报错，与 AGENTS 同口径）
pnpm test        # Vitest（动态路由/请求层/keep-alive 防漂移——13 文件 / 105 用例）
pnpm build       # 生产构建
pnpm audit --prod # npm 供应链
pnpm test:e2e    # Playwright（S1–S8/S10/S12/FE3/W4·W5/P4 穿插池——18 spec / 19 用例，运行前提见下）
```

### E2E 运行前提（打标准三栈，不用 stub）

```bash
# ① 后端栈：主仓 dev PG/Redis + app（宿主进程）
cd ../zhuzhao && bash scripts/dev-stack.sh up
INTERNAL_JOBS_SK=dev-e2e-callback-sk make dev        # app @33333
# ② activelist 上游（W5 al 场景需四栈）：PG + 服务（验签 SK 须与主仓 gateway.sk 一致）
cd ../activelist && docker compose -f deploy/compose.dev.yaml up -d
ACTIVELIST_PG_PORT=15432 ACTIVELIST_CALLER_ZHUZHAO_SK=dev-gateway-sk go run ./cmd/apiserver  # @8080
#    + 主仓 configs/config.yaml 的 gateway target 需指向 127.0.0.1:8080（默认 activelist:8080
#    为 compose 网络主机名——宿主形态改后跑，勿提交；compose 形态天然可达免改）
# ③ taskrunner 上游（W5 task 场景需五栈；Redis 复用 dev 栈 6379、SQLite 零依赖）
cd ../taskrunner && TASKRUNNER_HTTP_ADDR=:8081 TASKRUNNER_REDIS_PASSWORD=zhuzhao_dev \
  TASKRUNNER_CALLER_ZHUZHAO_SK=<sk> TASKRUNNER_SELF_SK=<sk> \
  TASKRUNNER_CALLBACK_TARGET_URL=http://127.0.0.1:33333/internal/jobs/callback go run ./cmd/taskrunner
#    + ① 的 make dev 带 env：TASKRUNNER_BASE_URL=http://127.0.0.1:8081 TASKRUNNER_SK=<同上 sk>
# ④ 前端 dev server（vite @4000，/api、/al 反代 33333）由 Playwright webServer 自动拉起
cd ../zhuzhao-ui && pnpm test:e2e
```

globalSetup 幂等建号（admin 凭据闭环首跑改密、operator/viewer 预设绑定、S1 重置）——可无限重放；凭据可用 `E2E_ADMIN_PASSWORD` 等 env 覆盖。

### 类型生成（codegen）

```bash
# 主仓侧改动 API 后：先 make swag（主仓），再：
pnpm codegen     # scripts/codegen.sh：swagger 2.0 → openapi 3.0 → src/api/__generated__/
```

生成物随仓提交、不手改（01 §3.3 纪律）；主仓路径非 `../zhuzhao` 时设 `ZHUZHAO_REPO`。
