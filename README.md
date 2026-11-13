# zhuzhao-ui — 工单、任务与安全数据的统一控制台

[简体中文](README.md) | [English](README.en.md)

[![CI](https://github.com/tracerbiubiubiu/zhuzhao-ui/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tracerbiubiubiu/zhuzhao-ui/actions/workflows/ci.yml?query=branch%3Amain)

在同一个工作区管理账号与权限、流转工单、执行任务和查询数据，让安全协作有入口、有记录、可追踪。

这是 [zhuzhao](https://github.com/tracerbiubiubiu/zhuzhao) 的 Vue 控制台仓库。项目面向数据聚合与安全全生命周期管控，复用专业平台的能力；产品定位、后端和完整启动说明从[主仓](https://github.com/tracerbiubiubiu/zhuzhao)开始。本仓负责页面、交互和前端请求，业务请求统一经过 zhuzhao 网关。

## 当前可以使用什么

- **工单协作**：创建、筛选、导出与详情处理；自定义字段、附件、评论、抄送和详情内标签；类型/模板配置、状态流程画布与自动分派规则。
- **任务中心**：提交任务、查看运行记录、管理定时任务定义，以及取消、重试和死信排查；由后端对接 taskrunner 执行。
- **活动列表**：按类型浏览和维护结构化数据，支持导入、导出及废弃类型的只读查看；由网关接入 activelist。
- **情报查询**：查询 IP、域名、Hash 和 URL，查看结构化或原始 JSON 结果及本机查询记录；结果由后端配置的来源提供。
- **身份与管理**：账号、组织、角色、菜单、字典、系统设置和审计；个人中心、个人访问令牌与“我的组织”自服务入口。
- **消息**：站内收件箱与未读提示，通知模板、订阅规则和发送记录管理。

页面和操作按账号权限开放，后端仍负责最终授权。当前界面以中文为主；英文 README 不代表英文界面已启用。

Phase 5 已验收并合入 main。后续的新首页、全站视觉重设计、风险生命周期、AI/Agent、MCP 和企业统一认证适配仍在规划中，详见[重设计合同](docs/design/frontend-redesign.md)与[主仓文档](https://github.com/tracerbiubiubiu/zhuzhao/tree/main/docs)。设计稿和审阅原型不代表这些功能已交付。

## 本地运行

先准备 [.nvmrc](.nvmrc) 指定的 Node.js，以及 [package.json](package.json) 指定版本的 pnpm。在本仓根目录运行：

```bash
npm install --global "$(node -p 'require("./package.json").packageManager')"
pnpm install --frozen-lockfile
pnpm hooks
pnpm dev
```

打开 `http://127.0.0.1:4000`。登录、菜单和业务操作需要主仓后端；开发代理将 `/api`、`/al` 请求转给 `http://127.0.0.1:33333`。任务与活动列表场景还需要对应上游，完整启动顺序见[开发与联调](docs/guides/development.md)。安装协作 hooks 需要 Git 和 Python 3。

大量合成 mock 持续用于开发、状态与交互验证；现有关键 E2E 使用真实后端。各层的适用范围和运行条件见[测试指南](docs/guides/testing.md)。

## 技术与文档

前端使用 Vue 3、TypeScript、Vite、Element Plus、Pinia 与 TanStack Query，流程画布使用 LogicFlow，图表使用 ECharts。准确依赖以锁文件为准。

- [文档导航](docs/README.md)：按开发、运维和评审任务找入口。
- [页面与组件开发](docs/guides/components.md) / [当前 UI 规范](docs/design/frontend-ui.md)：复用现有组件和交互约定。
- [请求链路与接口消费](docs/design/request.md)：认证、网关和错误处理。
- [构建部署](docs/ops/deployment.md) / [发布与回退](docs/ops/releasing.md)：静态资源与同源反向代理。
- [审查与验证记录](docs/review/README.md)：核对报告对应的版本、环境与限制。

## 参与贡献

欢迎通过 [Issues](https://github.com/tracerbiubiubiu/zhuzhao-ui/issues) 提交可复现的问题和使用场景，或发起小范围 PR。先读[贡献指南](docs/contributing.md)与 [AGENTS.md](AGENTS.md)，保持测试先行；提交前运行 `pnpm gate` 六件门禁，涉及真实栈的验证按指南准备独占环境。

示例、mock 和截图仅使用合成数据，不提交公司内部信息、凭据或真实业务数据。如果这个项目对你有帮助，欢迎给[主项目](https://github.com/tracerbiubiubiu/zhuzhao)一个 Star。

## 许可

[MIT License](LICENSE)。
