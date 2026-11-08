# 请求链路 — 信封、会话隔离与错误副作用

`@vea/request` 是 zhuzhao 应用的 axios 单例，实现在 [src/common/request/src/index.ts](../../src/common/request/src/index.ts)。它依赖 TokenStorage、user store 和错误提示，**当前不是独立的无 UI 请求包**。通用 CRUD 控制器与本层的职责区别见[hooks指南](../guides/hooks.md)。

## 从页面到后端

视图调用 `src/api/` 的领域适配器，适配器复用本单例发送网关路径 `/api/v1` 或 `/al/api/v1`。拦截器注入 Bearer 和 `req-` 加32位小写hex的 X-Request-ID；成功信封 `{code:0,message,data,request_id}` 直接返回 data，data:null 返回 null。

```ts
import request from '@vea/request'

type UserView = { id: string; employee_no: string; real_name: string }
// 示例位于 API 适配层；类型声明不替代运行时校验。
const user = await request.get<unknown, UserView>('/api/v1/users/123')
// user.id 是 string；没有 response.data 或 data.items 这一层。
```

GET/POST、int64字符串、时间与业务错误码以主仓 [standards.md](../../../zhuzhao/docs/standards.md) §3为准。这里按HTTP状态分流，依赖后端“code≠0 为非2xx”的合同，不另造业务成功码体系；生成类型接线范围见[codegen说明](../guides/development.md#类型生成与契约接线)。

## 401刷新与终态拆除

`singleFlightRefresh` 按 session generation 共享一次刷新 Promise，`refreshAccessToken` 返回 `{token, terminal, stale?}`。同用户同身份的 AT 刷新不创建新会话代次；登录开始、注销和身份拆除推进代次。

- 401/20002：静默刷新后重放原请求一次；已重放仍过期则走终态处理，不无限循环。
- 401/20003，或刷新命中20004/20014/20015终态码：`_clearPiniaAndRedirect` 清 token、user store、动态路由与页签后跳登录，带当前hash路径供合法回跳。
- 刷新遇到5xx/无响应或未命中终态族的4xx：保留会话，只拒本次请求；错误提示为可重试服务异常，不能把旧401当作新会话过期。
- 403/20007：跳改密页并保留会话，已有专属交互时不重复toast。

请求发出时记代次；旧成功、错误、刷新结果和finally都不得回写/清除/提示/解锁新会话。单纯清缓存不足以挡晚响应。user store和路由守卫也在异步边界复核代次，详见[UI会话隔离约束](frontend-ui.md#会话异步隔离2026-11-05-审计修复)。

## 错误提示与调用方边界

[src/common/request/errorToast.ts](../../src/common/request/errorToast.ts) 的 `resolveErrorToast` 是纯决策函数，`notifyError` 在有DOM时懒加载 Element Plus ElMessage及样式；node测试无DOM时不渲染消息。它仍是本模块的UI依赖，懒加载不等于“与UI无关”。

已有专属交互的401、403/20007、10006乐观锁及 `_silentError` 不重复全局提示；取消 `ERR_CANCELED` 不提示，其余按后端message/HTTP兜底并附request_id。Blob错误会先解析信封，使下载错误仍能分流；业务表单需要自管错误时在config设 `_silentError: true` 并负责展示与恢复，不能吞错冒充成功。

具名导出 `refreshAccessToken`、`singleFlightRefresh`、`generateRequestID` 位于请求入口；错误决策位于上述 errorToast 文件。没有额外请求键/全局取消管理；axios `signal` 原样透传，页面/控制器决定何时abort。对象存储预签直传不是普通网关信封调用，局部错误与部分成功反馈按[UI失败恢复约束](frontend-ui.md#即时反馈与失败恢复2026-11-07-审计修复)处理。

## 修改后怎样证明

先跑请求入口和 errorToast 对应单测，涉及身份切换还要核旧响应、旧刷新锁与晚到错误不会污染新会话；真实登录/角色/路由行为由E2E承接。测试能力和本次执行结果分开记录，完整门禁见[测试指南](../guides/testing.md)。
