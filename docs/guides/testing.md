# 测试指南 — mock、契约、真实栈与失败复核

> 协作协议见[AGENTS.md](../../AGENTS.md)。本文给出测试职责、执行入口和失败解释；每轮数量/重试/跳过以实际输出为准，不把历史spec数量写作当前运行结果。新增/改动测试前必读。

## 运行命令与通过条件

自2026-11-16起，每批先按真实差集确定完整适用组合。分类器见[scripts/quality-gate.py](../../scripts/quality-gate.py)，分类规则与豁免本身也属于完整门禁范围。不能因为文件放在`docs/`、使用`.md`/`.json`/`.html`或标成“规划”就自动减检查。

- **`document`：普通文档。** 说明、导航、历史报告等无运行消费者的文字变更，运行提交规范、文档格式和本地链接检查。
- **`reference`：参考产物。** 已登记的候选Schema、离线HTML原型和规划生成工具，保留文档检查，并运行格式、引用、候选语义及对应生成/检查工具的针对验证。候选转为正式协议、被业务/运行时读取或用于生产构建后，立即归完整档。
- **`ordinary`：完整适用。** 业务实现、运行时配置与输入、正式API/权限/迁移/运维协议、产品测试/夹具、构建依赖、CI、分类器、文档/参考检查器及豁免规则等都保留六件门禁；需要后端验证的变更同时跑对应主仓组合。规则自身的本批变更也走完整档。

混合批取最高适用组合，参考产物与业务混改时参考验证仍保留；未知路径/用途、无法确定事件基线或缺失Git对象从严，不能猜`HEAD~N`或使用workflow顶层`paths-ignore`隐去提交。重命名/删除按实际差集处理。`pnpm quality:plan`只显示本地计划：使用显式`base..HEAD`直接差集，并纳入staged、unstaged和未跟踪文件；默认基线`origin/main`，可追加`--base <ref>`覆盖，不通过merge-base换算窗口。`pnpm quality:check`只执行文档和参考检查；`ordinary`档随后退出失败，要求另在明确独占环境运行原六件，不自动启动或调用默认共享业务栈。提交规范仍由钩子与独立CI处理，本地入口不能代替它。`pnpm gate`保留完整六件入口。不要求普通文档和纯参考产物重新启动真实业务栈，也不能把不适用写成实际已通过。

CI的`changes`先跑分类器/聚合器、文档检查器和参考检查器的独立黑盒测试，再使用push before/after或PR base/head事件窗口分类；`commit-policy`与`document-check`保留，`reference-check`按计划执行，原`lint`/`test`在`runtime=true`时运行全部既有步骤。最终`quality-gate`在`always()`下检查所有结果：应跑job缺失、失败、取消或skipped均失败，不以某个job绿色代替完整适用组合。远端required checks迁移须另行授权与回执，本地规则落档不代表保护已启用。

