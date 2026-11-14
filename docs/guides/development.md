# 开发与联调 — 启动前端和真实服务链

本篇用于本地开发与 E2E 准备。运行命令前确认各服务没有其他会话在独占验证；不要为了联调覆盖别人的进程、数据库或缓存。部署容器的流程见[部署指南](../ops/deployment.md)。

## 安装与日常开发

在 UI 仓根目录，按 [.nvmrc](../../.nvmrc) 选择 Node.js，使用 [package.json](../../package.json) 的 pnpm 固定版本：

```bash
npm install --global "$(node -p 'require("./package.json").packageManager')"
pnpm install --frozen-lockfile
pnpm hooks
pnpm dev
```

Node 26 不再附带 Corepack，以上命令直接安装仓库钉定的 pnpm；不依赖宿主旧版 Corepack。升级基线、保留版本与验证边界见[本次升级报告](../review/reports/version-modernization-2026-11-12.md)。

Vite 使用 base 模式，监听 `http://127.0.0.1:4000`，`/api`、`/al` 代理到宿主 app `33333`。预期浏览器可加载登录页；真正登录/菜单/业务还需要下面的服务。客户端态由 Pinia 管、服务端态由 vue-query 管，页面不另造认证或请求栈。依赖准确版本以 package.json/lockfile 为准；底座种子出处保存在 [.seed-commit](../../.seed-commit)。

## 真实栈前置条件

以下是现有关键真实栈E2E的准备步骤，该发现范围不换成stub；大量合成mock用于开发、页面状态与视觉，分层合同见[测试指南](testing.md)。基础服务为PG/Redis/app，活动列表和任务场景另需activelist/taskrunner。以下示例均为开发配置，每段在标明的仓库根目录、各自终端运行；密钥只在本地开发匹配，不用于生产。

先在 **zhuzhao** 根目录启动 PG/Redis，并显式完成迁移与所需角色/菜单绑定种子，顺序以主仓 [runbook](../../../zhuzhao/docs/ops/runbook.md) 为准。然后启动 app：

```bash
bash scripts/dev-stack.sh up
TASKRUNNER_BASE_URL=http://127.0.0.1:18080 TASKRUNNER_SK=dev-taskrunner-sk   INTERNAL_JOBS_SK=dev-callback-sk make dev
```

app 默认 `33333`；宿主 `make dev` 自动设置 `GATEWAY_AL_TARGET=http://127.0.0.1:18081`。app 的 callback 验签密钥须与 taskrunner 的 `SELF_SK` 一致，app 的 taskrunner 出站密钥须与 taskrunner caller 密钥一致。

在 **activelist** 根目录，启动开发 PG 后启动服务：

```bash
docker compose -f deploy/compose.dev.yaml up -d
ACTIVELIST_PG_PORT=15432 ACTIVELIST_CALLER_ZHUZHAO_SK=dev-gateway-sk go run ./cmd/apiserver
```

服务监听默认 `18081`，caller 密钥要与主仓 gateway 的开发密钥相同。

在 **taskrunner** 根目录运行宿主开发形态：

```bash
TASKRUNNER_HTTP_ADDR=:18080 TASKRUNNER_REDIS_PASSWORD=zhuzhao_dev   TASKRUNNER_CALLER_ZHUZHAO_SK=dev-taskrunner-sk TASKRUNNER_SELF_SK=dev-callback-sk   TASKRUNNER_CALLBACK_TARGET_URL=http://127.0.0.1:33333/internal/jobs/callback   go run ./cmd/taskrunner
```

该例复用开发 Redis，taskrunner 宿主默认 SQLite；它不代表 compose 的 PostgreSQL 部署形态。服务配置与运行模式以各自仓库指南为准，不从 UI 目录启动 Go 服务，以免把 SQLite/data/logs 撒进 UI 仓。

回到 **UI** 根目录执行 `pnpm test:e2e`，Playwright 的 `webServer` 会启动或复用 `4000` 的 Vite，配置启用固定端口，不应静默换端口。预期看到场景通过/失败及本轮用例统计；重试、跳过、网络失败都须按实际报告，不用旧计数代替本次结果。

## 账号与独占纪律

`e2e/global-setup.ts` 幂等建立预设角色账号与凭据，管理员凭据支持 `E2E_ADMIN_PASSWORD` 等环境覆盖。运行态凭据 `e2e/.state.json` 被忽略，不入库。

E000001 是 superadmin 种子号，密码终态恒为 `admin12345`。人工和 agent 多账号验证一律使用专属 E000002+ 测试号；不得改 E000001。仅 acceptance/globalSetup 既定幂等例外流或主仓 break-glass 复原流程可以收敛其密码，账号权威见主仓 runbook §4。

共享开发 DB 上 E2E 必须独占运行；`workers=1` 只约束一轮内部，并不能隔离两个会话。运行前确认无他方 Playwright worker；已有 webServer 可以复用，但不得误杀他方进程。完整策略与失败预算见[测试指南](testing.md)。

浏览器下载受限时，在 UI 根目录显式选择可达下载源：

```bash
PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright pnpm exec playwright install chromium
```

## 类型生成与契约接线

后端改 API 形状后，先在 **zhuzhao** 根目录 `make swag`，再在 **UI** 根目录：

```bash
pnpm codegen
pnpm typecheck
```

[scripts/codegen.sh](../../scripts/codegen.sh) 读取主仓 `docs/swagger.json`，将 Swagger 2.0 转 OpenAPI 3.0，再生成 `src/api/__generated__/schema.d.ts`。主仓不在同级 `../zhuzhao` 时设 `ZHUZHAO_REPO`；生成物不手改，契约批同批生成并随仓提交。

类型目前**部分接线**：2026-11-06 按调用 request 的 API 文件口径，入参 user/role/profile/selfService/ticket 五文件，出参 storage 一文件，合计 6/16；ticket 仅 Create/Assign 两路。只有接线面有编译期漂移拦截，不能宣称覆盖全量接口。新 API 的出入参绑定 generated，存量随域补齐；动态对象和 nullable 特例见[测试指南的窄接线说明](testing.md#工单请求契约窄接线2026-11-06-审计修复)。

单测的 viewNames 从主仓迁移种子派生，通知事件选项也跨仓对词表；CI 会同名分支优先、无同名才回 main checkout 主仓。因此本地/CI需要正确的 `ZHUZHAO_REPO`，不能假定只 checkout UI 就拥有全部契约证据。

## 验证与下一步

页面规范见[UI设计](../design/frontend-ui.md)，实现配方见[组件指南](components.md)。单项检查命令和六件全门禁见[测试指南](testing.md)，提交/push/CI闭环见[贡献指南](../contributing.md)。英文 UI 当前暂不启用，locales 与词包骨架保留；翻案条件和壳层约束仍在 AGENTS。
