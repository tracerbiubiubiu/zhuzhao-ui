# CONTRIBUTING — zhuzhao-ui

> 协作协议 SSOT = [AGENTS.md](./AGENTS.md)（门禁/提交规范/评审三节/文档规范），本文件不重复约定，只补贡献视角入口。

## 参与贡献

1. **先读两份**：[AGENTS.md](./AGENTS.md)（本仓协议）+ 主仓 `docs/standards.md`（四仓工程公约——本仓为 §3 API 契约消费方）。
2. **设计依据**：主仓 `docs/phase4/01-frontend-design.md`（工程设计 SSOT）/`03 号`（场景×测试矩阵）；页面行为约束以场景表为准。
3. **分支纪律**：每批短分支（`feat-…`/`fix-…`），六件门禁全绿后合 main 即删（AGENTS「分支纪律」）。
4. **交付三节**：改动摘要/影响面/验证证据（AGENTS「变更评审三节」）——缺失即不合格交付。
5. **CI 闭环**：推送后核实 run 转绿（README badge）——本地绿≠CI 绿。

## 环境要求

- Node ≥20.19（`.nvmrc`）/ pnpm ≥12（`packageManager` 钉版，corepack 生效）
- E2E 需真实五栈（AGENTS「E2E 运行前提」）——不用 stub 是既定拍板。

## 时点报告

审计/复检/验证类快照文档住 `outputs/`，命名 `<类型>-<范围>-<YYYY-MM-DD>.md`，随仓提交（AGENTS「文档规范」）。