离线HTML的静态检查不能证明交互和视觉。当前受控入口[scripts/test-reference-prototypes.mjs](../../scripts/test-reference-prototypes.mjs)使用既有Playwright，在私有临时预览与独立浏览器中验证登记的lifecycle原型；命令及准确任务边界见[原型说明](../design/prototypes/README.md#当前可复跑检查)。正向覆盖1366×768与390×844的相关导航、角色动作边界、筛选保留、明确重查、离开保护与显式确认，捕获脚本错误/外部请求并留截图；`--self-test`证明五种目标缺陷会触发对应断言。截图尚无自动差异基线，历史浏览器收据也不能充当本次运行结果；按改动补键盘/缩放，未执行任务明列NOT_RUN。生产Vue、真实API/权限与专业平台仍走各自实际验收。

## 完整档运行命令

以下是当前已实现的六件门禁；其中test:e2e仍是关键真实栈验收，先按[开发与联调](development.md)确认服务、迁移/种子和独占窗口。大量合成mock是已确认的新开发/测试前提，工具和状态样本扩围尚待U02/U07实施；本次文档修订没有新增命令或把真实栈改成mock。在UI根目录运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm audit:prod
pnpm build
pnpm test:e2e
# 上述顺序的一键串行入口；任一失败即停：
pnpm gate
```

ESLint是纯检查，修复用lint:fix后重跑。E2E使用[playwright.config.ts](../../playwright.config.ts)，workers=1、当前默认retries=1；默认门禁有重试时必须披露实际首轮失败/重试/跳过，不能写成零重试。CI范围见[ci.yml](../../.github/workflows/ci.yml)，E2E当前由本地真栈承接；未推送/未执行的远端CI不写通过。

### 开发期已接受的依赖公告

2026-11-18所有者明确接受`picomatch@4.0.7`的high公告[GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)在开发期不阻塞进度，状态为`accepted_open`，漏洞尚未修复。`pnpm-workspace.yaml`只通过[pnpm 12原生`audit.ignore`](https://pnpm.io/cli/audit#auditignore)登记这一条GHSA；本地与CI沿用同一`pnpm audit --prod`入口和默认级别，其他未接受公告继续阻断。审计退出0须披露已接受条目，不能表述为无漏洞。

本轮r2候选的独立静态构建观察在模块图与输出中均未包含`picomatch`，仅证明该次产物，不能覆盖构建时消费者或未来导入；材料ID为`maintenance/commit-push-merge-20261118/ui/security/`，实现侧回链见[依赖风险状态](../design/frontend-ui.md#依赖风险状态)。后续开发/构建时随正常依赖审计检查官方修复或兼容升级，可用时立即升级、移除该ignore并重跑适用门禁，正式使用前复核；等待期间不另设固定到期阻断，也不为此安排额外回补、换库或裁剪。

### 维护任务的真实正向旅程

任务管理页面及`task:submit/manage`不授予审计维护资格。`w5-task-center.spec.ts`继续用未获独立维护资格的管理账号验证403与定义/运行数不变；`w5-task-maintenance.spec.ts`另用专属已批准维护者，从真实浏览器提交任务，核对任务查询结果、核心PG与TR SQLite双端持久`succeeded`、200天合成旧审计记录从在线表移除及近期记录保留。该浏览器用例不单独检查JSONL文件；导出内容须由准确候选的真实JSONL专项验证并另记收据，不能仅凭在线旧行消失记为文件归档已验证。两者不能互相替代，不能因默认拒绝而自动给管理员或种子号维护权。

完整真实栈门禁须在自有独占栈准备以下输入；新增正向spec缺项即明确失败，不跳过：

- 先通过独占栈的受权用户管理API预置`E000002+`专属维护者，授予原有任务读取/提交/管理权限，记录服务端稳定用户ID。按主仓[审计维护合同](../../../zhuzhao/docs/modules/audit.md)在该栈启动配置的维护者列表或`TASK_MAINTAINER_USER_IDS`中绑定该ID，再重启该独占app使配置生效；不得给`E000001`授予此测试资格。临时保留期覆盖仍需另有批准，本例只按默认180天运行。
- 显式设置`E2E_MAINTAINER_EMPLOYEE_NO`与`E2E_MAINTAINER_PASSWORD`，凭据只存本机私有环境文件，不写报告/命令日志；原globalSetup的非维护管理账号继续用于拒绝反例，不改其维护资格。
- 显式设置`E2E_API_BASE`、`E2E_PG_CONTAINER`、`E2E_PG_USER`、`E2E_PG_DB`和`E2E_TASKRUNNER_DB`，全部指向同一候选组合。SQLite只读查询，不能用默认兄弟仓运行库代替独占实例。
- 设置`E2E_MAINTENANCE_STACK_OWNER`为该独占Compose project和`audit.owner`标签的共同值；spec在造审计marker前实际核对PG容器两项标签，防止误用共享库。`E2E_BASE_URL`仍指向该组合的UI，启动与标签由本轮资源清单负责，不改变共享服务。

正向spec不模拟worker或callback；只在已核自有PG中造数/精确清理自己的marker，结束时经正式API停用本例手动定义。定义/运行/准入事实随独占栈保留至候选收据封存和精确回收，不直接改TR SQLite删除历史。Playwright附件只记录task ID、终态和效果布尔值，不记录登录口令或token。浏览器旅程、单元指导逻辑和既有组合恢复收据分别计数，未执行的新spec不能记为通过。

本次新增守卫先证明目标缺陷能使它变红，再还原并跑正向；局部绿不等价完整适用组合。完整适用门禁未绿不得标记完成，网络/环境失败保留原结果并说明影响。人工与agent验证用专属E000002+，禁止改E000001；仅既定acceptance/globalSetup幂等例外流及break-glass复原按主仓runbook执行。

## 测试先行与单维护者审阅

继续遵主仓[standards §11](../../../zhuzhao/docs/standards.md#11-开发工作流先框架--先测试--分批实现)：当前获准代码批的正向、负向、边界、权限拒绝用例全量先写，确认因目标行为失败，再实现到绿。编译、环境或夹具错误不算有效红例；红→绿在隔离工作树取证，不要求先提交失败测试，交付须完整适用门禁；代码批仍保留六件与对应后端组合。

实现与新上下文审查分别读取业务预期、实际diff和原始证据；测试删除/预期改变、skip/重试/阈值、fixture或CI变更须说明业务原因，不能迁就实现制造绿灯。既有静态及运行时负例的变异验牙、非admin真实旅程、mock/contract/real分列和首次失败披露全部保留。分档只改变适用组合，不豁免代码测试先行或改变产品测试发现范围。

交付沿用主仓[三节短审阅卡](../../../zhuzhao/docs/phase6/implementation-handoff.md#单维护者短审阅卡)，给行为前后例子、权限/数据影响、准确组合、红绿/视觉/真实效果、NOT_RUN和恢复边界，详情按需展开；不新增一套UI长报告，也不将“两个agent都通过”视为独立安全保证。

## 分层与职责边界（Testing Trophy 形态）

| 层 | 载体 | 拦什么 | 不拦什么 |
|---|---|---|---|
| 静态扫描闸（六哨兵） | TS strict + eslint + **扫描闸**：`src/epImports.test.ts`（el-* 导入/字符串 prefix-icon/el-table 漏挂 useTableFit）+ `src/paginationCoverage.test.ts`（分页覆盖）+ `src/uiConventions.test.ts`（空态引导/placeholder 宽度）+ `src/icons.test.ts`（图标注册）+ `src/api/apiPaths.test.ts`（网关前缀）——完整文件与用例见本文“防漂移哨兵矩阵” | "静态门禁全绿但运行时静默失效"类缺陷（模板缺 import=分页器隐形、漏挂=列宽不随容器重排、分页缺失=数据增长后才显形——247/51/84 三例事故） | 逻辑错误、运行时权限问题 |
| 单测契约闸 | Vitest（请求层单飞刷新/动态路由解析/viewNames 种子派生/cursorPager/errorToast 等） | 关键契约的漂移（后端种子改了前端没跟、并发竞态回归） | 纯道具式断言（禁止为覆盖率写无语义用例） |
| E2E 真栈 | Playwright（S1–S8/S10/S12/S16–S17/FE3·FE4/W4·W5/P4/P5 穿插池；完整发现范围以playwright配置和e2e/*.spec.ts为准） | 场景级回归（登录/改密/CRUD/跨用户会话/角色边界），断言真数据级 | 布局审美细节（人眼/探针）、非可达路径 |
| FE4 哨兵 | `e2e/fe4-nonadmin-hygiene.spec.ts` | operator/viewer 双角色可达路由遍历——**零 4xx/5xx API 响应 + 零「无权限/内部错误」toast** | 管理面（admin 专属，FE3 覆盖 404 边界） |

职责边界：单测/组件测试验证状态转换，mock驱动的页面测试验证交互和视觉，契约检查验证请求/响应形状，真实栈验证集成与授权。浏览器测试可以承载多种检查，必须说明使用的数据面与证据范围；截图差异不能替代业务断言，单测也不能证明真实授权。不得为覆盖率编写无语义用例。

## mock、contract、real三层合同（2026-11-11重规划）

所有者已明确保留并大量使用mock。旧“没有MSW中间层、等待触发再翻案”是历史实现取舍，**不再是禁止mock的规则**。当前仍未实现完整mock页面层，不能把新策略写成已有工具已经接线；具体框架选择、目录与执行命令随主仓[规划总账](../../../zhuzhao/docs/planning/planning-backlog.md)的U02/U07（P6.1）落地，不先新增未存在的命令。

- **mock：开发、状态、交互与视觉。** 使用全合成用户/组织/工单/专业平台响应，覆盖正常、空态、长文本、大量数据、空菜单、无权限、慢请求、错误、乱序、部分成功与重试。页面开发和视觉基线可脱离共享服务，避免为布局走查反复改真实账号；不得使用脱敏真实公司数据。
- **contract：防止mock自说自话。** 请求/响应样本对齐OpenAPI、生成类型和真实接口合同；明确哪些动态字段尚无完整schema。跨仓API变化随批同步样本和消费者检查。样本匹配schema不代表服务端实现必然正确，真实端点仍需验证。
- **real：关键集成、身份与写动作。** 保留现有真实栈E2E，必须验证登录/改密、菜单与自定义最小角色、L1/L2/L3、工单关键动作、标签逐项权限、附件、消息深链、任务/AL网关等。mock通过不能替代真实资源授权、迁移、服务通信和调用回执。专业平台API未提供时保留mock并标明外部真实验证未完成。
- **结果必须分开。** 报告写清mock用例、契约检查、真实栈场景、视觉/键盘检查各自结果和限制，禁止合写“E2E全绿”掩盖数据来源。已有真栈spec保持真实数据断言；新增mock页面测试使用独立发现范围，避免现有`test:e2e`静默变成stub套件。

样本需要稳定时钟、ID与版本，允许按场景组合；合同变化由拥有模块同步维护。生产构建不得依赖测试替身；mock入口、敏感凭据和测试数据的装配隔离作为U02实施验收，不在本次文档批声称已经实现。

## 变异验牙纪律（新闸必证有牙）

新增防漂移闸（扫描/契约断言类）合入前**必须变异证明**：故意制造目标缺陷→测试变红→还原。先例：epImports（删模板 import→红）、useTableFit 扫描（摘 Profile 挂接→红）。未验牙的闸视同不存在。

E2E **运行时**负向断言闸同纪律（2026-11-09 增补）：s5 B5-3「离开详情零空 id 附件请求」哨兵合入前，checkout 缺陷版组件跑 spec 验证精确变红再还原——运行时闸与静态扫描闸同一标准，未验牙视同不存在。

## 角色菜单读取与错序回归

角色菜单整体替换由`src/views/system/role/menuAssignment.test.ts`覆盖读取/渲染就绪、失败重试、同角色重开、迟到保存和清空确认；`src/api/system/menu.test.ts`与`assignmentPayload.test.ts`区分坏载荷和明确空集合，`menuTreeCascade.test.ts`保留目录联动与页面/按钮独立合同。并发守卫使用可控Promise交错及移除世代检查的稳定变异，不靠加长等待堆通过率。

`e2e/s4-role-menu-races.spec.ts`使用真实临时角色、菜单读取、绑定与后端回读，指定菜单树读取注入延迟/503、指定旧角色菜单读取仅延迟原响应，验证页脚在树未就绪/失败时禁止保存以及同角色重开后不被旧响应污染。其余请求和写入均走真实服务，临时角色在finally删除；这些故障注入检查不能冒称所有网络均无替身。既有`s4-role-admin.spec.ts`继续验证目录联动、只勾页面的真实保存与精确回显；专项通过不替代完整六件和全量真实栈E2E。

本批过程材料ID为`maintenance/commit-push-merge-20261118/ui/`，分别记录测试先行红例、首次失败、变异、mock单测与真实浏览器结果。运行前必须核候选UI来源；不能对旧静态前端跑绿后把结果记到新源码。临时验证端口仍遵守主仓分配和S3 Origin配置，结束精确退出候选前端并恢复既有环境。

## 三处管理写入的错序回归

MyOrg 的 `rosterSession.test.ts` 以可控响应覆盖切组、重选当前组织、翻页、迟到403、确认续跑、负责人全量预取及旧写回包。字典管理的 `dictPage.test.ts` 执行真实页面 setup，校验筛选与主从读世代、写前目标、同一行重读后的删除确认，以及写后回读失败时保留当前草稿并等待重试。两处的常规真实浏览器正向路径分别由 `s7-my-org.spec.ts` 和 `p4-dict.spec.ts` 覆盖。

状态图的 `p5-s2-flow-save-races.spec.ts` 使用真实画布和服务，控制部分请求响应的时机，并向浏览器交付一个迟到的预检失败以验证提示归属。通过浏览器切换类型、撤销、重复点击与重开后，核对写请求只有原目标快照，并从实际服务回读两种类型的图、元数据与版本。相关基线红例、候选证据和隔离栈收据归材料ID `maintenance/pass8-target-write-20261118/`。

## 非 admin 盲区教训（2026-10-12 双例）

两例缺陷均为 admin 单账号 E2E 的盲区：① 工单列表筛选占位符冲突 500（`4a18789`——viewer/operator 任意筛选即 500）；② 任务定义 Tab 急切拉 `/jobs` 403 toast（`ce13f5d7`——Tab 未按 task:manage 门控）。由此固化：

1. **FE4 哨兵**常驻（双角色 × spec内ROUTES集合），新增可达页面须加入其 ROUTES 集；
2. **权限门控不止按钮**：Tab/面板/区块若挂 admin 专属数据面，面板本体必须按权限门控（v-if/usePermission），仅按钮 v-permission 不够；
3. 涉及角色差异的改动，**至少一个非 admin 账号人工过一遍**（凭据见 globalSetup 预设）。

## 设计内探针 403 白名单（显式登记制度）

FE4 断言的 4xx 白名单必须显式登记在 spec 内并注明语义，禁止隐式忽略：

| 端点 | 语义 |
|---|---|
| `/api/v1/orgs/members/list` | MyOrg 以 403 判定「非 owner」→ 隐藏委托控件（L3 口径，前端故意调） |

扫描闸的豁免同制度：`epImports` 无豁免；useTableFit 豁免清单（ticket/type 对话框定宽表）登记于用例内。

## 运行纪律

- **E2E 独占跑**：两会话并发跑 Playwright 共用 `test-results/` 会互踩 trace 产生随机假失败（2026-10-12 实证）——跑前确认无他方 worker（`ps -eo pid,command` 检查 `workerProcessEntry`）；
- **本地与CI分别核实**：CI按分档执行提交、文档、参考及原lint/typecheck/build/audit/test，不跑真实栈E2E；本地完整档仍须六件，获授权推送后 `gh run watch` 核实CI转绿才闭环，不能以CI绿替代适用的E2E；
- **真数据断言**：关键真实栈E2E禁止"断壳不断数据"式假绿——断言行数/字段值/API回读；mock页面测试同样需要任务级断言，但不将其写成真实接口验证。

## 视觉与可访问性验收（固定排期）

- **U07 / P6.1：** 建立代表页面的稳定合成状态、截图基线、基本axe检查和键盘/焦点验收；不再等待“先发生视觉事故”或“出现合规要求”。工具选型与命令未实施，当前`playwright.config.ts`的失败截图不是视觉差异门禁。
- **U03–U06 / P6.3及后续能力：** 按[逐页清单](../design/frontend-pages.json)迁移与验收全部页面，覆盖亮暗主题、1366×768/1440×900/1920×1080、窄屏及200%缩放、长文本、加载/错误/筛选空、弹层焦点回位、非拖拽替代。新页面随所属任务增加样本。
- 自动检查不能替代完整键盘任务走查，也不能据部分对比度用例宣称全站通过WCAG。每次发布候选检查截图差异并说明预期变更；变更基线需对应设计说明，不自动接受。


## E2E 编写指南

**关键真实栈spec骨架**（此发现范围保持真栈；mock页面测试按上节另行装配）：
```ts
import { test, expect } from '@playwright/test'
import { loadState, api, apiLogin, psql, pgAvailable } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(120_000)  // 三栈链路（app+上游）给足
test('场景描述', async ({ page }) => {
  const state = loadState()                  // globalSetup 建好的凭据（admin/operator/viewer）
  await uiLogin(page, state.admin.employeeNo, state.admin.password)
  await expect(page.getByRole('menuitem', { name: 'XX' })).toBeVisible({ timeout: 15_000 })
  await page.goto('/#/xx')
  // 将XX替换成真实可达菜单/路由，并断言业务数据及API回读；这不是可直接运行的完整用例
})
```

**定位纪律**（踩坑浓缩）：
- 登录锚点一律 `e2e/ui.ts`（共用登录锚点，改登录页同步检查调用者）；
- **禁 `.el-form-item` 过滤定位**（FilterBar 批后 form-item 已 div 化）——按
  placeholder（`getByPlaceholder('用户名')`）/ data-testid / 控件文本
  （`.filter-bar` scope）/ 列锚（`columnheader`）定位；
- el-dropdown 菜单 teleport 到 body——用触发按钮键盘Enter打开，以
  `page.getByRole('menuitem', { name, exact: true })` + visible 过滤；远程Select按combobox的
  `aria-controls`限定当前listbox，等目标option可见后用ArrowDown/Enter选择，防命中过期传送层；
  getByText/ByRole name 默认**子串匹配**——空态文案勿含 Tab 名子串；
- 生产构建的富文本断言看预览DOM、出站请求及详情回读，不读取`__vueParentComponent`等开发期内部状态；
- 动态路由页面 `goto` 后 `reload()` 一次（冷启动保险）。

**造数/清理**：
- API 造数用 `api()` + admin token；幂等后缀 `Date.now().toString(36)`；
- 无 API 触发面的表（如 panic_logs）→ `psql()` 直插 + `finally` 清理 +
  `pgAvailable()` 优雅降级（无 DB 环境跳过不 fail）；
- 跨 spec 状态互踩防：临时类型/规则 finally 删除；不依赖其他 spec 残留。

**运行前提**：五栈在位（app@33333/activelist@18081/taskrunner@18080/PG/Redis）+
vite webServer 自动拉起（Playwright 探测 127.0.0.1:4000——strictPort 已启，
端口被占会显式失败不静默漂移）。串行 workers=1（共享 dev 栈 DB 防互踩）。

## 密集夹具与限流预算（2026-11-06 审计复验）

标准栈`rate_limit.default`为20rps/40burst，登录后按user_id共享，换device/token不能隔离。
真实全量曾在同一秒叠加6个Node夹具/assign和35个浏览器请求，reload的menus被429/10007拒绝；
原失败必须保留，不能失败后盲重试或放宽服务端规则。S2密集夹具完成、S3a夹具完成及APIassign后强制reload前，
用`waitUserRateBudget`预留40/20秒+100ms完整补桶窗。该节奏有运行配置与request_id时序证据；
若测试栈限流配置变化，须重新核预算。FE4零错误断言保持，不把所有429加入白名单。

## 工单请求契约窄接线（2026-11-06 审计修复）

工单域本批仅Create/Assign两路入参绑定generated。Create保留不暴露assigned_to的发起约束；后端CustomData是动态键值对象，但Swag仅输出object、无additionalProperties，生成器将其收成Record<string,never>，因此仅Create.custom_data适配Record<string,unknown>。Assign仅assigned_to补null以保留取消分派，supervisor等字段完全沿生成类型，不单独覆写。两处supervisor分别string→boolean必须令真实页面与请求单测编译失败；正向同时核字符串大ID、自由对象与显式null取消。其余工单入参/响应仍未全量接线；此静态契约不改变无字段定义类型的既有后端G2验证边界。

## 防漂移哨兵矩阵

**静态扫描层（六哨兵）**：

| 哨兵 | 文件 | 拦截什么 |
|---|---|---|
| EP 导入完整性 | `src/epImports.test.ts` | 模板 el-* 缺 import（运行时静默失效）+字符串 prefix-icon 死图标 |
| useTableFit 挂接 | `src/epImports.test.ts` 的 `手动 el-table 挂接 useTableFit` 用例（文件内第三个it） | 手动 el-table 漏挂（列宽不随容器重排） |
| 分页覆盖 | `src/paginationCoverage.test.ts` | 含 el-table 页面无任何分页设施（数据增长型缺口——247/51/84 三例事故后立） |
| UI 惯例 | `src/uiConventions.test.ts` | 主列表缺 #empty 空态引导/placeholder 超宽截断/el-input-number 漏 `:controls="false"` |
| 图标注册 | `src/icons.test.ts` | 视图直写未注册图标（死图标） |
| apiPaths 前缀 | `src/api/apiPaths.test.ts` | API 路径漏网关前缀 |

**运行时层（E2E 内嵌断言，静态扫描看不见订阅关系类缺陷）**：

| 哨兵 | 文件 | 拦截什么 |
|---|---|---|
| 空 id 附件请求 | `e2e/s5-storage-smoke.spec.ts` B5-3 结尾断言 | keep-alive 缓存详情实例被隐形重渲染后，route 派生自动请求面发空/发错请求（2026-11-09 空 id 400 事故——`/tickets//attachments` 每次进出详情必弹，e2ea7171 修+哨兵，变异验牙已过） |



以上是守卫能检查的合同，不代表其覆盖所有运行时行为；当前viewNames、跨仓事件词表和generated窄接线还承担各自契约验证，源码与测试名是定位依据。
