# 复核：useTableFit 批自检报告 — 静态结论逐条验证 + 运行时探针

- **日期**：2026-10-08
- **复核对象**：[review-usetablefit-worktree-2026-10-08.md](./review-usetablefit-worktree-2026-10-08.md)（并行会话自检报告，其声明「静态推断未运行时验证」）
- **方法**：源码逐条验证 + **补做报告未覆盖的运行时探针**（侧栏收起→列宽自愈，真栈真浏览器）

## 总判

报告 9 项发现中 **7 项属实、2 项已被后续动作解决**；但 **P1-1 的运行时预言被探针推翻**——静态分析对（无补挂点），用户可见症状不存在。修复建议按新优先级重排。

## 逐项复核

| 项 | 报告定性 | 复核结果 |
|---|---|---|
| P1-1 observer 挂载时跳过且无补挂点 | 静态推断，预言四页侧栏收起复现死区 | **源码属实；运行时预言不成立**（见下探针） |
| P1-2 Profile PAT 表漏挂 useTableFit | 属实 | ✅ 实证（`grep -c useTableFit` = 0） |
| P2-3 import 中插 5 处 | 属实 | ✅ MyOrg:48 / al-data:58 实证 |
| P3-4 AGENTS「六个踩坑」vs 实况七条 | 属实 | ✅ AGENTS:51 vs frontend-standard.md 1–7 条 |
| P3-5 现状清单 Profile 归「本批」误导 | 属实 | ✅ |
| P4-6 重排无 rAF 帧合并 | 属实 | ✅ 源码仅 nextTick |
| P4-7 ProTable.doLayout 死接口 | 属实 | ✅ 无消费方 |
| P4-8 .zcodeignore 去留待决 | 提醒 | **已解决**——`d2f1cdd4` 已随仓入库（决定=随仓提交） |
| P4-9 staged/unstaged 混用 | 提醒 | **已解决**——dfbfba56 卷带 + 后续提交已收口 |

## P1-1 运行时探针（报告缺失的验收点）

**方法**：真栈真浏览器，合成点击 `.v-collapse` 切换侧栏（224px↔72px，300ms transition），三态量
`.el-table__body` 与容器宽度；Home（表 `v-if="recent.length"` 挂载时不存在→observer 未挂）为实验组，
`/tasks`（ProTable 挂载即在→已挂）为对照组。

**结果**：

| 页 | 侧栏展开 | 收起 | 还原 |
|---|---|---|---|
| **Home**（实验组） | body 919 = 容器 919 | body 1071 = 容器 1071 | 919 = 919 |
| **tasks**（对照组） | body 1270 vs 容器 934 | 1270 vs 1086 | 1270 vs 934 |

- **Home 三态全部 body=container 零死区**——即 P1-1 预言的「侧栏收起死区不复愈」**未发生**（body 恰随容器变宽收窄，EP 2.14.4 自身行为覆盖了该场景；机理未深究，用户可见症状不存在）。
- tasks 的 body 恒 1270 是 minWidth 列合计超容器的**合法表内横向滚动**（useTableFit 本就不应压缩 min 宽），非死区缺陷——不能作为对照组证伪。

**结论**：P1-1 降级——「无补挂点」的静态事实保留，但非当前用户可见缺陷。其建议修法（syncObserve 重入 + `watch(tableRef, …, {flush:'post'})`）仍值得做，定性从 P1 功能缺陷降为 **P2 健壮性加固**（防 EP 未来版本行为变化/其他尺寸变化源）。

## 修复面重排（按复核后优先级）

1. **P1-2 Profile PAT 表补挂**（真实漏网，文档口径一致性）；
2. **P3-4 计数**（AGENTS 六个→七个）+ **P3-5 清单**（Profile 移出「本批」或注记 PAT 表豁免/补挂状态）；
3. **P2-3 import 归位 5 处** + **P1-1 健壮性加固**（syncObserve，可同批）+ **P4-6 rAF 合并**（可同批）；
4. **建议采纳**：epImports 式第三道闸（手动 `el-table` 宿主必挂 useTableFit + 豁免清单——对话框/抽屉内定宽表如 ticket/type:467）。

## 探针局限声明

- 单视口（1280）/单浏览器（Chromium headless）；踩坑⑦原始三档宽度实验未复跑；
- tasks 对照组因 minWidth 语义失效，观察者「已挂自愈」的正例未独立证实（Home 反例已足量推翻 P1-1 症状预言）；
- 探针脚本与结论可复现（合成 MouseEvent 路径，无真实输入依赖）。
