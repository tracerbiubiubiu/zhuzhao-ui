# 复核：HEAD `349c48f0` 及其未提交并行改动——3 处 Element Plus 组件未导入致运行时失效

- 复核时间：2026-10-03
- 复核对象：`d256f2c8..349c48f0`（已提交）+ 工作树中未提交的并行写入（`e2e/helpers.ts`、`e2e/w5-audit-log.spec.ts`）
- 复核方式：读 diff + 容器实测 + 真实 Playwright 探针 + 全仓静态扫描 + 门禁复跑
- 结论：**上轮报告的 ③④ 已真修且实测有效；①② 由并行写入者在做且方向正确；但由此触发实测失败，深挖出 3 个真实运行时缺陷（此前被静默放行）**

---

## 一、上轮 ③④ 落地核实（已提交，判「真修」）

| 项 | 位置 | 核实结果 |
|---|---|---|
| ③ 注释错字「过濤」→「过滤」 | `e2e/w5-audit-log.spec.ts:4` | ✅ 已恢复为「按自身工号**过滤**断言非空」 |
| ④ `LIKE` 下划线过宽 | `e2e/w5-audit-log.spec.ts` finally 清理 | ✅ 改为 `LIKE 'e2e\_panic\_%' ESCAPE '\'` |

**④ 的实测证据（金丝雀试验，走真实 `psql()` 链路）**：

```
overbroad(expect f) = f        -- 'e2eXpanicY_abc' 不再命中
normal   (expect t) = t        -- 'e2e_panic_zzz_000' 仍命中

插两行 → 跑 spec 里那条 DELETE →
rows after delete = e2eXpanicY_canary      -- 不该删的存活 ✅
                    (e2e_panic_canaryX 已被删)  -- 该删的删掉 ✅
after cleanup = (空)                        -- 金丝雀清理干净 ✅
```

即：**该删的删、不该删的不删**，转义与 `JSON.stringify` 之后的 shell 引号链路均正确。

---

## 二、并行写入者对 ①② 的处理（未提交，方向正确）

| 上轮问题 | 处理 | 评价 |
|---|---|---|
| ① `docker exec <容器名> psql` 硬耦合、无优雅降级 | 抽出 `helpers.ts` 的 `psql()` / `pgAvailable()`；容器名/用户/库经 `E2E_PG_CONTAINER` / `E2E_PG_USER` / `E2E_PG_DB` 可覆盖；`execSync` 加 10s 超时；`pgAvailable()` 不可达时**跳过 panic 段而非失败** | ✅ 两点都做到位 |
| ② 翻页从未真测（2 行 < pageSize 20） | 预造 **25 行**；断言首页满 20 行 → 点第 2 页 → 断言剩 5 行 | ✅ 思路正确 |

实测：`panic_logs` 测试后回到 **0**（`finally` 清理仍有效）；`pgAvailable()` 在本环境返回 `true`。

---

## 三、新 spec 实测失败 → 挖出 3 个真实运行时缺陷

`npx playwright test e2e/w5-audit-log.spec.ts --trace=off` → **1 failed，且重试同样失败**：

```
> 70 | await panicPane.locator('.el-pagination .el-pager li').filter({ hasText: '2' }).click()
     |      Test timeout of 90000ms exceeded.  (waiting for locator)
```

第 64/68 行（首页 20 行、总数 25）**已通过** ⇒ 预造与数据面无问题，**只有分页器点不到**。

### 根因：项目**没有全局注册 Element Plus**

- `src/plugins/elementPlus/index.ts:5-7` = 仅 `app.use(ElLoading)`
- `src/components/index.ts:5-8` = 仅 `app.component('Icon', Icon)`
- `vite.config.ts:24` 用的是 `unplugin-element-plus/vite`——**只按需引样式，不注册组件**

⇒ 每个 SFC 的模板里用到 `el-*`，**必须在本文件 import 对应 `ElXxx`**。少了就只是 Vue 运行时 warn，**静态门禁全绿也抓不到**。

### 三处缺陷（全仓静态扫描 48 个 `.vue` / 202 处 `el-*`，仅此 3 处）

| # | 文件 | 缺失导入 | 模板用法 | 用户可见后果 | 严重度 | 现有覆盖 |
|---|---|---|---|---|---|---|
| 1 | `src/views/audit/log/index.vue` | `ElPagination` | `<el-pagination>`（L177） | Panic 聚合**分页器完全不渲染** → 永远只能看前 20 条聚合指纹 | 高（功能缺失） | 新断言已捕获；HEAD 旧版不点分页器故**静默放行** |
| 2 | `src/views/al/types/index.vue` | `ElDialog` | `<el-dialog>`（L205/243） | 注册/演进类型编辑器**退化为常驻内联块**：无遮罩、无关闭、内容直接铺在页面上 | 高（功能+视觉） | ❌ E2E 未覆盖（`w5-al-pages` 只断言该页表格行，`.el-dialog` 用在 `/al/data` 页） |
| 3 | `src/views/system/user/index.vue` | `ElAlert` | `<el-alert v-if="orgsError">`（L503） | 组织分配失败时的错误提示不显示 | 低 | ❌ 未覆盖 |

