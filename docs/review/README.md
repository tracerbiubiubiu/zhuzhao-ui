# UI 审查 — 当前状态入口与历史报告索引

本文从原 deliverables 索引迁入；正式报告统一在 [reports/](reports/README.md)，原 archive 的跟进报告与基线平铺，发现编号不变。当前操作以[任务导读](../README.md)为准。

## 当前状态应怎样核查

Phase 4 已收官，Phase 5 修复与门禁的最新状态由主仓[项目控制台](../../../zhuzhao/docs/review/11-project-control.md)和[2026-11-08 followup](../../../zhuzhao/docs/review/reports/zhuzhao-report-followup-2026-11-08.md)记录；后续合 main/部署/远端 CI 以实际授权与固定收据为准。UI 本次文档整理尚不代表全门禁已完成，不能把下列旧报告的绿色结果外推到今天。

## 建议阅读顺序

先用基线定位发现编号，再读对应修复/复核，最后看其未跑与原失败边界；useTableFit 自查和复核须成对阅读。正式时点报告保留独有证据，不因旧目录退役而删除或停止跟踪。

## 审计链（2026-10-01 → 10-03，全部闭环）

| 文件 | 性质 | 一句话 |
|---|---|---|
| [audit-recheck-4rounds-2026-10-01.md](reports/audit-recheck-4rounds-2026-10-01.md) | **基线** | 四轮审计 31 项处置（10 解决/3 部分/3 取舍/13 遗留/2 撤回）；P1-2 假修实锤 |
| [phase4-implementation-summary-2026-10-03.md](reports/phase4-implementation-summary-2026-10-03.md) | **实现整理** | W2–W5+穿插池实现全貌（架构分层/23 视图/测试资产/取舍边界），数字全实测 |
| [review-recheck-batch-2026-10-02.md](reports/review-recheck-batch-2026-10-02.md) | 跟进 | P1-2 真修+viewNames 种子派生+图标扫描——变异测试证明门禁有牙 |
| [review-ci-e2e-fixes-2026-10-02.md](reports/review-ci-e2e-fixes-2026-10-02.md) | 跟进 | CI 修复（主仓 checkout）+E2E 加固+i18n 拍板 zh-only |
| [verify-round3-full-2026-10-02.md](reports/verify-round3-full-2026-10-02.md) | 验证 | 第三轮全量——date-only 合规/主仓对账/遗留抽样 |
| [review-closing-batch-2026-10-03.md](reports/review-closing-batch-2026-10-03.md) | 跟进 | 收尾批（P2-5 端点+P3-4 定性+P3-12 骨架）——31 项全清账 |
| [review-closing-batch-gap-fills-2026-10-03.md](reports/review-closing-batch-gap-fills-2026-10-03.md) | 跟进 | 遗留①②补齐（路由回归+回显路径）+E2E 计数 19→20 |
| [review-missing-el-imports-2026-10-03.md](reports/review-missing-el-imports-2026-10-03.md) | 跟进 | 3 处 EP 缺失导入（Panic 分页器/类型编辑器/错误提示静默失效）+扫描测试固化 |
| [review-ep-fix-closeout-2026-10-03.md](reports/review-ep-fix-closeout-2026-10-03.md) | 复核确认 | 三处 EP 修复端到端验证（真 E2E + 探针）+ 扫描测试变异证明有牙 + 门禁全绿 |
| [review-ep-scan-nits-2026-10-03.md](reports/review-ep-scan-nits-2026-10-03.md) | 复核确认 | `eea5b8e5` nit① 变异验证生效；nit②「8 处」口径误标纠正 + 新增 prefix-icon/suffix-icon 字符串闸（双向变异） |
| [review-usetablefit-worktree-2026-10-08.md](reports/review-usetablefit-worktree-2026-10-08.md) | 自检 | useTableFit 批+漏网补齐批工作树核查（9 项发现：P1-1 observer 无补挂点/P1-2 Profile 漏挂/import 卫生/计数漂移） |
| [review-usetablefit-verify-2026-10-08.md](reports/review-usetablefit-verify-2026-10-08.md) | 复核 | 上报告逐条验证+运行时探针——9 项 7 属实/2 已解决；P1-1 静态属实但症状预言被推翻（Home 三态零死区），降级 P2 加固 |
| [commit-attribution-audit-2026-10-08.md](reports/commit-attribution-audit-2026-10-08.md) | 审计 | 当日三仓 ~25 笔提交归属审计——交叉污染恰 2 笔双向各一、内容零错位、决策不重写共享 main（fix-forward 已注记） |

