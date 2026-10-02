# RELEASING — zhuzhao-ui

> 本仓无独立语义化版本/发版节奏（内部系统，持续交付于 main）。本文记录「发布即部署」口径与检查单。

## 发布物

- **镜像**：`deployments/Dockerfile`（多阶段：node 构建 → nginx:1.27-alpine 静态服务）——构建与冒烟步骤见 [deployments/README.md](./deployments/README.md)。
- **compose 接入**：主仓 `deployments/docker-compose.yaml` 的 `ui` 服务（build context `../zhuzhao-ui`，两仓同级 checkout）。

## 发布检查单（顺序执行）

1. 六件门禁全绿（AGENTS「前端门禁」）+ CI run success；
2. 主仓 `make swag` → 本仓 `pnpm codegen` → **生成物零 diff**（契约无未同步漂移）；
3. `docker build -f deployments/Dockerfile` 成功 + 四跳冒烟（SPA 壳/双代理/登录/`/al/api` 全链——deployments/README 口径）；
4. 主仓侧若有迁移，先 `make migrate-up`（部署原子性：迁移先行于新二进制/镜像）。

## 回滚

- 镜像回退 = compose `image` 钉回上一标签重新 `up -d ui`（无状态静态服务，无数据面）；
- SPA fallback 与资产 hash 命名保证新旧壳不互相引用坏资产（nginx 模板注释）。

## 已知非目标

- 无 CHANGELOG（提交信息即史，中文规范+验证证据）；无多环境配置面（同源部署，运行时零配置）。
