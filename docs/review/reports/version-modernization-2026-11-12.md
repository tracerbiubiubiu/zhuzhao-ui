# 前端版本升级 — Phase 6 前的运行时与依赖基线

## 范围与状态

本批承接 Phase 5 已有业务实现，升级运行时、依赖、构建镜像与 CI Action；不启动 Phase 6 业务重构。大量合成 mock、Vue/Element Plus 形态与原真实栈 E2E 门禁保留。本篇记录本地候选的固定验证结果；远端 CI 与生产部署须另见对应收据，不把版本清单视作验收证明。

选择按 2026-11-12 官方发布与 npm 官方 registry 核验。公司基础设施版本约束已撤销；锁定版本和完整性信息分别由 `.nvmrc`、`package.json`、`pnpm-lock.yaml`、Dockerfile 与 Action 完整 SHA 承载，历史报告保留当时版本。

## 运行时、包管理器和镜像

Node 从 20.19.0 升至 **26.13.1 LTS**，采用 2026-11-10 安全修复版本；`.nvmrc`、engine、CI 和 Docker 构建阶段同步。engine 限定当前验证的 26 主版本，避免下一主版本被静默采用。pnpm 从 12.3.4 升至 **12.18.0**，由 `packageManager` 唯一钉定；Node 26 不再自带 Corepack，因此本地和容器通过 npm 安装该字段指定的准确版本。无需额外引入 Corepack。

镜像使用 `node:26.13.1-alpine3.24` 与 stable `nginx:1.30.6-alpine3.24`，均钉定官方多架构 OCI index digest，支持从同一 Dockerfile 选取 amd64/arm64 子清单。本轮 arm64 拉取与运行探针确认两镜像用户态均为 Alpine **3.24.4**；Node 阶段自带 npm **11.20.0** 且无 Corepack，nginx 运行输出为 **1.30.6**。amd64 子清单存在并通过 registry digest 核验，未在本机实跑 amd64。`.dockerignore` 增加宿主 `node_modules`、构建物、Git 和测试运行态排除，避免 macOS 依赖在 `COPY . .` 时覆盖 Linux 构建阶段的安装结果。

## 应用与开发依赖

Vue 3.5.43 → **3.5.45**，Element Plus 2.14.4 → **2.14.8**，Vite 8.3.4 → **8.3.8**；axios、vue-query、vue-router、vue-i18n、UnoCSS、ESLint、Less、vue-tsc 及其配套工具采用同主版本已发布更新。`@types/node` 与 Node 26 对齐。Playwright 1.64.1（旧 lock；原声明为 `^1.63.0`）→ **1.65.0** 后必须安装其对应浏览器，并在新真实栈运行原套件。`rimraf` 从无边界的 `*` 改为 `^6.1.4`，lockfile 钉定实际制品。

两项跨主版本经过调用面核对后纳入：`@vueuse/core` 14.4.0 → **15.0.0**，本仓仅直接使用 `useWindowSize`，未命中官方列出的删除/默认行为变动 API；Node 最低要求也由本轮满足。`@iconify-icons/mdi` 1.2.49（旧 lock）→ **2.0.0**，47 个现用导入均存在于新包 exports 中。二者仍须接受 typecheck、构建与浏览器验证，不以静态核对替代运行证据。

本批没有新增产品能力依赖；优先升级原生态组件，替代方案为保留旧版本或重写相关页面，后者没有本轮收益。原 `allowBuilds` 审批与既有安全 overrides 保留；未以放开全部安装脚本换取安装通过。

含开发依赖的扩展审计检出 `minimatch` 10.2.6 的 **CVE-2026-118764 / GHSA-g3hv-75wg-m249**（moderate），仅在 ESLint/config-array/typescript-estree 开发工具路径。官方触发前提为不可信 glob 且 `optimizationLevel >= 2`；本仓调用未配置该优化级别、库默认值为 1，尚未证明可触发。仍用受影响版本范围 selector 将 `>=7 <11.0.1` 定向替换到已修复的 **11.0.7**，不改更老但不受该公告影响的其他 major。15 种本仓 glob × 313 路径 × 5 种选项的 **23,475 次比较零差异**，随后重验实际门禁与生产/全量审计。

