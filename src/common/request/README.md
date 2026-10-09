# @vea/request — 与 UI 无关的 axios 请求封装

zhuzhao 契约版 axios 实例（W2 壳层替换种子通用封装——信封/401 分码/单飞刷新都在拦截器链内，实现在 `src/index.ts`）。

**默认导出**：配置好的 axios 实例——业务侧直接 `request.get/post`，无需再包一层工厂。

```ts
import request from '@vea/request'

// 信封 data 直返：code≠0 恒非 2xx，走拦截器错误分支；成功即拿业务数据
const data = await request.get('/users/1')
await request.post('/users', input)
```

拦截器链职责（细节见 `src/index.ts`）：Bearer 注入 + `req-` 32hex RequestID；响应信封拆包（data 直返）；
401 分码——20002 过期→单飞静默刷新重放，20003 无效→清会话跳登录，5xx 不清会话；403+20007→跳改密页。

**具名导出**：

- `refreshAccessToken()` / `singleFlightRefresh()`——刷新令牌（单飞防并发重放）
- `generateRequestID()`——`req-` 32hex 请求 ID 生成器
- `errorToast.ts`——错误分级 toast（errorBehavior 白名单，与守卫 catch 分流共用）

**取消**：axios 原生 `signal` 透传（useCrud 分页/查询竞态取消即走此通道）；无按请求键/全局取消的额外封装。

**边界**：认证存储（TokenStorage）、UI 消息样式、业务成功码与登出行为归消费方应用层——本模块不含 UI。
