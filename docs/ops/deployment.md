# UI 部署 — nginx 静态服务与同源网关

本篇验证生产形态的路由链，不使用 Vite dev proxy 充当部署证据。需要 Docker、UI 源码/锁文件，以及可用的后端和 AL 上游；命令均在 **UI 仓根目录**运行。

## 构建与运行配置

[Dockerfile](../../deployments/Dockerfile) 先用 frozen lockfile 构建 `dist-pro`，再复制到 nginx。环境徽标 `VITE_APP_ENV` 在构建时固化；[nginx模板](../../deployments/nginx.conf.template) 在容器启动时把 `UPSTREAM_APP` 代入后端主机名，固定代理到 `33333`。

```bash
docker build -f deployments/Dockerfile --build-arg VITE_APP_ENV=开发环境 -t zhuzhao-ui:dev .
docker run --rm --name zhuzhao-ui-smoke -p 48080:80   -e UPSTREAM_APP=host.docker.internal zhuzhao-ui:dev
```

该例要求 app 在宿主 `33333` 运行，适用于可解析 `host.docker.internal` 的 Docker 环境；Linux Docker 若无该别名须按其网络配置显式提供宿主地址。compose 内设置 `UPSTREAM_APP=app`，不可误指容器自己的 localhost。

路由职责：`/api/` 与 `/al/api/` 原 URI 透传到 app，再由 app 将 AL 请求验签转给 activelist；其余请求 SPA fallback。`/assets/` 不存在即 404 并长缓存有效 hash 资源，`index.html` no-cache。应用健康端点不在这两条反代前缀内。

## 逐步冒烟与预期结果

先按主仓 [runbook](../../../zhuzhao/docs/ops/runbook.md) 完成显式迁移和角色/菜单绑定种子，再检查 app 的真实就绪路由：

```bash
curl --fail-with-body http://127.0.0.1:33333/health/ready
curl --fail-with-body -o /dev/null -w '%{http_code}
' http://127.0.0.1:48080/
curl -sS -o /tmp/zhuzhao-ui-smoke-auth.json -w '%{http_code}
'   http://127.0.0.1:48080/api/v1/user/permissions
```

第一条应 HTTP 200、`{"status":"ok"}`，只证明 app 的 PG/Redis 可达，不代替迁移/种子成功。第二条应 200 HTML。第三条无 token 应返回 **401 JSON 错误信封**，用于确认 nginx 到真实 API 的路径；404 或 HTML 不算通过。`/api/v1/health/ready` 并非当前路由；从 UI 端口访问 `/health/ready` 会进入 SPA fallback，也不能证明后端就绪。

再用预先准备的**专属测试号 E000002+**、已完成必要改密且拥有验证所需 AL 读取权限的账号做完整链。E000001 不用于人工/agent 验证，不改其密码。以下 Python 例从终端隐藏输入密码，只打印状态；失败保留响应/request_id排查，不把 token 写入报告：

```python
import getpass, json, urllib.request, uuid

base = 'http://127.0.0.1:48080'
employee_no = input('专属测试工号（E000002+）：').strip()
if employee_no == 'E000001':
    raise SystemExit('请使用专属测试号')
body = json.dumps({
    'employee_no': employee_no,
    'password': getpass.getpass('密码：'),
    'device_id': str(uuid.uuid4()),
}).encode()
req = urllib.request.Request(base + '/api/v1/auth/login', body,
                             {'Content-Type': 'application/json'})
with urllib.request.urlopen(req, timeout=30) as response:
    envelope = json.load(response)
assert envelope['code'] == 0, envelope
access_token = envelope['data']['access_token']
for path in ['/api/v1/user/permissions', '/al/api/v1/admin/types']:
    req = urllib.request.Request(base + path,
                                 headers={'Authorization': 'Bearer ' + access_token})
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = json.load(response)
        assert payload['code'] == 0, payload
        print(path, response.status, 'code=0')
```

预期登录与两跳读取均 200/code=0；AL 403 表示账号权限或绑定不足，5xx 需核上游/验签，均不能标记全链通过。该例仅只读验证并登录，不自动建号/改密，也不代替浏览器渲染/E2E。

## compose 与来源记录

主仓 [deployments/docker-compose.yaml](../../../zhuzhao/deployments/docker-compose.yaml) 配置同栈 app/nginx；app 的 `trusted_proxies` 须含实际容器网络，否则 ClientIP 为 nginx IP、限流桶被共享。使用主仓 `APP_SERVER_TRUSTED_PROXIES` 配置入口，部署前按真实网段核对，勿无边界信任任意来源。

交付记录构建源完整 SHA、镜像 ID、构建徽标、运行上游、冒烟结果和失败项。停止本次示例容器可用 `docker stop zhuzhao-ui-smoke`；不要清理其他会话或共享卷。发布与回退见[发布指南](releasing.md)。
