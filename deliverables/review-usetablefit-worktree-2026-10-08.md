# 工作树代码核查 — useTableFit 列宽兜底批 + 漏网补齐批

> 核查对象：HEAD `7e205a8a` 之上的未提交工作树（1 个未跟踪新文件 + 11 个已改文件 + 6 个已 staged 条目）
> 核查方式：读 diff/源码 + 全仓静态扫描 + 门禁实测；**未跑 E2E**（需真实后端栈）

## 门禁实测

| 门禁 | 结果 |
|---|---|
| `npx eslint .` | ✅ 无告警 |
| `npx vue-tsc --noEmit --skipLibCheck` | ✅ 无输出 |
| `pnpm test` | ✅ **15 文件 / 115 用例**（与 AGENTS 计数一致） |
| E2E | ➖ 未跑（无 dev 栈；本批为布局类改动，回归成本见文末建议） |

## 本批在做什么

新增 `src/common/hooks/src/useTableFit.ts`（ResizeObserver 盯表格父容器 + window resize → `doLayout()`），
为 EP 2.14 的「容器尺寸变化后 el-table 列宽不重排」缺陷兜底；ProTable 内置，另有 8 处手动 `el-table` 逐页挂接；
同时补 system/org、system/menu 两页的填充链，并把 `docs/frontend-standard.md` 的 `table-standard.md` 旧引用改正。

## P1 — 功能缺陷（静默失效）

### 1. `useTableFit` 的 ResizeObserver 在「表格被 `v-if` 门控」的页面永不生效

`useTableFit.ts:26-33`：`observer.observe(parent)` **只在 `onMounted` 执行一次**，`parent` 取自
`tableRef.value?.$el?.parentElement`。若挂载时表格还没渲染（`v-if` 为假），`tableRef.value` 为 `undefined`
→ 该次 `observe` 直接跳过，且此后**没有任何补挂点**。

四个页面的表恰好在挂载时不存在：

| 页面 | 门控条件 | 挂载时值 |
|---|---|---|
| `views/Home/index.vue:153` | `v-if="recent.length"` | `recent = ref([])`（异步拉取） |
| `views/MyOrg/index.vue:196` | 外层 `v-if="selectedOrg"` + 内层 `v-else`(readonlyMode) | `selectedOrg` 为 computed over `orgs`（异步） |
| `views/al/data/index.vue:394` | 外层 `v-else` + `v-if="!listLoading && !list.length"` 的 el-empty 的 `v-else` | `list = ref([])`、`listLoading = ref(false)` |
| `views/system/dict/index.vue:238` | `v-else`（`selectedType` 非空分支） | `selectedType = ref(null)` |

后果：这四页**恰好漏掉了该 composable 的首要目标场景**。现有两条兜底只覆盖一部分变化源——
`window.addEventListener('resize')` 不响应侧栏收起（纯 class 切换 + CSS transition，不派发 window resize），
`watchSource` 只在数据到达时补一次。⇒ **侧栏异步收起**（composable 头注释与 frontend-standard.md 踩坑⑦ 的第一个举例）
在这四页仍会复现右侧死区 / 表内横向滚动条。

**建议修法**：把挂接抽成可重入的 `syncObserve()`（内部判 `el !== observedEl` 再 `unobserve/observe`），
在 `watchSource` 回调中调用，并补 `watch(tableRef, syncObserve, { flush: 'post' })` 覆盖「ref 迟挂」；
或直接在 `relayout()` 里先 `syncObserve()`。

> 说明：此结论为**源码静态推断**（10 行内可穷举），未做运行时探针（jsdom 无 ResizeObserver）。
> 已逐页核对门控变量的初值，四项均为「挂载时假」。

### 2. Profile 页 PAT 表整批漏网

`views/Profile/index.vue:225`：`<el-table :data="pats" v-loading="patLoading" row-key="id">`——
含 `min-width="140"` 内容列 + `fixed="right"` 操作列，但**无 `ref`、无 `useTableFit`**，
与 `docs/frontend-standard.md` 新条款「**手动 el-table 必须自行挂接**」直接冲突（该页未被本批触碰）。

风险低于列表页（页面根为 `fill-page p-4 max-w-[720px] mx-auto`，宽度被 720px 封顶，侧栏收起多数情况下不改其宽度），
但内容区 `overflow-y-auto` 出现滚动条时可用宽度会变，仍可复现死区；`fixed="right"` 列位置在重排缺失时更易错位。

**建议**：按文档口径补 `ref` + `useTableFit(patsTable, () => pats.value)`。

