# 测试指南 — 分层策略、真实栈与失败复核

> 协作协议见[AGENTS.md](../../AGENTS.md)。本文给出测试职责、执行入口和失败解释；每轮数量/重试/跳过以实际输出为准，不把历史spec数量写作当前运行结果。新增/改动测试前必读。

## 运行命令与通过条件

先按[开发与联调](development.md)确认真实栈、迁移/种子和独占窗口，在UI根目录运行：

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

## 分层与职责边界（Testing Trophy 形态）

| 层 | 载体 | 拦什么 | 不拦什么 |
|---|---|---|---|
| 静态扫描闸（六哨兵） | TS strict + eslint + **扫描闸**：`src/epImports.test.ts`（el-* 导入/字符串 prefix-icon/el-table 漏挂 useTableFit）+ `src/paginationCoverage.test.ts`（分页覆盖）+ `src/uiConventions.test.ts`（空态引导/placeholder 宽度）+ `src/icons.test.ts`（图标注册）+ `src/api/apiPaths.test.ts`（网关前缀）——完整文件与用例见本文“防漂移哨兵矩阵” | "静态门禁全绿但运行时静默失效"类缺陷（模板缺 import=分页器隐形、漏挂=列宽不随容器重排、分页缺失=数据增长后才显形——247/51/84 三例事故） | 逻辑错误、运行时权限问题 |
| 单测契约闸 | Vitest（请求层单飞刷新/动态路由解析/viewNames 种子派生/cursorPager/errorToast 等） | 关键契约的漂移（后端种子改了前端没跟、并发竞态回归） | 纯道具式断言（禁止为覆盖率写无语义用例） |
| E2E 真栈 | Playwright（S1–S8/S10/S12/S16–S17/FE3·FE4/W4·W5/P4/P5 穿插池；完整发现范围以playwright配置和e2e/*.spec.ts为准） | 场景级回归（登录/改密/CRUD/跨用户会话/角色边界），断言真数据级 | 布局审美细节（人眼/探针）、非可达路径 |
| FE4 哨兵 | `e2e/fe4-nonadmin-hygiene.spec.ts` | operator/viewer 双角色可达路由遍历——**零 4xx/5xx API 响应 + 零「无权限/内部错误」toast** | 管理面（admin 专属，FE3 覆盖 404 边界） |

职责铁律：**每层只拦自己那类**——用 E2E 验布局、用单测验场景、为覆盖率写无语义用例，都是反模式。

## 不 mock 决策（有意偏离，翻案须评审）

E2E 打真实五栈（PG/Redis/app/activelist/taskrunner）、断言真数据级；单测不触网；**两者之间无 MSW 类 mock 层**——业界常见的 mock 集成测试被有意省略。

- **理由**：契约保真（mock 与真实现的漂移正是历史缺陷源）、单仓单人开发真栈搭建成本低（`scripts/dev-stack.sh` 一键）、"断壳不断数据"式假绿有前科；
- **代价**：E2E 需真实数据铺底（globalSetup 幂等建号 + 各 spec 自建自清）、需**独占跑**（见运行纪律）；
- **翻案触发器**：多人并行开发前端 / 真栈搭建成本失控 / E2E 时长影响交付节奏。

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
- **真数据断言**：E2E 禁止"断壳不断数据"式假绿——断言行数/字段值/API 回读，实测教训入册（五处假绿断言加固批）。

## 触发驱动观察项（现不做，挂起待信号）

- **视觉回归**（Playwright screenshot/Chromatic）：触发=UI 改版开始出现无人发现的回归；
- **a11y 测试**（axe-core）：触发=无障碍合规要求出现。


## E2E 编写指南

**新建 spec 骨架**（打真实栈，不用 stub——分层见上表）：
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
