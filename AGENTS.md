# AGENTS.md — zhuzhao-ui 前端协作协议

> 本文件对每次在本仓库工作的 AI/协作方生效。设计 SSOT 在主仓 `zhuzhao/docs/phase4/01-frontend-design.md`。

## 前端门禁（每批交付前必跑）

```bash
pnpm lint          # ESLint（纯检查；自动修复用 pnpm lint:fix，修复后重跑 lint）
pnpm typecheck     # vue-tsc --noEmit（codegen 类型**部分接线**：入参仅 4/14 api 文件引 __generated__（user/role/profile/selfService）、出参全手写——漂移仅接线面编译期报错，勿视为全量守卫；改 API 形状后先 pnpm codegen，补接线随域渐进）
pnpm test          # Vitest（动态路由解析/请求层单飞刷新/keep-alive 防漂移断言——15 文件 / 116 用例）
pnpm audit --prod  # npm 供应链（对称 Go 侧 govulncheck；镜像源无 audit 端点时加 --registry=https://registry.npmjs.org）
pnpm build         # 产物构建
pnpm test:e2e      # Playwright（S1–S8/S10/S12/S16/FE3/W4·W5/P4 穿插池——19 spec / 22 用例；打真实栈不用 stub——W5 需 activelist/taskrunner 上游，前提见下）
```

**E2E 运行前提**：主仓 `bash scripts/dev-stack.sh up`（dev PG/Redis）+ `INTERNAL_JOBS_SK=xxx make dev`（app @33333）；W5 场景另需两上游：activelist（compose.dev PG@15432 + `ACTIVELIST_CALLER_ZHUZHAO_SK=dev-gateway-sk go run ./cmd/apiserver`@8080 + 主仓 gateway target 暂改 127.0.0.1:8080 勿提交）+ taskrunner（@8081：TASKRUNNER_REDIS_PASSWORD=zhuzhao_dev + CALLER_ZHUZHAO_SK/SELF_SK + CALLBACK_TARGET_URL=http://127.0.0.1:33333/internal/jobs/callback，app 侧带 TASKRUNNER_BASE_URL/TASKRUNNER_SK）；vite dev server 由 Playwright webServer 自动拉起。globalSetup 幂等建号（admin 凭据闭环/operator·viewer 预设/S1 重置），可无限重放。浏览器下载被墙时：`PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright pnpm exec playwright install chromium`。

**纪律**：门禁不全绿不得标记完成；E2E 打真后端（菜单可见性/权限码必须打真实数据）；CI（`.github/workflows/ci.yml`）跑 lint/typecheck/build/test——E2E 与 Go 仓 acceptance 同口径走本地人工验收；**推送后核实 CI run 转绿才算交付闭环**（`gh run list`/`gh run watch`——本地绿≠CI 绿：CI 单仓 checkout/全新安装等环境差曾致挂（2026-10-02 三连挂教训），README badge 仅为被动入口，跨仓依赖的测试改动合入前先过一遍「CI 无同级仓」假设）。

**i18n 口径（2026-10-02 拍板，主仓 02 §5.4 检查点结论文）**：英文面**显式暂不启用**——触发器=外部协作者/英文用户出现（未命中）。`src/locales/` 骨架与 en 词包为**预留基建勿删**（含 `login.*Placeholder` 闲置键）；新页面文案直接中文，勿新增半成品键。翻案时方案见 02 §5.4（key 映射层），需连带迁移 `e2e/ui.ts` 登录锚点（19 spec 依赖）。

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

## 文档规范（2026-10-01 统一，防漂移）

本仓全部随仓文档遵循同一套口径：

- **语言**：中文（代码标识符/命令/路径除外）；子模块 README 同口径
- **日期**：一律 `YYYY-MM-DD`
- **标题**：H1 = `# <文档名> — <一句话定位>`，章节用 H2、不编号
- **计数口径**（随实际增长同步，禁止两处不同值）：E2E「19 spec / 22 用例」、单测「15 文件 / 116 用例」、E2E 范围串「S1–S8/S10/S12/S16/FE3/W4·W5/P4 穿插池」、门禁统称「六件门禁」（lint/typecheck/test/audit/build/test:e2e）
- **存放**：Phase 设计文档住主仓 `zhuzhao/docs/`（SSOT）；本仓放操作文档（README/AGENTS/子模块说明）；时点报告住 `deliverables/`，命名 `<topic-kebab>-<YYYY-MM-DD>.md`（对齐主仓 deliverables/ 惯例）
- **计数/状态声明须与实测一致**：改 E2E/单测数量或修复状态时，同批更新 README 与 AGENTS 两处；「全部修复」类表述须有逐项证据（deliverables/ 报告为凭）

## 前端 UI 规范（2026-10-08 制定）

**新增/改动任何页面前必读 [docs/frontend-standard.md](docs/frontend-standard.md)**——铁律：**页面不动，所有页面锁定视口，一切滚动条都在内部元素上**（列表页=表格内滚+分页钉底；内容页=内容区容器内滚）。文档含三种页面骨架配方、表格列宽（内容列 `minWidth`，全固定宽=宽屏右侧死区）、分页口径（ProTable 统一 `[10,20,50,100]` 默认 20；cursor/面板型见文档）、滚动归属（Backtop 盯 `.v-app-view`）、七个踩坑记录与新增页 checklist。

## 前端契约速查（详细见主仓 01 号）

> 本节为**主仓 `docs/standards.md` §3（API 设计约定）的前端消费摘编**——信封/方法/int64/时间/错误码等公约以 standards 为 SSOT（2026-10-01 起本仓列入其适用范围；date-only 字段 `YYYY-MM-DD` 例外与「ID 数组元素发送侧仍 string」口径见其 §3-12）。

- 信封：`{code:0, message, data, request_id}`——按 HTTP 状态分流（code≠0 恒非 2xx）
- 登录：`employee_no` + `password` + `device_id`（浏览器级 UUID 必传）
- 401 分码：20002 过期→静默刷新 / 20003 无效→跳登录 / 5xx 不清会话；403+20007→跳改密页不清会话
- 权限码：`button:{permission}`（非 menus.code）+ `route:{path}`
- int64 全仓 string 序列化（codegen 产物天然 string）
- 菜单：`GET /user/menus` → `data:{menus:[...]}` / `GET /user/permissions` → `data:{permissions:[...]}`
