# 复核报告-收尾批遗留补齐-2026-10-03

> 复核对象：`a36f835a..572611a6`（`9e873f4d` test 批 + `1e3a2f81`/`572611a6` merge）
> 复核缘起：上一份复核报告（`deliverables/review-closing-batch-2026-10-03.md`）遗留①②（两处测试覆盖缺口）被补齐，逐项独立复验。
> 复核方式：读源码 + **变异测试** + 门禁实测 + **打真后端复跑 E2E**（本次后端栈在运行，得以独立执行）。

## 一、被复核的声明

`9e873f4d`：「遗留①：routing.test 新增『动态菜单页 /tickets/types 压过静态参数路由 /tickets/:id』；遗留②：s3 分配组织用例补回显路径——保存后重开对话框断言已有绑定预勾选 + 主组织回填。验证：routing.test 12/12（+1）；全量门禁 E2E 20/20；计数三处同步 106。」

## 二、逐项复验

### 遗留①（路由动态压过回归）——✅ 真修，且**有牙**
- 新用例：`src/router/routing.test.ts:106-122`，断言四路 `types→ticket_type_manage` / `new→TicketCreate` / `123→TicketDetail` / `/tickets→ticket_list`。
- **时序真实性**：`buildRouter`（`:36-46`）确为「先 `createRouter({routes: constantRouterMap})`（含静态 `/tickets/:id`）→ 后 `buildRoutes(menus).forEach(addRoute)`」——与生产 `ensureDynamicRoutes` 同序，**非平凡通过**。
- **变异测试（关键）**：删除 `buildRoutes(menus).forEach(router.addRoute)` 生成变异副本后单跑：
  ```
  × 动态菜单页 /tickets/types 压过静态参数路由 /tickets/:id
    AssertionError: expected 'TicketDetail' to be 'ticket_type_manage'
  ```
  即禁用动态注册后该用例**如期失败**，失败模式正是「参数路由吞掉菜单页」——证明断言**有牙**，非假绿。（变异副本已删，原文件 `diff` 校验未被动。）
- 门禁：`routing.test.ts` **12 tests 全过**（+1）✅

### 遗留②（分配组织回显路径）——✅ 真修，**打真后端实证**
- 新增断言：`e2e/s3-user-admin.spec.ts:90-100`——保存后**重开对话框**，断言 `集团总部` 树节点 `.el-checkbox` 具 `is-checked` + 主组织 `.el-select__wrapper` 文本含 `集团总部`。
- **独立复跑（本次后端栈在运行，非只是读代码）**：
  ```
  ✓ S3 admin：表格渲染 + 搜索命中 + 无假搜索项 + 分页器 + 新建按钮权限槽 (3.3s)
  ✓ S3 分配组织（P2-12）：树勾选全量替换 + 主组织 + API 断言绑定 (5.1s)   ← 含新回显断言
  ✓ S3 权限槽：viewer 手输 /system/user 不可达 (2.4s)
  3 passed (13.7s)
  ```
- 该用例**实证了我上轮源码级结论**（`setCheckedKeys` 先于树数据灌入仍生效——element-plus `defaultCheckedKeys` 机制），把「源码推断安全」升级为「真后端行为验证」。

## 三、门禁实测（本机独立复跑）

| 门禁 | 结果 |
|---|---|
| `npx eslint .` | ✅ 0 error / 0 warn |
| `npx vue-tsc --noEmit --skipLibCheck` | ✅ 0 error |
| `npx vitest run` | ✅ **13 文件 / 106 用例全过**（routing.test 12 例，+1） |
| 全量 E2E | ✅ **20 用例全绿**（详见下注） |
| CI | ✅ `572611a6` run 37121289947 `success`（40s） |

**E2E 全量复跑的沙箱注记**：`npx playwright test`（全量）本机得 **19 passed / 1 failed**，失败项 `s7-my-org`：
- 报错 `Error: browserContext._wrapApiCall: Brokered host copy source refused by file policy: prompt`（测试 `ctx2.close()` 处），且沙箱 stderr 明列被拦读的 `test-results/.playwright-artifacts-*/traces/*.network`；
- **隔离复跑 S7（`--trace=off`）→ 1 passed**；且本批**未触碰 S7/my-org 任何代码或用例**。
- 定性：**沙箱拦截 Playwright 产物写入所致，非产品回归**（与记忆「Playwright 二次运行触发沙箱守卫」同类）。故「20/20」成立。

## 四、复核新发现（**计数口径不一致**，本批未闭合）

- AGENTS.md 与 README.md 的「计数口径」均写 **E2E「18 spec / 19 用例」**；本批同步了单测计数（105→106），但**未同步 E2E 计数**。
- **实测**：`e2e/*.spec.ts` 共 **18 spec / 20 用例**（`s3` 3 例 + 其余 17 各自 1 例）——与提交信息自称的 **「E2E 20/20」** 一致，与仓内文档的「19 用例」**矛盾**。
- 溯源：`git log -S "18 spec / 19 用例"` → 该口径行由更早的 `c9d3a507` 引入，**偏差为历史遗留**（本批之前即 19 vs 实际 20）；但本批既已按自身规则「改数量时同批更新 README 与 AGENTS 两处」动了这两处文件，**却只改一处计数**——违反 AGENTS「计数口径……禁止两处不同值」。
- 定级：**P3（文档一致性）**，非功能缺陷。建议改 AGENTS.md/README.md「19 用例」→「20 用例」。

## 五、结论

**两处遗留均已真修**：① 由变异测试证明为「有牙」的真实回归断言；② 由打真后端 E2E 实证回显路径通过（并升级验证了我上轮的源码结论）。门禁全绿（单测 106、E2E 20 用例、CI success）。**唯一新发现**为 E2E 计数口径文档不一致（19 vs 20，P3，历史遗留但本批未闭合）。
