# zhuzhao-ui 部署镜像（P4-9——多阶段：构建产物 + nginx 静态服务）
# compose 演示栈由主仓 deployments/docker-compose.yaml 的 ui 服务引用本文件。
FROM node:26.13.1-alpine3.24@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /app
# Node 26 不再自带 Corepack；由 packageManager 唯一钉定 pnpm。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global "$(node -p 'require("./package.json").packageManager')"
# pnpm-workspace.yaml 承载 allowBuilds 审批（esbuild/vue-demi postinstall）——
# 缺失则容器内 --frozen-lockfile 报 ERR_PNPM_IGNORED_BUILDS（与 CI run 36430052551 同款）
RUN pnpm install --frozen-lockfile
COPY . .
# 环境徽标构建参数（Login 页 env-badge）——默认生产环境；测试栈 compose 注入「测试环境」
ARG VITE_APP_ENV=生产环境
ENV VITE_APP_ENV=$VITE_APP_ENV
RUN pnpm build

FROM nginx:1.30.6-alpine3.24@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311
# envsubst 模板机制（官方镜像内置 /etc/nginx/templates/*.template → conf.d/ 注入）
COPY deployments/nginx.conf.template /etc/nginx/templates/default.conf.template
# 默认宿主验证形态（compose 网络由 ui 服务 environment 覆盖为 app）
ENV UPSTREAM_APP=host.docker.internal
# pro 模式产物在 dist-pro（VITE_OUT_DIR 分环境——.env.pro）
COPY --from=build /app/dist-pro /usr/share/nginx/html
EXPOSE 80
