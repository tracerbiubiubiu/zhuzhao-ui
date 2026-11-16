# AGENTS.md — zhuzhao-ui 前端协作协议

> 本文件对每次在本仓库工作的 AI/协作方生效。当前UI设计见本仓 [docs/design/frontend-ui.md](docs/design/frontend-ui.md)，阶段来源回链主仓 `zhuzhao/docs/phase4/01-frontend-design.md`。后续全站改造按[重设计合同](docs/design/frontend-redesign.md)与主仓[规划总账](../zhuzhao/docs/planning/planning-backlog.md)实施，文档落档不代表页面已改造。

## 文档与工作资料归属

- 新增或移动文档前，先按[文档维护约定](../zhuzhao/docs/documentation.md)确定唯一归属、Git保留范围及入口；详细规则只维护该页。
- 可复用方法、空白模板和开发提示词从[工作资料库](../zhuzhao/docs/toolkit/README.md)查找并复用；填写后的执行实例按正式结论或本地过程材料归档，不能回填到模板原件。
- 当前计划归主仓planning，合同/指南归实现仓docs，正式结论归review/reports；原始调研、日志、截图、备份和操作收据按[材料目录](../zhuzhao/docs/materials.md)留仓库外档案。ignored `.codex/`仅作执行工作区，收尾提炼结论并登记材料ID。
- 不在src下新建散落报告目录或第二套长期知识库；模板/提示词不扩大操作授权，也不改变本仓门禁。迁移须检查链接、脚本和真实消费者，收尾核Git状态及材料去向。

## 开源定位与公司信息隔离基线（2026-10-09 定，全仓强制；SSOT=主仓 standards.md §1.1）

> 本项目定位为**开源项目**；所有公司内部对接能力一律不在前端实现（对接走后端网关 API，前端零直连）。以下对**文档、代码、mock 数据同等强制**：

1. **公司信息零出现**：本仓不出现公司内部专有信息——内部系统名/接口报文/组织与人员真实信息/内部文档内容。存量定性背景描述保留；增量文档与注释一律通用抽象表述（"企业统一认证/内部平台"级抽象）。
2. **对接零直连**：一切数据交互走 zhuzhao 网关 API（`/api/v1`、`/al` 反代）；前端不实现、不预留任何对公司内部系统的直连调用——新对接能力出现时 = 后端新增网关端点 + 前端按 §3 契约消费。
3. **测试/mock 数据全合成**：mock 与测试数据一律合成构造（人名/部门/系统名用虚构值），**禁止使用脱敏的真实公司数据**（脱敏≠不可关联）。
4. **示例纪律**：以公司文档举例产出的页面/设计，落档时脱敏为通用抽象；公共产品名作示例不受限。
- 违反处置：视同敏感信息泄漏（发现即修）；review 与审计列为检查项。详细后端侧规则见主仓 `docs/standards.md` §1.1。

## 前端门禁（每批交付前跑完整适用组合）

> 测试策略与纪律（大量合成mock/contract/real分层、变异验牙、FE4哨兵、豁免登记、真实栈独占跑）SSOT = [docs/guides/testing.md](./docs/guides/testing.md)。所有者已确认大量mock为持续前提；旧“不mock中间层”不再是禁令。mock用于开发、状态/交互/视觉，契约检查防样本漂移，关键真实栈门禁保留；新增mock工具与命令须按U02/U07实施，不能将当前`test:e2e`静默改成stub套件。

**分档规则（2026-11-16）**：普通说明/导航/历史报告文档为`document`，做文档/链接与提交检查；登记的候选Schema、离线HTML原型与规划生成工具为`reference`，另做格式、候选语义及对应工具/原型针对验证；业务代码、运行时输入、正式接口/权限/迁移/运维协议、产品测试及夹具、CI、分类器和豁免规则为`ordinary`，保留完整六件门禁。按内容与实际消费者分类，不以扩展名或处于`docs/`降档；混合批取最高适用组合、未知从严。代码测试先行与守卫验牙不变。`pnpm quality:plan`查看本地直接`base..HEAD`差集及在途改动计划（默认`origin/main`，可追加`--base <ref>`覆盖），不推导merge-base。`pnpm quality:check`只执行文档/参考检查；完整档随后明确失败并要求另在独占环境跑原六件，不自动调用共享业务栈。提交规范继续由钩子及独立CI检查。`pnpm gate`保留完整六件入口；门禁规则自身的本批修改必须按完整六件验收。细则和离线验证边界见测试指南。

