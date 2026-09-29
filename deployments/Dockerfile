# zhuzhao-ui 部署镜像（P4-9——多阶段：构建产物 + nginx 静态服务）
# compose 演示栈由主仓 deployments/docker-compose.yaml 的 ui 服务引用本文件。
FROM node:20-alpine AS build
WORKDIR /app
# pnpm 经 corepack（pnpm 12.x——与仓 packageManager 对齐；lockfile 全量安装保证可重放）
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm-workspace.yaml 承载 allowBuilds 审批（esbuild/vue-demi postinstall）——
# 缺失则容器内 --frozen-lockfile 报 ERR_PNPM_IGNORED_BUILDS（与 CI run 36430052551 同款）
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:1.27-alpine
# envsubst 模板机制（官方镜像内置 /etc/nginx/templates/*.template → conf.d/ 注入）
COPY deployments/nginx.conf.template /etc/nginx/templates/default.conf.template
# 默认宿主验证形态（compose 网络由 ui 服务 environment 覆盖为 app）
ENV UPSTREAM_APP=host.docker.internal
# pro 模式产物在 dist-pro（VITE_OUT_DIR 分环境——.env.pro）
COPY --from=build /app/dist-pro /usr/share/nginx/html
EXPOSE 80