> 全仓 `el-table` 共 13 处，逐处核对结果：ProTable 内置 ✓、Home ✓、MyOrg ✓、al/data ✓、al/types ✓、
> dict×2 ✓、audit/log ✓、task/list ✓、ticket/type×2 ✓、**Profile ✗**、
> `ticket/type/index.vue:467`（字段编辑器对话框内，定宽 860px）✗——对话框场景建议在文档里**显式豁免**而非逐个挂。

## P2 — 工程卫生

### 3. 5 处 `import` 被插在 `<script setup>` 中部

`import { useTableFit } from '@vea/hooks'` 落在语句之间，违反本文件「import 全在顶部」的既有惯例：

- `views/MyOrg/index.vue:48`（夹在 `rosterPageSize` 与 `rosterTotal` 之间）
- `views/al/data/index.vue:58`（夹在 `pageSize` 与 `nextCursor` 之间）
- `views/al/types/index.vue:27`（夹在 `queryClient` 与 `typesQuery` 之间）
- `views/task/list/index.vue:116`（夹在 `deadPageSize` 与 `deadEmptyPage` 之间）
- `views/ticket/type/index.vue:45`（贴在注释 `// ─── 类型 Tab ───` 之后）

ESM 提升 ⇒ 功能无碍；eslint 未启 `import/first`、vue-tsc 亦不报 ⇒ **属静态门禁抓不到的口径漂移**。
另 4 处（`Home:14` / `audit/log:15` / `dict:13` / `ProTable:13`）位置正确，可见是插入手法不一致所致。

## P3 — 文档与计数漂移

### 4. `AGENTS.md:51`「**六个**踩坑记录」与实况不符

`docs/frontend-standard.md`「踩过的坑」现为 **1–7 共七条**（本批新增第 ⑦ 条 el-table 列宽拟合）。
本仓明文规则「计数口径随实际增长同步，**禁止两处不同值**」⇒ 应同批改 `六个` → `七个`。

### 5. 现状清单把未覆盖的 Profile 归入「✅ 本批」

`docs/frontend-standard.md` 现状清单末三行为「ticket/detail · ticket/create · Profile · Home → ✅ 内容区内滚（本批）」，
但 Profile 的 PAT 表恰恰是唯一漏挂 useTableFit 的手动表；该页被列入「本批」容易读成「已按新条款处理」。

## P4 — 次要 / 观察项

6. **重排未做帧合并**：`useTableFit.ts:28` 回调仅 `nextTick`。侧栏收起是 ~300ms CSS transition，
   ResizeObserver 逐帧触发 ⇒ 一次收起会连续调用数十次 `doLayout()`，有布局抖动风险；用 rAF 合并即可。
7. **`ProTable` 新增暴露的 `doLayout` 无消费方**（`components/ProTable/index.vue:58`）——留作兜底口可以，
   但建议注释写明「暂未消费，留作外力改容器尺寸时的兜底」，否则是死接口。
8. **`.zcodeignore`（66 行，内容与 `.gitignore` 近乎重复）已 staged 但未进 `.gitignore`**——
   属编辑器/工具配置，请明确「随仓提交」或「本地忽略」二选一（`.workbuddy/` 已按后者处理）。
9. **staged / unstaged 混用**：`docs/frontend-standard.md`、`src/views/MyOrg/index.vue`、
   `src/views/system/dict/index.vue` 为 `MM`（两半都改）。若 `git commit` 不带 `-a`，未 staged 的那半批会被漏提交。

## 建议：补一道自动闸（本仓已有先例）

`src/epImports.test.ts` 正是为「静态门禁全绿也抓不到」的运行时缺陷设立的（模板 `el-*` 缺 import）。
本次的「手动 `el-table` 漏挂 useTableFit」**同类**——eslint/tsc/build/现有单测**全绿**却真实漏了一页。
建议在该文件内加第三个用例：全仓扫 `<el-table` 宿主文件，断言同文件内存在 `ref="…"` + `useTableFit(` 调用，
并配一份显式豁免清单（对话框/抽屉内定宽表）。成本极低，且能防住「新增页忘了挂」和「本批这种漏网」。

## 未覆盖路径

- 未跑 E2E（无 dev 栈在跑）；本批为布局类改动，建议至少在真栈上做一次「侧栏收起 → 四页表格列宽自愈」探针，
  这是 P1-1 的直接验收点（静态推断的运行时确认）。
- 未做 900 高 / ≥1440 高 / ≥2560 宽的三档视口回归（frontend-standard.md checklist 第 5 条要求）。