```bash
pnpm lint          # ESLint（纯检查；自动修复用 pnpm lint:fix，修复后重跑 lint）
pnpm typecheck     # vue-tsc --noEmit（codegen 类型**部分接线**：入参 5/16 api 文件引 __generated__（user/role/profile/selfService/ticket；2026-11-06 按调用 request.* 的 api 文件口径，ticket仅Create/Assign两路）、出参 storage 1/16 接线生成schema（合计6/16文件有接线）——漂移仅接线面编译期报错，勿视为全量守卫；改 API 形状后先 pnpm codegen，补接线随域渐进）
pnpm test          # Vitest（动态路由解析/请求层单飞刷新/keep-alive 防漂移断言等——31 文件 / 244 用例，含六哨兵矩阵：apiPaths 前缀/viewNames/epImports 导入/tableFit/分页覆盖/uiConventions——全表见 docs/guides/testing.md「防漂移哨兵矩阵」）
pnpm audit --prod  # npm 供应链（对称 Go 侧 govulncheck；镜像源无 audit 端点时加 --registry=https://registry.npmjs.org）
pnpm build         # 产物构建
pnpm test:e2e      # 现有关键真实栈Playwright（S1–S8/S10/S12/S16–S17/FE3·FE4/W4·W5/P4/P5 穿插池——30 spec / 42 用例；本发现范围不改为stub——W5 需 activelist/taskrunner 上游，前提见下）
pnpm gate          # ordinary档六件一键串行（lint → typecheck → test → audit:prod → build → test:e2e）；任一红即停，适用的真实栈E2E不得静默跳过
pnpm quality:plan  # 显示base..HEAD及在途改动的分档与完整适用组合，不执行门禁
pnpm quality:check # 执行文档/参考检查；ordinary档要求另在独占环境跑原六件并退出失败
```

**E2E 运行前提**：主仓 `bash scripts/dev-stack.sh up`（dev PG/Redis）+ `INTERNAL_JOBS_SK=xxx make dev`（app @33333）；W5 场景另需两上游：activelist（compose.dev PG@15432 + `ACTIVELIST_CALLER_ZHUZHAO_SK=dev-gateway-sk go run ./cmd/apiserver`——监听地址随其自身 config 默认 :18081（11-02 迁移后），无需 addr env + 主仓 `make dev` 自动注入 `GATEWAY_AL_TARGET=http://127.0.0.1:18081` 免改 config（2026-11-02 env 注入治理））+ taskrunner（@18080：TASKRUNNER_HTTP_ADDR=:18080 + TASKRUNNER_REDIS_PASSWORD=zhuzhao_dev + CALLER_ZHUZHAO_SK=dev-taskrunner-sk/SELF_SK + CALLBACK_TARGET_URL=http://127.0.0.1:33333/internal/jobs/callback，app 侧带 TASKRUNNER_BASE_URL=http://127.0.0.1:18080/TASKRUNNER_SK=dev-taskrunner-sk）；vite dev server 由 Playwright webServer 自动拉起。globalSetup 幂等建号（admin 凭据闭环/operator·viewer 预设/S1 重置），可无限重放。浏览器下载被墙时：`PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright pnpm exec playwright install chromium`。

**测试账号纪律**：E000001（superadmin种子号）密码终态恒为`admin12345`；人工/agent多账号测试一律用专属E000002+，禁止修改E000001。仅acceptance/globalSetup既定幂等例外流或主仓break-glass复原可收敛其值，权威见主仓runbook §4。