曾试验最新 11.0.8，pnpm 因其发布时间未满默认 1440 分钟而自动添加精确 age exclusion；本批移除此例外，选择已超过该等待窗的 11.0.7。没有降低 `minimumReleaseAge`、放开全局策略或隐藏原 audit 失败。P6.1 工程维护窗口检查上游 ESLint/类型工具的修复版本支持，满足时移除该临时 override 并复验 glob/门禁；仍不满足时保留当前修复并登记下一明确维护窗口，不能仅写“等待上游”。

## 有依据保留的版本与排期

- **TypeScript 5.9.3**：旧 lock 已解析到该版本，本批将宽泛的 `^5.7.0` 改为准确版本。官方最新 7.0.2 超出现有 `openapi-typescript` 7.13.0 的 `typescript: ^5.x` peer；本轮不绕过 peer 约束。P6.1 的类型/契约工具窗口评审支持 TS 7 的生成链，升级时先做生成物与 vue-tsc/ESLint 的兼容验证，验收为原契约生成零非预期漂移与全门禁通过；若上游仍不支持，应记录明确替代选型与下一次复评日期，不能无限挂起。
- **Cropper.js 1.7.0**：固定当前 1.x，官方最新 2.3.1 改为自定义元素，现有头像裁剪使用的 CSS 导入、`getCroppedCanvas` 与选项均有迁移要求。P6.1 U02 评审头像交互与裁剪组件迁移范围，P6.3 U03–U06 对应个人资料页面改造时迁移并验证旋转、裁剪、取消、重选文件与真实上传闭环；若发现安全公告则提前独立补丁窗口，不等待页面改造。
- **unplugin-element-plus 0.10.0**：试验最新 0.11.2 后确认其新增强依赖 `@nuxt/kit`，解析到的 NuxtKit/unctx 分支出现 `unctx 3.0.1` 要求 `unplugin ^3.3.0`、实际上下文却为 2.3.11 的 peer 冲突。本仓只使用 Vite 入口；没有必要为这次更新引入未用的 Nuxt 树。无效的根 `unplugin` peer 宿主声明已撤销，最终组合回到 0.10.0；清理本工作树自身安装树并重新解析后，lock 中 Nuxt/unctx 的实际解析已退出，`pnpm peers check` 无问题，已按最终组合重新验证。P6.1 U02 复评插件更新与上游依赖修正；门槛为 Vite 入口兼容、无新增无效平台依赖/peer 问题且全门禁通过。现有 vue-router 合法依赖的 unplugin 3.x 不因本次撤销而删除。
- LogicFlow、ECharts、md-editor-v3 等其余未变项目，在本次官方 `latest` 核对中已是对应稳定版本。它们的存在不表示必须再引入替代框架。

以上为兼容性限制，不声称旧主版本等同最新，也不将所有组件升级混入本期业务设计。

## CI 适配与边界

checkout 升至 7.0.1、setup-node 升至 7.1.0、pnpm/action-setup 升至 6.1.1，全部使用官方 tag 解析出的完整 commit SHA。三个 Action 使用 Node 24 运行时，与被构建应用的 Node 26 是独立概念。GitHub hosted `ubuntu-latest` 满足至少 2.327.1 runner 要求；若以后迁至内网自托管 runner，需同步验证 runner 版本，Docker action 内使用 checkout 凭据还需至少 2.329.0。

最终全仓 Actionlint 复核发现，本仓兄弟分支解析沿用的 `BR="${{ github.head_ref || github.ref_name }}"` 会把 PR 分支名直接拼入 shell，存在命令注入。独立安全修正将表达式经 step env `SIBLING_BRANCH` 传入，再使用 `BR="$SIBLING_BRANCH"`，不使用 eval；同名分支优先、无同名回落 main 的行为保留。

