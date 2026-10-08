# deliverables/ — 时点报告

> 命名 `<topic-kebab>-<YYYY-MM-DD>.md`（对齐主仓 deliverables/ 惯例）；AGENTS「文档规范」。

## 结构

- **顶层**：审计链**基线**（31 项台账 SSOT——README 状态段的逐项证据来源）+ 后续新报告
- **archive/**：已闭环的**跟进复核报告**（发现→修复→复核确认全链走完，留档不改）

## 审计链（2026-10-01 → 10-03，全部闭环）

| 文件 | 性质 | 一句话 |
|---|---|---|
| [audit-recheck-4rounds-2026-10-01.md](./audit-recheck-4rounds-2026-10-01.md) | **基线** | 四轮审计 31 项处置（10 解决/3 部分/3 取舍/13 遗留/2 撤回）；P1-2 假修实锤 |
| [phase4-implementation-summary-2026-10-03.md](./phase4-implementation-summary-2026-10-03.md) | **实现整理** | W2–W5+穿插池实现全貌（架构分层/23 视图/测试资产/取舍边界），数字全实测 |
| [archive/review-recheck-batch-2026-10-02.md](./archive/review-recheck-batch-2026-10-02.md) | 跟进 | P1-2 真修+viewNames 种子派生+图标扫描——变异测试证明门禁有牙 |
| [archive/review-ci-e2e-fixes-2026-10-02.md](./archive/review-ci-e2e-fixes-2026-10-02.md) | 跟进 | CI 修复（主仓 checkout）+E2E 加固+i18n 拍板 zh-only |
| [archive/verify-round3-full-2026-10-02.md](./archive/verify-round3-full-2026-10-02.md) | 验证 | 第三轮全量——date-only 合规/主仓对账/遗留抽样 |
| [archive/review-closing-batch-2026-10-03.md](./archive/review-closing-batch-2026-10-03.md) | 跟进 | 收尾批（P2-5 端点+P3-4 定性+P3-12 骨架）——31 项全清账 |
| [archive/review-closing-batch-gap-fills-2026-10-03.md](./archive/review-closing-batch-gap-fills-2026-10-03.md) | 跟进 | 遗留①②补齐（路由回归+回显路径）+E2E 计数 19→20 |
| [archive/review-missing-el-imports-2026-10-03.md](./archive/review-missing-el-imports-2026-10-03.md) | 跟进 | 3 处 EP 缺失导入（Panic 分页器/类型编辑器/错误提示静默失效）+扫描测试固化 |
| [archive/review-ep-fix-closeout-2026-10-03.md](./archive/review-ep-fix-closeout-2026-10-03.md) | 复核确认 | 三处 EP 修复端到端验证（真 E2E + 探针）+ 扫描测试变异证明有牙 + 门禁全绿 |
| [archive/review-ep-scan-nits-2026-10-03.md](./archive/review-ep-scan-nits-2026-10-03.md) | 复核确认 | `eea5b8e5` nit① 变异验证生效；nit②「8 处」口径误标纠正 + 新增 prefix-icon/suffix-icon 字符串闸（双向变异） |
| [review-usetablefit-worktree-2026-10-08.md](./review-usetablefit-worktree-2026-10-08.md) | 自检 | useTableFit 批+漏网补齐批工作树核查（9 项发现：P1-1 observer 无补挂点/P1-2 Profile 漏挂/import 卫生/计数漂移） |
| [review-usetablefit-verify-2026-10-08.md](./review-usetablefit-verify-2026-10-08.md) | 复核 | 上报告逐条验证+运行时探针——9 项 7 属实/2 已解决；P1-1 静态属实但症状预言被推翻（Home 三态零死区），降级 P2 加固 |
| [commit-attribution-audit-2026-10-08.md](./commit-attribution-audit-2026-10-08.md) | 审计 | 当日三仓 ~25 笔提交归属审计——交叉污染恰 2 笔双向各一、内容零错位、决策不重写共享 main（fix-forward 已注记） |

## 终态

31 项处置：**27 解决 / 3 设计取舍 / 0 遗留 / 1 撤回**——全部清账（2026-10-03）。
