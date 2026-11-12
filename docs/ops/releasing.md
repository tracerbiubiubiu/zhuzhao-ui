# UI 发布 — 检查交付证据与回退范围

本仓尚无独立语义化版本/固定发版节奏；部署应记录完整源码提交和镜像 ID/标签。Phase 5 合 main 与部署均按所有者授权推进，不能把当前分支门禁通过视作已经合并或发布。

## 发布物与配置

镜像来自 [deployments/Dockerfile](../../deployments/Dockerfile)：Node 26.13.1 LTS 构建后由 nginx 1.30.6 stable 提供静态页面；两阶段均使用 Alpine 3.24 系列并钉定多架构 OCI index digest，准确 tag/digest 以 Dockerfile 为准。主仓 [compose](../../../zhuzhao/deployments/docker-compose.yaml) 的 UI build context 是同级 `../zhuzhao-ui`。

`VITE_APP_ENV` 是**构建时**登录环境徽标；`UPSTREAM_APP` 是 nginx 启动 envsubst 的**运行时**后端主机名，模板固定端口 `33333`。并非运行时零配置，细节和冒烟步骤见[部署](deployment.md)。

## 发布顺序

1. 核实本次 [六件门禁](../guides/testing.md#运行命令与通过条件)全绿，以及获授权推送后的实际 CI run success；两者不能互相替代。
2. 主仓 `make swag` → UI `pnpm codegen`，检查生成物与本次后端合同一致；若生成出差异，应审查并提交，不能用“零 diff”掩盖漏更新。
3. 若后端有迁移/绑定种子，按主仓 runbook 的显式顺序先完成再部署应用。UI 自身无数据库迁移，不代表跨仓升级可省后端步骤。
4. 构建固定源镜像，按[部署指南](deployment.md)分别验证 SPA、app 就绪、登录/权限与 AL 网关链；记录环境、源、镜像及实际结果，不以 Vite proxy 替代 nginx 验证。

## 回滚与缓存边界

将 compose 的 UI 镜像钉回已经记录的上一版本，再 `up -d ui`；重开浏览器检查登录、路由、静态资产和 API 兼容。后端/数据库回退有各自约束，不能只回 UI 就宣称整套系统已回滚。

资产文件名含内容 hash，`/assets/` 长缓存、`index.html` no-cache。这能让新壳请求对应资源，但**不能保证已经打开的旧壳在镜像替换后还能加载已移除的懒加载资源**；旧会话和刷新后的新会话都需验证，必要时按部署策略保留上一批资产。当前模板没有额外实现多版本资产保留。

暂无独立 CHANGELOG，变更来源通过 Git 提交与[正式报告](../review/README.md)追溯；这不免除本次摘要、影响面和验证证据。
