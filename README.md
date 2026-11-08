# zhuzhao-ui

[![CI](https://github.com/tracerbiubiubiu/zhuzhao-ui/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tracerbiubiubiu/zhuzhao-ui/actions/workflows/ci.yml?query=branch%3Amain)

zhuzhao（Go 模块化单体 IAM + 工单系统）的 Vue 控制台。单仓单 SPA 承载系统管理、工单、任务、活动列表、消息与审计；所有业务请求经 zhuzhao 网关，浏览器不直连内部服务。

## 开始使用

需要 Node.js ≥20.19 和仓库 `package.json` 钉定的 pnpm；在本仓根目录执行：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm hooks
pnpm dev
```

前端地址为 `http://127.0.0.1:4000`，后端及真实上游的启动顺序见[开发与联调](docs/guides/development.md)。进入改动前先读[协作协议](AGENTS.md)，交付运行 `pnpm gate` 六件门禁。

## 文档入口

从[任务导读](docs/README.md)选择阅读路径：贡献与提交、页面/组件开发、测试、请求契约、部署发布和历史审计。UI 自身指南与设计维护在本仓 `docs/`；跨服务工程/API/IAM 和阶段决策仍回链主仓权威文档。

Phase 4 已收官；Phase 5 的交付范围、修复与未合 main 的边界见[审查入口](docs/review/README.md)及所链接的主仓当前台账。历史报告只证明其注明的提交和环境，CI badge 也不替代本次门禁收据。