## 2026-10-03 旧清单终态

31 项处置：**27 解决 / 3 设计取舍 / 0 遗留 / 1 撤回**——仅指这31项旧清单全部清账（2026-10-03），不是当前所有问题清零。

## 根入口移入的阶段摘要

以下保存原 README 的日期化交付背景，避免根入口成为追加流水；不能用其中历史计数或完成声明证明新 HEAD 的验收。


**Phase 4 完成定义达成（2026-09-29 收官，四轮审计后 2026-09-30 终态）**——主仓 02 §5.2 四条终验全绿：四波（W2 壳层/W3 system/W4 ticket/W5 三域）+P4-9 部署件+穿插池点名五件（通知/字典/导出/验证码/P2 小件）+加成交付（PAT/P4-8 四件套/cron 收归 B-1 根治）。四轮审计 31 项处置：27 解决（10-01 补修批 P1-1/2/3+P3-8；10-03 快赢批 P3-5/6/7/11、用户价值批 P2-7/11/12、卫生批 P2-8/9/10、收尾批 P2-5+P3-4 定性+P3-12）/ 3 设计取舍 / 0 遗留 / 1 撤回——**全部清账**——逐项基线见 [31项基线](reports/audit-recheck-4rounds-2026-10-01.md)（E2E 断言加固为真数据级）。E2E 20 spec / 24 用例打真实栈全绿（W5 场景五栈），Vitest 15 文件 / 118 用例（Phase 4 收官时点计数，当前运行计数以本次门禁输出为准）。i18n 英文面显式暂不启用（2026-10-02 拍板，触发器=英文用户出现；locales 为预留基建——详见主仓 02 §5.4）。

**后续批次（2026-10-08~12，收官后持续迭代）**：多账号权限测试发现并修复非 admin 工单筛选占位符 500（主仓 4a18789）+任务定义 Tab 403 门控（ce13f5d7）+组织树读权限放开（主仓 000041/000042）；测试规范成文（现[测试指南](../guides/testing.md)）+FE4 非 admin 哨兵；三角色账号就绪（operator E2E9020 / viewer E2E9030 由 globalSetup 幂等补建，角色种子 000002）；活动列表（al 域）改名「活动列表」+排版改版（类型上下文头/行详情抽屉/空态引导/废弃类型只读视图/软删恢复闭环，配套主仓迁移 000040 与 activelist include_deleted）；用户列表操作列「主操作+更多」下拉；工单列表筛选栏重排+勾选型筛选即时生效；组织/菜单树填充链补齐+Profile PAT 表 useTableFit 补挂+第三道闸（el-table 漏挂扫描）；提交归属审计与 useTableFit 报告复核入档 原 `deliverables/`（现 `docs/review/reports/`）（归属审计结论：交叉污染 2 笔双向各一、内容零错位、不重写共享 main）；活动列表两栏改版（左类型清单取代下拉）。

**Phase 5 建设期（2026-10-13 起，`phase5` 分支）**：E2E 五件补齐——消息中心（S6）/流程画布（S2）/工单转换+规则（S3a）/CC 标签（S10）/通知配置管理面（2026-10-25/26，phase5 曾全程未落浏览器）；任务中心三 Tab 改版+动作下拉；组织树交互两批（默认收起+滚动联动层级面包屑；可点回跳/层级参考线/按级展开/悬停全路径）；al 域连续批（字段级上限/唯一键多选/数据页筛选栏）；走查反馈批（空态引导三件/时间工具/错误码收口，覆盖 19 页）；apiPaths 网关前缀门禁（storage 六端点漏前缀类缺陷的静态捕获层）；codegen 生成物对齐后端 107 端点（2026-10-28）；幽灵分派后端校验+审计抽屉复制+发送记录筛选（2026-10-28/29，跨仓联动）；分页四形态统一+分页覆盖哨兵+UI 惯例哨兵+FilterBar 筛选折叠+卡片头收敛+日期快捷段 useDatePresetRange（2026-10-29/30 细节收敛周）；页签栏业界对齐批（刷新持久化+权限过滤恢复+中键关闭+表单弹窗禁遮罩关闭+语言切换器闸门隐藏，2026-11-03）。**2026-11-06记录计数：E2E 30 spec / 41 用例、Vitest 31 文件 / 241 用例**（历史运行记录，不证明本次已跑）。