从实际 workflow 解析该步骤脚本，以 fake git 执行 **8 个合法 Git 分支名回归**，覆盖普通分支、缺失回落、命令替换、反引号、引号突破和中文载荷；均未创建命令执行标记，传给 git 的参数与 UTF-8 字节逐字一致，输出 ref 符合预期。旧提交脚本的正向对照确实可创建其专属标记，证明载荷有效。Actionlint 1.7.12 与 Bash 语法检查均通过，未向远端发起 git 请求；收据为 `ci-sibling-injection-result.json` 和 `ci-sibling-actionlint.json`。此补丁仅改 CI 与本报告，不改 package/lock/src/e2e/Docker，未重新编译或重跑业务套件；下述 244/42 及镜像绑定仍是此前同一运行时输入的实际证据，不冒称本补丁的新运行。

既有 push/PR 触发、同名主仓分支回落策略、lint/typecheck/build/audit/test 工作不变；本轮未实现计划 G02/G03 的 PR 治理与分档门禁，也未增加 E2E stub。CI 只能在获授权推送后以对应 SHA 的真实 run 验证，本地不冒充远端运行。

## 验证证据

最终稳定组合为 **minimatch 11.0.7 + unplugin-element-plus 0.10.0**；独立升级工作树在 Node 26.13.1 / pnpm 12.18.0 下，从既定 manifest 干净安装、`--frozen-lockfile` 重放和 `pnpm peers check` 全部通过。`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm audit:prod`、含 dev 的完整 `pnpm audit`、`pnpm build` 也全部通过；Vitest 为 **31 文件 / 244 用例全通过**，两项审计均无已知漏洞。

权威本地收据为忽略证据目录内 `final-stable-checks.json`：package/lock/workspace/nvmrc 的 SHA256 从安装完成后贯穿所有检查，未漂移。40 个直接依赖中，20 项实际 lock 版本变更；其余 manifest 下限调整与三项有依据的暂留版本须结合 package/lock 评审。`selected-final-scope-check.json` 证实 `src/`、`e2e/`、`scripts/` 零 diff，Nuxt/unctx 的实际解析为零、没有根 unplugin 声明或 age exclusion。构建提示大于 500 kB chunk 和 request 模块静态/动态导入并存，未通过提高阈值或改分包压制提示。

浏览器已完成 Playwright 1.65.0 对应 Chromium/headless-shell **1254** 安装，Chrome **158.0.8127.18** 启动探针通过。在主仓明确独占交接的新 Go/PG18/Redis8/RustFS/AL/TR 私有组合上，原 globalSetup bootstrap 通过，**30 spec / 42 用例全部首轮通过，0 skip、0 flaky、0 实际重试**，耗时约 **186.94 秒**。实际测试目标为最终 nginx 生产产物和真实反代，不启动 Vite，不占共享固定端口。私有 URL 的 index SHA256 与最终镜像独立静态冒烟相同，绑定证据为 `production-image-binding.json`。

六项原门禁均有实际通过证据；本次分项顺序执行，并以私有 production 覆盖配置执行原 Playwright 套件，未原样运行会启动固定 Vite 端口的 `pnpm gate` 命令。权威 E2E 收据为 `production-e2e-run.json`、`production-e2e-results.json` 与 `production-suite-attempt1.log`。TR 本轮使用 PostgreSQL；原 SQLite 定义清理辅助分支因 owned 不存在路径而记录 unavailable，未跳过测试用例。该专属 TR PG 的测试定义由主仓会话按环境生命周期回收，不用 SQLite 清理失败冒充业务失败或默默丢失用例。测试后已交还私有 DB 独占，UI会话不再写入。Linux 最终镜像构建采用同一冻结输入，**构建通过且输入 hash 未变**。最终 arm64 image ID 为 `sha256:caee10a12e1b56c686d1220a6b3eada59eb8f36f26e3f5ebcd6083db3976c6fd`；基础镜像拉取和 arm64 运行探针通过。最终 nginx 容器在随机 loopback 端口的 `nginx -t`、首页、`/ticket/list` SPA 深链及 HTML 引用的实际 JS/CSS 资源冒烟通过，检查记录包含缓存头；owned 容器已移除。该冒烟尚未验证后端 proxy，不以静态服务代替真实服务链。

