# zhuzhao-ui 部署件（P4-9）

## 形态

- **镜像**：多阶段 Dockerfile——node 构建（pnpm frozen lockfile）→ nginx:1.27-alpine 静态服务
- **路由**：`/api/`·`/al/api/` 精确反代 app:33333（网关），其余 SPA fallback；`/assets/` immutable 长缓存、`index.html` no-cache
- **上游注入**：nginx envsubst 模板 `${UPSTREAM_APP}`——compose 栈=`app`（网络名），宿主验证=`host.docker.internal`（默认）

## 本地验证（宿主 app @33333 在跑）

```bash
docker build -f deployments/Dockerfile -t zhuzhao-ui:dev .
docker run --rm -p 48080:80 zhuzhao-ui:dev
# 冒烟（应依次 200 / 200 / code=0 信封）：
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:48080/                     # SPA 壳
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:48080/api/v1/health/ready  # 代理可达（404/200 皆证链路）
curl -s -X POST http://127.0.0.1:48080/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"employee_no":"E000001","password":"<pwd>","device_id":"smoke"}' | head -c 120 # 登录信封
```

> 出口标准（02 P4-9）：冒烟经 nginx 全链绿。**dev proxy（vite）非生产形态，勿以此当部署口径**（二十三批显性化）。

## compose 演示栈接入

主仓 `deployments/docker-compose.yaml` 的 `ui` 服务（build context `../zhuzhao-ui`）——同栈起 app/nginx，`UPSTREAM_APP=app`。app 侧须开 `trusted_proxies`（compose 网络 `172.16.0.0/12`），否则经反代的 ClientIP 恒为 nginx IP、限流桶全站共享（主仓同批配套：`APP_SERVER_TRUSTED_PROXIES` 逗号分隔 env 支持）。
