# 复核 `eea5b8e5`（epImports 扫描 nit①②）— nit① 真实生效；nit② 口径已纠正并补闸（已闭环）

- 复核对象：`eea5b8e5`（HEAD = `origin/main`，工作树干净）
- 复核方式：读 diff + 变异测试 + 出处溯源 + 全量门禁

## 一、nit①（扫描扩全 ROOT）— **真实生效，非只改断言数字**

`walkVue(ROOT)` + `files.length >= 48`。

**变异验证**：往 `src/App.vue` 模板插 `<el-zzz-probe />` → 测试如期 failed 并点名：

```text
src/App.vue: <el-zzz-probe> 需要 import ElZzzProbe（缺失 → 运行时静默失效）
```

⇒ 根级 `.vue` 盲区确已补上（此前四目录拼装漏 App.vue）。还原后 passed。

## 二、nit②（「8 处」出处注记）— **张冠李戴，建议改口径**

注记（`src/epImports.test.ts` 头注释）称：

> 本测试是唯一的自动捕获层（此前 5 处+3 处=8 处缺陷全部静默溜过：5 处=四轮审计 #7 批 `fc027b8e`——LoginForm×2+ChangePassword×3；3 处=复核报告 …）

实读 `fc027b8e` diff：该批是 **字符串 `prefix-icon="Lock"` → `#prefix` 插槽 + `<Icon>`**（**五个死图标**；根因 `resolveDynamicComponent` 对未注册名渲成未知原生元素），**未新增任何 Element Plus 组件 import**。

⇒ 与「模板 `el-*` 缺组件 import」**不是同一类缺陷**。数字 5 恰等于那 5 个死图标，被误当同类出处。**后果**：把「唯一自动捕获层」的覆盖面夸大 5 处——`epImports.test.ts` **只能覆盖缺 import 一类（3 处）**，覆盖不到 `prefix-icon` 字符串类。

**建议改为**：

> 本测试覆盖「模板 `el-*` 缺 import」一类（已捕获并修复 3 处：audit/log+al/types+system/user）。另一类「字符串 `prefix-icon/suffix-icon` 未注册名」缺陷（`fc027b8e` 批修 5 处，根因 `resolveDynamicComponent`）本测试覆盖不到，且**该类目前无自动闸**。

## 三、附带核查

- `prefix-icon="` / `suffix-icon="` 全仓**已清零**（`fc027b8e` 修复到位）。
- 该类**无任何自动闸**。可选：把「模板中禁用字符串 `prefix-icon`/`suffix-icon`」也收进 `epImports.test.ts`，两类一次锁死（成本≈一行正则）。

## 四、门禁复跑（HEAD `eea5b8e5`）

| 门禁 | 结果 |
|---|---|
| `npx eslint .` | ✅ 0 |
| `npx vue-tsc --noEmit --skipLibCheck` | ✅ 0 |
| `npx vitest run` | ✅ 14 文件 / 107 用例 |
| `vite build --mode pro` | ✅（`c3bbd14f` 已验证；本批仅动测试+文档） |
| CI `eea5b8e5` run 37129981526 | ✅ success |

## 五、边界

- 本节结论仅针对**注释口径**，不影响产品行为：三类 EP 缺陷与 5 处死图标**均已修复**，无功能遗留。
- 复核阶段**零仓内改动**：`src/App.vue` 变异后已 `git checkout` 还原；无探针/产物残留。

## 六、闭环：口径纠正 + 字符串闸已同批落地

按 §二建议实施（同批提交）：

1. **口径纠正**（`src/epImports.test.ts` 头注释）：改为按**类**陈述——本测试覆盖「模板 `el-*` 缺 import」类（3 处）；另列「字符串 `prefix-icon/suffix-icon` 未注册名」类（`fc027b8e` 批 5 处），并注明由本文件第二个用例覆盖。不再把两类合并成「8 处」。
2. **新增第二用例**（字符串闸）：全仓 `.vue` 模板扫描字符串 `prefix-icon`/`suffix-icon`，负向断言排除绑定写法 `:prefix-icon="…"`；去 HTML 注释防误报。
3. **口径同步**：单测 107 → **108 用例**，`AGENTS.md:10`/`:45`、`README.md:9`/`:33` 四处同步（「禁止两处不同值」）。

### 验证证据（双向变异）

| 变异 | 期望 | 实测 |
|---|---|---|
| `App.vue` 插 `prefix-icon="Lock"`（字符串） | 报警并点名 | ✅ `src/App.vue: 字符串 prefix-icon="…"（应改 #prefix 插槽 + <Icon>）` |
| `App.vue` 改 `:prefix-icon="Lock"`（绑定） | **不**误报 | ✅ 2/2 passed（负向断言生效） |
| `App.vue` 插 `<el-zzz-probe />`（上例） | 报警并点名 | ✅ `src/App.vue: <el-zzz-probe> 需要 import ElZzzProbe` |

门禁：`eslint .` 0 / `vue-tsc --noEmit --skipLibCheck` 0 / `vitest run` **14 文件 / 108 用例**。

