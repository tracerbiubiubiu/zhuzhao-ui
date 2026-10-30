# 前端测试规范 — 测试分层/不 mock 决策/防漂移闸/非 admin 哨兵/运行纪律

> 协作协议 SSOT = [AGENTS.md](../AGENTS.md)（六件门禁命令与 E2E 运行前提），本文不重复命令、**不含计数**（口径 SSOT=AGENTS「文档规范」，随实际增长同批同步），只固化**测试策略与纪律**——为什么这样测、每层拦什么、哪些教训不许重蹈。新增/改动测试前必读。

## 分层与职责边界（Testing Trophy 形态）

| 层 | 载体 | 拦什么 | 不拦什么 |
|---|---|---|---|
| 静态扫描闸（六哨兵） | TS strict + eslint + **扫描闸**：`src/epImports.test.ts`（el-* 导入/字符串 prefix-icon/el-table 漏挂 useTableFit）+ `src/paginationCoverage.test.ts`（分页覆盖）+ `src/uiConventions.test.ts`（空态引导/placeholder 宽度）+ `src/icons.test.ts`（图标注册）+ `src/api/apiPaths.test.ts`（网关前缀）——全矩阵见 frontend-standard「防漂移哨兵矩阵」节 | "静态门禁全绿但运行时静默失效"类缺陷（模板缺 import=分页器隐形、漏挂=列宽不随容器重排、分页缺失=数据增长后才显形——247/51/84 三例事故） | 逻辑错误、运行时权限问题 |
| 单测契约闸 | Vitest（请求层单飞刷新/动态路由解析/viewNames 种子派生/cursorPager/errorToast 等） | 关键契约的漂移（后端种子改了前端没跟、并发竞态回归） | 纯道具式断言（禁止为覆盖率写无语义用例） |
| E2E 真栈 | Playwright（S1–S8/S10/S12/S16/FE3·FE4/W4·W5/P4 穿插池） | 场景级回归（登录/改密/CRUD/跨用户会话/角色边界），断言真数据级 | 布局审美细节（人眼/探针）、非可达路径 |
| FE4 哨兵 | `e2e/fe4-nonadmin-hygiene.spec.ts` | operator/viewer 双角色可达路由遍历——**零 4xx/5xx API 响应 + 零「无权限/内部错误」toast** | 管理面（admin 专属，FE3 覆盖 404 边界） |

职责铁律：**每层只拦自己那类**——用 E2E 验布局、用单测验场景、为覆盖率写无语义用例，都是反模式。

## 不 mock 决策（有意偏离，翻案须评审）

E2E 打真实五栈（PG/Redis/app/activelist/taskrunner）、断言真数据级；单测不触网；**两者之间无 MSW 类 mock 层**——业界常见的 mock 集成测试被有意省略。

- **理由**：契约保真（mock 与真实现的漂移正是历史缺陷源）、单仓单人开发真栈搭建成本低（`scripts/dev-stack.sh` 一键）、"断壳不断数据"式假绿有前科；
- **代价**：E2E 需真实数据铺底（globalSetup 幂等建号 + 各 spec 自建自清）、需**独占跑**（见运行纪律）；
- **翻案触发器**：多人并行开发前端 / 真栈搭建成本失控 / E2E 时长影响交付节奏。

## 变异验牙纪律（新闸必证有牙）

新增防漂移闸（扫描/契约断言类）合入前**必须变异证明**：故意制造目标缺陷→测试变红→还原。先例：epImports（删模板 import→红）、useTableFit 扫描（摘 Profile 挂接→红）。未验牙的闸视同不存在。

## 非 admin 盲区教训（2026-10-12 双例）

两例缺陷均为 admin 单账号 E2E 的盲区：① 工单列表筛选占位符冲突 500（`4a18789`——viewer/operator 任意筛选即 500）；② 任务定义 Tab 急切拉 `/jobs` 403 toast（`ce13f5d7`——Tab 未按 task:manage 门控）。由此固化：

1. **FE4 哨兵**常驻（双角色 × 8 可达路由），新增可达页面须加入其 ROUTES 集；
2. **权限门控不止按钮**：Tab/面板/区块若挂 admin 专属数据面，面板本体必须按权限门控（v-if/usePermission），仅按钮 v-permission 不够；
3. 涉及角色差异的改动，**至少一个非 admin 账号人工过一遍**（凭据见 globalSetup 预设）。

## 设计内探针 403 白名单（显式登记制度）

FE4 断言的 4xx 白名单必须显式登记在 spec 内并注明语义，禁止隐式忽略：

| 端点 | 语义 |
|---|---|
| `/api/v1/orgs/members/list` | MyOrg 以 403 判定「非 owner」→ 隐藏委托控件（L3 口径，前端故意调） |

扫描闸的豁免同制度：`epImports` 无豁免；useTableFit 豁免清单（ticket/type 对话框定宽表）登记于用例内。

## 运行纪律

- **E2E 独占跑**：两会话并发跑 Playwright 共用 `test-results/` 会互踩 trace 产生随机假失败（2026-10-12 实证）——跑前确认无他方 worker（`ps aux | grep workerProcessEntry`）；
- **CI 为权威**：本地绿≠CI 绿（环境差三连挂教训），推送后 `gh run watch` 核实转绿才算闭环；
- **真数据断言**：E2E 禁止"断壳不断数据"式假绿——断言行数/字段值/API 回读，实测教训入册（五处假绿断言加固批）。

## 触发驱动观察项（现不做，挂起待信号）

- **视觉回归**（Playwright screenshot/Chromatic）：触发=UI 改版开始出现无人发现的回归；
- **a11y 测试**（axe-core）：触发=无障碍合规要求出现。


## E2E 编写指南（2026-10-30 立——27 spec 实战沉淀；spec 注释里的坑收拢成篇）

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
  // ...断言
})
```

**定位纪律**（踩坑浓缩）：
- 登录锚点一律 `e2e/ui.ts`（26 spec 依赖——改登录页先改锚点）；
- **禁 `.el-form-item` 过滤定位**（FilterBar 批后 form-item 已 div 化）——按
  placeholder（`getByPlaceholder('工号，如 E000001')`）/ data-testid / 控件文本
  （`.filter-bar` scope）/ 列锚（`columnheader`）定位；
- el-dropdown 菜单 teleport 到 body——`page.getByRole('option', { name })` +
  visible 过滤；getByText/ByRole name 均**子串匹配**——空态文案勿含 Tab 名子串；
- 动态路由页面 `goto` 后 `reload()` 一次（冷启动保险）。

**造数/清理**：
- API 造数用 `api()` + admin token；幂等后缀 `Date.now().toString(36)`；
- 无 API 触发面的表（如 panic_logs）→ `psql()` 直插 + `finally` 清理 +
  `pgAvailable()` 优雅降级（无 DB 环境跳过不 fail）；
- 跨 spec 状态互踩防：临时类型/规则 finally 删除；不依赖其他 spec 残留。

**运行前提**：五栈在位（app@33333/activelist@8080/taskrunner@8081/PG/Redis）+
vite webServer 自动拉起（Playwright 探测 127.0.0.1:4000——strictPort 已启，
端口被占会显式失败不静默漂移）。串行 workers=1（共享 dev 栈 DB 防互踩）。