### 运行时铁证（#1 与 #2 已用真实页面坐实）

```
#1 audit 页 Panic Tab
PROBE_RESULT {"unknownTagCount":1, "unknownOuter":"<el-pagination total=\"0\" current-page=\"1\" page-size=\"20\" layout=\"prev, pager, next\"></el-pagination>"}
[Vue warn]: Failed to resolve component: el-pagination   at <AuditLogPage>

#2 al/types 页点「注册类型」
PROBE_RESULT {"realDialog":0, "rawTag":1, "rawOuter":"<el-dialog modelvalue=\"true\" title=\"注册类型\" width=\"640px\">...<form class=\"el-form ...\">"}
[Vue warn]: Failed to resolve component: el-dialog
```

即：组件被当成**未解析的自定义元素原样渲染**——`#1` 无子节点等于隐形；`#2` 子节点（类型名/字段定义/取消/注册按钮）被当普通内联内容常驻渲染。

`#3` 为静态确认（同一机制、同一文件形态）；触发需造出 `orgsError`（API 失败）场景，未做运行时触发。

---

## 四、门禁复跑（本机）

| 门禁 | 结果 |
|---|---|
| `npx eslint .` | ✅ 0（全量） |
| `npx vue-tsc --noEmit --skipLibCheck` | ✅ 0 |
| `npx vitest run` | ✅ 13 文件 / 106 用例全过 |
| `npx vite build --mode pro` | ✅ 产物正常 |
| `npx playwright test e2e/w5-audit-log.spec.ts` | ❌ 1 failed（即上文 §三，**由新断言暴露的真缺陷**） |

> 注意：**HEAD（`349c48f0`）上套件是绿的**——旧版 spec 只断「共 N 个聚合指纹」文本，从不触碰分页器元素。故该缺陷是「一直存在、被静默放行」；并行写入者新增的分页断言正在做它该做的事。

---

## 五、建议

### 1）最小修复（3 行）

```diff
--- a/src/views/audit/log/index.vue
-import { ElAlert, ElButton, ..., ElInput, ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag } from 'element-plus'
+import { ElAlert, ElButton, ..., ElInput, ElPagination, ElTabPane, ElTable, ElTableColumn, ElTabs, ElTag } from 'element-plus'

--- a/src/views/al/types/index.vue
-  ElSwitch, ElTable, ElTableColumn, ElTag, ElSelect, ElOption, ElAlert,
+  ElSwitch, ElTable, ElTableColumn, ElTag, ElSelect, ElOption, ElAlert, ElDialog,

--- a/src/views/system/user/index.vue
-  ElButton, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElMessage,
+  ElButton, ElAlert, ElCard, ElDialog, ElForm, ElFormItem, ElInput, ElMessage,
```

### 2）补一道廉价回归闸（这类缺陷静态门禁抓不到，值得固化）

把本次的扫描逻辑（SFC 模板里的 `el-*` / `<ElXxx>` 是否在本文件 import）做成单测或 lint 规则——48 个 `.vue` 全量扫描毫秒级，能一次性锁死同类回归。

### 3）补覆盖

- `w5-al-pages.spec.ts` 增加：`/al/types` 点「注册类型」→ 断言 `.el-dialog` 可见 + 关闭后不可见。
- 若触发成本高，`system/user` 的 `orgsError` 提示可改用可注入的失败路径或降级为不进 E2E。

---

## 六、附带发现：一处口径漏改（P3）

`AGENTS.md:20` 的 i18n 段落仍写「需连带迁移 `e2e/ui.ts` 登录锚点（**18** spec 依赖）」。实测 `uiLogin` 被 **19** 个 spec 文件引用（`e2e/` 下 20 个文件命中，扣除定义它的 `ui.ts`）——`s16-cross-user-session` 加入后这条未同步。

同文件 `:13`、`:45` 与 `README.md:36`、`:9` 均已是「19 spec / 21 用例」（实测一致 ✅），**唯独 `:20` 漏改**。属既有「禁止两处不同值」规则的残留，建议 18 → 19。

---

## 七、边界与诚实标注

- 本次**未跑 E2E 全量**（仅跑 `w5-audit-log` + 两个临时探针，探针跑完已删）。HEAD 之上其余 spec 的绿/红未独立复跑。
- 探测过程中产生的工作树改动**仅**并行写入者的两个 e2e 文件；我未修改任何仓内文件，临时探针 spec 与其产物已清理。
- 工作树当前：`M e2e/helpers.ts`、`M e2e/w5-audit-log.spec.ts`（**他人未提交改动，我未触碰**）。
