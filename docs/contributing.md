# 贡献指南 — 从设计依据到可复核交付

进入本仓工作先读根 [AGENTS.md](../AGENTS.md)；它保留门禁、账号、提交和评审协议。本篇面向贡献者给出执行顺序，启动细节见[开发与联调](guides/development.md)。

## 先确认改动范围

UI 页面和请求封装由本仓维护；共享 HTTP/IAM/迁移规则以主仓 [standards.md](../../zhuzhao/docs/standards.md) 为准。新增页面先对[UI 约束](design/frontend-ui.md)与主仓[场景矩阵](../../zhuzhao/docs/phase4/03-scenarios-and-tests.md)，不要从历史报告推导当前接口。

Phase5已完成五仓main承接。按所有者本会话确认，五仓全部改动使用短分支经PR合入main，完整适用检查通过后允许单维护者自行合入；取代Phase4小批直推和旧phase5当前分支口径。新建Codex工作分支使用`codex/`前缀。远端保护/required checks是否生效另核G02/G03，不能因文档更新自行push、合并、发版或切共享环境。

## 提交规范与机械检查

采用主仓公约 §12-9 的消息规则：Conventional Commit（scope 可省且仅一个），主题说明 ≤50 个 Unicode 字符、不以句号结尾、主题与非空正文之间空一行；中文写清改动、原因和验证。所有新提交含 merge 均检查，历史不改写。

在本仓根目录执行：

```bash
pnpm hooks                # 仅当前 worktree 安装 pre-commit/commit-msg/pre-push
pnpm test:commit-lint      # 隔离临时 Git 夹具中的消息规则反例
# 需要核对待推送窗口时，先刷新远端引用；网络失败不能写成已同步：
git fetch origin
pnpm commit-lint           # 真实 upstream 待推窗口，不猜 HEAD~N
```

钩子依赖 Python 3 + Git，不新增 npm 依赖；安装保留 common hooksPath，避免改变其他工作树。`pre-commit` 显示其他在途文件，`commit-msg` 校验消息及跨主题重题，`pre-push` 再按实际推送 refs 检查；CI 的 `commit-policy` job 用事件 before/after 或 PR base/head，缺对象失败，不拿 checkout HEAD 替代事件窗口。

历史豁免固定接入点以 [scripts/commit-policy-baseline](../scripts/commit-policy-baseline) 为准，当前为 `152258638abaa3bd3daa656255a794c5422a0e58`，不得随 HEAD 滚动隐藏新违规。独立追溯历史用：

```bash
python3 scripts/commit-policy.py range --strict --before <完整旧SHA> --after <完整新SHA>
```

消息测试现有 42 个黑盒用例（2026-11-08 静态核对）；后续数量以 [scripts/test-commit-policy.py](../scripts/test-commit-policy.py) 为准，不能以有测试文件推断本次已运行通过。

## 提交与交付顺序

1. `git status` 核对本批归属；并行工作树索引不代表文件归属。
2. 运行 [测试指南](guides/testing.md)要求的相关验证与 `pnpm gate`；后端契约变化按[codegen流程](guides/development.md#类型生成与契约接线)同步。
3. 只用显式路径提交；禁止 `git add -A`、`git commit -a`、无路径裸 `git commit`。提交后核对 `git show --stat`。
4. 获授权推送前按主仓公约做 fetch、端点与新增差集核对；多人并发由单一会话推送。改史操作须独占，不能卷走其他会话 staged 内容。
5. 推送后核实本次 CI run success。本地门禁与远端 CI 各有证据，badge 只是入口；未推送时不要声称 CI 已通过。

交付固定附**改动摘要 / 影响面 / 验证证据**三节，未跑与未覆盖范围明确写出；未通过全门禁不得标记完成。当前指南和设计进入本仓 `docs/`，正式时点报告进入 [review/reports](review/reports/README.md)，原日志留本地忽略目录。
