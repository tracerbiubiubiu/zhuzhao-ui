# @vea/request — 与 UI 无关的 axios 请求封装

为共享请求行为提供与 UI 解耦的 axios 客户端。

```ts
import { createRequest } from '@vea/request'

const request = createRequest({
  axiosConfig: { baseURL: '/api', timeout: 60_000 },
  beforeRequest: (config) => ({
    ...config,
    headers: { ...config.headers, Authorization: getToken() }
  }),
  transformResponse: (response) => response.data,
  onError: (error) => reportError(error)
})

const user = await request.get<User>({ url: '/users/1' })
```

取消请求三种形态：`AbortSignal`（局部取消）、`cancelRequest`（按请求键取消）、`cancelAllRequest`（应用级整体拆除）。认证存储、UI 消息、业务成功码与登出行为归消费方应用层（本仓实现在 `src/common/request/src/index.ts`——zhuzhao 信封/401 分码/单飞刷新契约版）。
