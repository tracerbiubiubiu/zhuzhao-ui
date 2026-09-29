# AGENTS.md — zhuzhao-ui 前端协作协议

> 本文件对每次在本仓库工作的 AI/协作方生效。设计 SSOT 在主仓 `zhuzhao/docs/phase4/01-frontend-design.md`。

## 前端门禁（每批交付前必跑）

```bash
pnpm lint          # ESLint（纯检查；自动修复用 pnpm lint:fix，修复后重跑 lint）
pnpm typecheck     # vue-tsc --noEmit（codegen 类型**部分接线**：入参仅 4/14 api 文件引 __generated__（user/role/profile/selfService）、出参全手写——漂移仅接线面编译期报错，勿视为全量守卫；改 API 形状后先 pnpm codegen，补接线随域渐进）
pnpm test          # Vitest（动态路由解析/请求层单飞刷新/keep-alive 防漂移断言）
pnpm audit --prod  # npm 供应链（对称 Go 侧 govulncheck；镜像源无 audit 端点时加 --registry=https://registry.npmjs.org）
pnpm build         # 产物构建
pnpm test:e2e      # Playwright（S1–S8/S10/S12/FE3/W4·W5/P4 穿插池 19 spec；打真实栈不用 stub——W5 需 activelist/taskrunner 上游，前提见下）
```

**E2E 运行前提**：主仓 `bash scripts/dev-stack.sh up`（dev PG/Redis）+ `INTERNAL_JOBS_SK=xxx make dev`（app @33333）；W5 场景另需两上游：activelist（compose.dev PG@15432 + `ACTIVELIST_CALLER_ZHUZHAO_SK=dev-gateway-sk go run ./cmd/apiserver`@8080 + 主仓 gateway target 暂改 127.0.0.1:8080 勿提交）+ taskrunner（@8081：TASKRUNNER_REDIS_PASSWORD=zhuzhao_dev + CALLER_ZHUZHAO_SK/SELF_SK + CALLBACK_TARGET_URL=http://127.0.0.1:33333/internal/jobs/callback，app 侧带 TASKRUNNER_BASE_URL/TASKRUNNER_SK）；vite dev server 由 Playwright webServer 自动拉起。globalSetup 幂等建号（admin 凭据闭环/operator·viewer 预设/S1 重置），可无限重放。浏览器下载被墙时：`PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright pnpm exec playwright install chromium`。

**纪律**：门禁不全绿不得标记完成；E2E 打真后端（菜单可见性/权限码必须打真实数据）；CI（`.github/workflows/ci.yml`）跑 lint/typecheck/build/test——E2E 与 Go 仓 acceptance 同口径走本地人工验收。

## 类型生成（codegen，随契约批）

后端改 API 形状时：主仓 `make swag` → 本仓 `pnpm codegen`（swagger2openapi 2.0→3.0 + openapi-typescript 7.13 → `src/api/__generated__/`）。**生成物不手改、随仓提交**；主仓路径非 `../zhuzhao` 时设 `ZHUZHAO_REPO`。

## 提交规范

- 中文提交信息，描述改动+原因+验证证据
- 分支：建设期每 Wave 开短分支（p4-w2-shell…），门禁绿后合入 main 即删——本仓 main 即集成分支（新仓无 Phase 3 稳定态需隔离，**对主仓 02 §5.1 phase4 拓扑的显式豁免**，2026-09-28 注记；主仓侧同日已注记）

## 变更评审三节（前端适配）

每次交付附：
1. **改动摘要**：哪些文件/组件、为什么改、核心逻辑（≤10 行）
2. **影响面**：涉及的路由/页面/组件/store/共享封装
3. **验证证据**：跑了哪些门禁、结果、未覆盖路径

## 前端契约速查（详细见主仓 01 号）

- 信封：`{code:0, message, data, request_id}`——按 HTTP 状态分流（code≠0 恒非 2xx）
- 登录：`employee_no` + `password` + `device_id`（浏览器级 UUID 必传）
- 401 分码：20002 过期→静默刷新 / 20003 无效→跳登录 / 5xx 不清会话；403+20007→跳改密页不清会话
- 权限码：`button:{permission}`（非 menus.code）+ `route:{path}`
- int64 全仓 string 序列化（codegen 产物天然 string）
- 菜单：`GET /user/menus` → `data:{menus:[...]}` / `GET /user/permissions` → `data:{permissions:[...]}`