**纪律**：完整适用门禁不全绿不得标记完成；关键真实栈E2E仍打真后端（菜单/资源权限、迁移、服务调用与写动作必须有真实证据），mock/contract通过不能替代；CI（`.github/workflows/ci.yml`）的`changes`按事件真实差集生成计划，提交与文档检查必跑，`reference-check`按计划执行，原`lint`/`test`仅在`runtime=true`时执行且保留原完整行为；`quality-gate`聚合检查，拒绝应跑未跑、失败、取消或应跑却跳过。现有真实栈E2E与Go仓acceptance同口径走本地执行，不能静默省略；**推送后核实 CI run 转绿才算交付闭环**（`gh run list`/`gh run watch`——本地绿≠CI绿）。远端required checks是否切到聚合身份须另获授权配置与回执，不能因本条自行修改保护。每批分别披露mock、contract、real及视觉/键盘结果；未实现的测试工具不写作已运行。

**i18n 口径**：当前英文面显式暂不启用，`src/locales/`骨架与en词包保留（含`login.*Placeholder`闲置键）；新页面中文，勿新增半成品键。P6.1的U02固定复核本轮语言范围、资产责任与后续复评窗口，不再仅挂“英文用户出现”。切换器仍由`appConfig.ui.locale=false`隐藏，本次文档不启用它；后续改变时同步词包、页面、`e2e/ui.ts`及调用者，历史方案见主仓Phase4的02号§5.4。

## 类型生成（codegen，随契约批）

后端改 API 形状时：主仓 `make swag` → 本仓 `pnpm codegen`（swagger2openapi 2.0→3.0 + openapi-typescript 7.13 → `src/api/__generated__/`）。**生成物不手改、随仓提交**；主仓路径非 `../zhuzhao` 时设 `ZHUZHAO_REPO`。**契约批合入后同批 `pnpm codegen`**（2026-10-28 验证批实证：曾落后 39 端点无人发现）；此后**新写 api 文件的出入参一律引 `__generated__` 类型，存量随域渐进补接线**——接线面之外 typecheck 不报漂移。

## 提交规范

- 中文提交信息，描述改动+原因+验证证据；**主题行 `type(scope): ` 后 ≤50 字**（对齐主仓 [standards.md §12-9](../zhuzhao/docs/standards.md)；硬规则①–⑤已由 `scripts/commit-policy.py` 同核守卫，2026-11-08 落地，复验登记 [RR-GIT-01](../zhuzhao/docs/review/reports/zhuzhao-report-followup-2026-11-08.md)）
- 分支与合入（2026-11-13按所有者确认更新）：五仓统一短分支经PR合入main，完整适用检查通过后允许单维护者自行合入；取代旧Phase4小批直推豁免。远端保护/required checks是否已生效须另核G02/G03实际回执，不能由本条文字宣称已启用。默认只完成本批本地提交，不自动push、合main、发版或切共享环境。