最终私有 E2E harness 在忽略证据目录导入原 Playwright 配置，保留原 spec/helpers/globalSetup、workers、timeouts 和 retries，移除 Vite webServer，将 baseURL 指向最终 nginx 镜像的生产产物及真实 app/AL/TR 反代。端口均为私有随机 loopback；Chromium 保留 `--host-resolver-rules=MAP host.docker.internal 127.0.0.1` 与 `--no-proxy-server`，用于访问该私有栈的 RustFS 外部端点。测试与请求未替换。fresh worktree 的 `--list` 预检由于原 spec 模块级读取尚未生成的 `.state.json` 而失败，未运行任何用例；随后经当前 Playwright TS loader 执行原 globalSetup 对私有服务建号，并通过原套件；没有复制旧账号状态。

首次失败、重试和撤销尝试均保留在原主仓忽略目录 `.codex/audits/version-modernization-20261112/ui/`，不进入镜像或 Git：

- 完整 npm packument 库存首次读取超时，改逐包官方 latest 元数据后成功；首次 full audit 的 minimatch 公告及修复前报告保留。
- 11.0.8 的自动 age 例外、无效根 unplugin peer 宿主和 0.11.2 的 Nuxt 树均撤销。增量更新曾保留 Nuxt 可选 peer，被 sanity guard 阻断；仅迁走本工作树自己的 node_modules 并从既定 manifest 重新解析，未触碰共享 store/其他仓。最终 peer 与审计全绿。
- 首次 Docker 构建在 lock 重生成前误启动，被主动停止；第二候选完成 Linux frozen 安装后，因依赖候选变化停止编译，均不计镜像验收。最终镜像必须依据同一稳定锁重新构建。
- Playwright 官方客户端下载重试保留，不能计成测试用例重试。独立浏览器探针首次引用了未直接暴露的传递包路径，改用本仓直接依赖 `@playwright/test` 入口后通过，未改产品依赖来迎合探针。

远端 CI 尚未运行、尚无生产部署；本机没有实跑 amd64 镜像，也没有 UI 像素基线。本地结果不替代以上边界。

## 回退与风险

本批无 API、权限码、数据库迁移或业务路由变化。回退必须成套恢复 package/lock、Node、Docker 与 CI 基线，并重建静态资产；单独回退 lock 或 Node 会失去本轮可重放条件。恢复已记录的上一源码/镜像后，仍应检查登录、路由、头像/附件、编辑器、流程画布与懒加载资产。运行时和依赖变化不构成旧壳缓存兼容承诺。

## 官方依据

- [Node 发布索引](https://nodejs.org/dist/index.json)与[26.13.1 校验和](https://nodejs.org/dist/v26.13.1/SHASUMS256.txt)；[Corepack 分发范围](https://github.com/nodejs/corepack#default-installs)。
- [pnpm 官方版本元数据](https://registry.npmjs.org/pnpm/12.18.0)、[Vue 元数据](https://registry.npmjs.org/vue/3.5.45)、[Element Plus 元数据](https://registry.npmjs.org/element-plus/2.14.8)、[Vite 元数据](https://registry.npmjs.org/vite/8.3.8)。全部直接依赖的官方元数据收据保留于本轮忽略证据目录。
- [VueUse 15 迁移项](https://github.com/vueuse/vueuse/releases/tag/v15.0.0)、[Iconify 2 exports](https://registry.npmjs.org/@iconify-icons%2fmdi/2.0.0)、[Cropper 迁移指南](https://fengyuanchen.github.io/cropperjs/v2/migration.html)、[OpenAPI TypeScript peer](https://registry.npmjs.org/openapi-typescript/7.13.0)。
- [minimatch 公告](https://github.com/advisories/GHSA-g3hv-75wg-m249)、[pnpm 发布等待策略](https://pnpm.io/settings/dependency-resolution#minimumreleaseage)；minimatch 发布时刻取自 [官方 registry](https://registry.npmjs.org/minimatch)。
- [checkout 7.0.1](https://github.com/actions/checkout/tree/v7.0.1)、[setup-node 7.1.0](https://github.com/actions/setup-node/tree/v7.1.0)、[pnpm Action 6.1.1](https://github.com/pnpm/action-setup/tree/v6.1.1)；镜像依据为 [Node 官方镜像](https://hub.docker.com/_/node)与[nginx 官方镜像](https://hub.docker.com/_/nginx)。
