# EP 缺失导入修复复核 — 三处真修 + 扫描测试有牙（2026-10-03）

- 复核对象：`1a003a97`/merge `62ac0fab`（三处 EP 导入 + 扫描测试 + 口径残留）、`da7fba70`/merge `c7529e53`（DB helpers + 25 行真分页 + 优雅 skip）、`6fbab90f`/merge `c3bbd14f`（deliverables 整理）
- 复核基线 HEAD：`c3bbd14f`（= `origin/main`，工作树干净）
- 方式：读 diff + 真 E2E 复跑 + 真实页面探针 + 变异测试 + 全量门禁

---

## 一、三处 EP 缺失导入 — 逐项确认

| # | 文件 | 修复 | 确认方式 |
|---|---|---|---|
| ① | `src/views/audit/log/index.vue` | `+ElPagination` | **真 E2E 复跑**：`w5-audit-log.spec.ts` 由「1 failed（点第 2 页超时）」转为 **✓ passed (3.8s)** |
| ② | `src/views/al/types/index.vue` | `+ElDialog` | **真实页面探针**（详见下） |
| ③ | `src/views/system/user/index.vue` | `+ElAlert` | 静态确认：import 已含 `ElAlert`，模板 `:503 v-if="orgsError"` 有对应 |

### ① 分页器（原先静默失效 → 现在真渲染）

`panicPane.locator('.el-pagination .el-pager li').filter({ hasText: '2' }).click()` 此前超时；修复后整条 spec 通过，且其断言链（首页满 20 行 → 点第 2 页 → 剩 5 行）全部成立 ⇒ **25 行真分页断言真正绿了**，不是降级绕过。

### ② 类型编辑器弹窗（原先退化为常驻内联块 → 现在真弹窗）

修复前后探针对比：

| 时刻 | `realDialog` | `rawTag` | 说明 |
|---|---|---|---|
| 修复前（上一轮） | 0 | **1** | 裸 `<el-dialog>` 自定义元素，内容常驻内联、无遮罩、无法关 |
| 修复后 · 初始态 | 0 | **0** | 真组件且受 `v-model` 控制，正确隐藏 |
| 修复后 · 点「注册类型」 | **1** | 0 | `hasMask: 2`（`.el-overlay` 遮罩在位）、`字段定义` 可见 |
| 修复后 · Escape | — | — | `not.toBeVisible` 成立（**可关闭**） |

且 **`WARNINGS []`** —— console 中不再出现 `Failed to resolve component`。

### ③ 组织分配错误提示

静态确认（导入已补齐）。运行时未触发：需造出 `orgsError`（API 失败）场景，本轮未做，标注为**静态确认**。

---

## 二、新增扫描测试 `src/epImports.test.ts` — 确认**有牙**

```text
变异：从 audit/log/index.vue 删掉 ElPagination
→ npx vitest run src/epImports.test.ts
→ 1 failed：
  "src/views/audit/log/index.vue: <el-pagination> 需要 import ElPagination（缺失 → 运行时静默失效）"
恢复后 → 1 passed
```

即：该测试精确点名文件与标签，且 `expect(files.length).toBeGreaterThan(30)` 保证不会「扫到 0 个文件而假绿」。**这是接住这类缺陷的第一道自动闸**（eslint/vue-tsc/build 均不查模板组件导入）。

---

## 三、口径残留与 deliverables 整理

- `AGENTS.md:20` 「登录锚点（**18** spec 依赖）」→ 「（**19** spec 依赖）」✅ 与我上轮实测一致（`uiLogin` 被 19 个 spec 引用）。
- 单测计数随新测试文件同步 13→**14 文件**、106→**107 用例**（`AGENTS.md:10`/`:45`、`README.md:9`/`:33` 全改），与实测一致 ✅。
- `deliverables/` 整理为「顶层基线 + `archive/` 六份跟进 + `README.md` 索引」，所有跟进报告**内容零改动**（含本轮基线报告 `archive/review-missing-el-imports-2026-10-03.md`，144 行原样）✅。

---

## 四、门禁复跑（本机，HEAD `c3bbd14f`）

| 门禁 | 结果 |
|---|---|
| `npx eslint .` | ✅ 0 |
| `npx vue-tsc --noEmit --skipLibCheck` | ✅ 0 |
| `npx vitest run` | ✅ **14 文件 / 107 用例** |
| `npx vite build --mode pro` | ✅ 产物正常 |
| `npx playwright test e2e/w5-audit-log.spec.ts` | ✅ passed（上轮为 failed） |
| `gh run list` | ✅ 最近 5 次含 `62ac0fab`(37129365629)/`c3bbd14f`(37129562408) 全 success |

---

## 五、两点小 nit（不影响结论，建议顺手对齐）

1. **扫描范围比声称窄 1 个文件**：测试实际扫 `views`/`layout`/`components`/`common/components` = **47** 个 `.vue`；`src/App.vue`（第 48 个）不在范围内。测试注释与提交信息均写「48 文件」。当前 `App.vue` 无任何 `el-*` 标签（仅 CSS 变量 `--el-color-primary`）⇒ **当前无害**，但根级 `.vue` 存在盲区。建议把这四处 `walkVue` 合并为 `walkVue(ROOT)`（一行，覆盖全部 48 个）。
2. 同处注释「此前 5 处+3 处=8 处」中的「5 处」无本仓留档可查；若有出处建议补一句指向（便于日后审计）。

---

## 六、边界

- 本轮**未跑 E2E 全量 21 例**（只跑了此前失败的那条 + 自建探针）。提交声称「E2E 21/21」，其中我独立复跑的 1 条 + `vitest 14/107` + CI 绿已交叉印证；其余 20 条沿用其声明，未独立复跑。
- 探测用临时 spec（`zz-probe-*.spec.ts`）与产物已清理；`src/views/audit/log/index.vue` 变异后已 `git checkout` 还原。**工作树现为干净**，未残留我方的任何改动。
- `panic_logs` 跑后 = 0（预造/清理闭环仍有效）。
