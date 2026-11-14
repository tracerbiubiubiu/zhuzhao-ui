# 测试指南 — mock、契约、真实栈与失败复核

> 协作协议见[AGENTS.md](../../AGENTS.md)。本文给出测试职责、执行入口和失败解释；每轮数量/重试/跳过以实际输出为准，不把历史spec数量写作当前运行结果。新增/改动测试前必读。

## 运行命令与通过条件

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

本次新增守卫先证明目标缺陷能使它变红，再还原并跑正向；局部绿不等价全门禁。全门禁未绿不得标记完成，网络/环境失败保留原结果并说明影响。人工与agent验证用专属E000002+，禁止改E000001；仅既定acceptance/globalSetup幂等例外流及break-glass复原按主仓runbook执行。

## 测试先行与单维护者审阅

继续遵主仓[standards §11](../../../zhuzhao/docs/standards.md#11-开发工作流先框架--先测试--分批实现)：当前获准批的正向、负向、边界、权限拒绝用例全量先写，确认因目标行为失败，再实现到绿。编译、环境或夹具错误不算有效红例；红→绿在隔离工作树取证，不要求先提交失败测试，交付仍须现行六件门禁与对应后端组合。

实现与新上下文审查分别读取业务预期、实际diff和原始证据；测试删除/预期改变、skip/重试/阈值、fixture或CI变更须说明业务原因，不能迁就实现制造绿灯。既有静态及运行时负例的变异验牙、非admin真实旅程、mock/contract/real分列和首次失败披露全部保留。分档方向尚未通过G03/协作规则同步与真实分类验证，不在本页自动生效。

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

所有者已明确保留并大量使用mock。旧“没有MSW中间层、等待触发再翻案”是历史实现取舍，**不再是禁止mock的规则**。当前仍未实现完整mock页面层，不能把新策略写成已有工具已经接线；具体框架选择、目录与执行命令随主仓[规划总账](../../../zhuzhao/docs/review/planning-backlog.md)的U02/U07（P6.1）落地，不先新增未存在的命令。

- **mock：开发、状态、交互与视觉。** 使用全合成用户/组织/工单/专业平台响应，覆盖正常、空态、长文本、大量数据、空菜单、无权限、慢请求、错误、乱序、部分成功与重试。页面开发和视觉基线可脱离共享服务，避免为布局走查反复改真实账号；不得使用脱敏真实公司数据。
- **contract：防止mock自说自话。** 请求/响应样本对齐OpenAPI、生成类型和真实接口合同；明确哪些动态字段尚无完整schema。跨仓API变化随批同步样本和消费者检查。样本匹配schema不代表服务端实现必然正确，真实端点仍需验证。
- **real：关键集成、身份与写动作。** 保留现有真实栈E2E，必须验证登录/改密、菜单与自定义最小角色、L1/L2/L3、工单关键动作、标签逐项权限、附件、消息深链、任务/AL网关等。mock通过不能替代真实资源授权、迁移、服务通信和调用回执。专业平台API未提供时保留mock并标明外部真实验证未完成。
- **结果必须分开。** 报告写清mock用例、契约检查、真实栈场景、视觉/键盘检查各自结果和限制，禁止合写“E2E全绿”掩盖数据来源。已有真栈spec保持真实数据断言；新增mock页面测试使用独立发现范围，避免现有`test:e2e`静默变成stub套件。

样本需要稳定时钟、ID与版本，允许按场景组合；合同变化由拥有模块同步维护。生产构建不得依赖测试替身；mock入口、敏感凭据和测试数据的装配隔离作为U02实施验收，不在本次文档批声称已经实现。

## 变异验牙纪律（新闸必证有牙）

新增防漂移闸（扫描/契约断言类）合入前**必须变异证明**：故意制造目标缺陷→测试变红→还原。先例：epImports（删模板 import→红）、useTableFit 扫描（摘 Profile 挂接→红）。未验牙的闸视同不存在。

E2E **运行时**负向断言闸同纪律（2026-11-09 增补）：s5 B5-3「离开详情零空 id 附件请求」哨兵合入前，checkout 缺陷版组件跑 spec 验证精确变红再还原——运行时闸与静态扫描闸同一标准，未验牙视同不存在。

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
- **本地与CI分别核实**：CI跑lint/typecheck/build/audit/test和commit-policy，不跑真实栈E2E；本地六件仍必跑，获授权推送后 `gh run watch` 核实CI转绿才闭环，不能以CI绿替代E2E；
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