- 开工先 `pnpm hooks`：只为当前 worktree 安装 `.githooks`，保留 common hooksPath；`pre-commit` 在途显影、`commit-msg` 先校验消息再拦跨主题重题、`pre-push` 按实际推送 refs 检查新提交。需要 Python 3 + Git，无新增 npm 依赖。
- `git fetch origin` 后 `pnpm commit-lint` 核对当前分支待推送窗口；`pnpm test:commit-lint` 跑 42 项隔离黑盒（2026-11-08；后续以测试源码/实际输出为准）。CI 独立 `commit-policy` job 以事件载荷的 before/after 或 PR base/head 复用同核，包含新 merge 提交；历史采用 `scripts/commit-policy-baseline` 固定接入点 `152258638abaa3bd3daa656255a794c5422a0e58` 的祖先豁免，禁止滚动基线隐藏新违规。历史不改写，严格追溯用 `range --strict`。
- 提交只带本批显式路径，禁止 `git add -A`、`git commit -a` 或无路径裸提交；提交后核对 `git show --stat`。原 `pnpm gate` 六件不变，提交规范检查独立运行，详见 [贡献指南「提交规范与机械检查」](./docs/contributing.md#提交规范与机械检查)。

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
- **计数口径**（随实际增长同步，禁止两处不同值）：E2E「30 spec / 42 用例」（P5 六件=CC 标签/S2 画布/S6 消息中心/S3a 转换+规则/通知配置管理面，2026-10-25/26 补齐——phase5 曾全程未落浏览器，见主仓 11 号同日批次行）、单测「31 文件 / 244 用例」、E2E 范围串「S1–S8/S10/S12/S16–S17/FE3·FE4/W4·W5/P4/P5 穿插池」、门禁统称「六件门禁」（lint/typecheck/test/audit/build/test:e2e，一键=`pnpm gate`）
- **存放**：五仓各自维护 `docs/`、统一分类；UI自身设计/规范/指南归本仓，跨服务工程/API/IAM/迁移与阶段决策仍回链主仓唯一权威。根README为入口、AGENTS保留机器协议；正式时点报告住 `docs/review/reports/`，命名 `<topic-kebab>-<YYYY-MM-DD>.md`，原日志/执行卡等在ignored `.codex/`执行，收尾按主仓材料目录归仓库外档案。`doc/`为本地参考，旧deliverables/outputs/audit-reports不再受控入口，Git与Docker均忽略。
- **计数/状态声明须与实测一致**：改 E2E/单测数量或修复状态时，以实际输出和本节快照核对，README只保留入口不复制数字；「全部修复」类表述须有逐项证据（docs/review/reports/或主仓当轮收据为凭）

## 前端 UI 规范（2026-10-08 制定）

本节是现行实现规则；全站替代方案与[逐页清单](docs/design/frontend-pages.json)已落档，U02/U07负责设计和验证底座，U03–U06负责P6.3业务/全站改造。不得凭新文稿宣称UI已改造，也不将下述历史具体尺寸/弹层/滚动规则视为永久不可重审；对应任务实施时同批修订权威规范、代码和验收。

**新增/改动任何页面前必读 [docs/design/frontend-ui.md](docs/design/frontend-ui.md)**——铁律：**页面不动，所有页面锁定视口，一切滚动条都在内部元素上**（列表页=表格内滚+分页钉底；内容页=内容区容器内滚）；**详情=右抽屉/动作=对话框**（详情类禁开 dialog——2026-11-03 七处详情全抽屉归位，宽度两档：键值 560/长文 620，§弹层形态）。文档含三种页面骨架配方、表格列宽（内容列 `minWidth`，全固定宽=宽屏右侧死区）、分页口径（ProTable 统一 `[10,20,50,100]` 默认 20；cursor/面板型见文档）、弹层形态纪律、滚动归属（Backtop 盯 `.v-app-view`）、踩坑记录（数量随事故增长，以文档为准勿引死数）与新增页 checklist。

## 前端契约速查（详细见主仓 01 号）

> 本节为**主仓 `docs/standards.md` §3（API 设计约定）的前端消费摘编**——信封/方法/int64/时间/错误码等公约以 standards 为 SSOT（2026-10-01 起本仓列入其适用范围；date-only 字段 `YYYY-MM-DD` 例外与「ID 数组元素发送侧仍 string」口径见其 §3-12）。

- 信封：`{code:0, message, data, request_id}`——按 HTTP 状态分流（code≠0 恒非 2xx）
- 登录：`employee_no` + `password` + `device_id`（浏览器级 UUID 必传）
- 401 分码：20002 过期→静默刷新 / 20003 无效→跳登录 / 5xx 不清会话；403+20007→跳改密页不清会话
- 权限码：`button:{permission}`（非 menus.code）+ `route:{path}`
- int64 全仓 string 序列化（codegen 产物天然 string）
- 菜单：`GET /user/menus` → `data:{menus:[...]}` / `GET /user/permissions` → `data:{permissions:[...]}`
