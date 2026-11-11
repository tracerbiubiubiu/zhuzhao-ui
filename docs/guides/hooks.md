# Hooks 使用 — 列表、表单与表格布局控制器

`@vea/hooks` 的通用控制器不绑定 UI、请求库或业务模型；页面负责表格/弹窗/权限/校验与提示，API 模块负责把真实响应适配为 hook 合同。先读[UI约束](../design/frontend-ui.md)，选择组件时看[组件指南](components.md)。

## useCrud：先适配 list/total 和 string ID

[useCrud.ts](../../src/common/hooks/src/useCrud.ts) 的 `CrudService` 支持 `list` 及可选 `detail/create/update/remove`。hook 的 key 泛型允许 string/number；**zhuzhao 的 int64 ID 在请求、表单和选择数组中统一为 string**，不能用 `Number` 转换。

下面是在 API/页面适配层组合真实用户列表的最小只读例，不虚构创建/更新字段，也不让视图直接绕过 API 分层：

```ts
import request from '@vea/request'
import { useCrud, type CrudService } from '@vea/hooks'
import type { UserRow } from '@/api/system/user'

type UserQuery = { username?: string }
type UserList = { list: UserRow[]; total: number }

// 此适配器放 API/控制器层；响应拦截器已经去掉 HTTP 信封，不能再取 data.items。
const service: CrudService<UserRow, UserRow, UserQuery, never, never, string> = {
  list: (params, { signal }) => request.get<unknown, UserList>(
    '/api/v1/users', { params, signal },
  ),
}

const { state, actions } = useCrud({
  service,
  initialQuery: { username: '' },
  initialPageSize: 20,
})
```

`request.get<T, R>` 的第二个泛型声明运行时解包后的返回类型；这不会做运行时字段校验。应用标准列表是 `{ list, total }`，分页参数原样 `page/page_size`。无 total 的 AL 游标/死信采用各自分页合同，不用伪造总数。

状态分为列表 `items/total/page/pageSize/query`、详情 `current/currentKey`、选择 `selectedKeys`，以及 `listLoading/detailLoading/mutationLoading` 和对应错误。动作支持读取、查询重置、分页、选择、取消请求与整体重置。补写操作时沿真实 API/generated 输入与版本字段适配，GET/POST 方法及标识入 body 规则以主仓公约为准；不要照泛型方法名制造新端点。

增改删默认成功后刷新列表，可用 `{ refresh: false }` 关闭；删除末页后回退到有效页。控制器取消同类旧请求，即使请求库不支持 AbortSignal，也用请求代次挡过期响应。它不管理弹层、消息、权限、缓存或乐观更新；用户会话代次另由[请求层](../design/request.md)保护。

## useForm：浅层表单与校验

[useForm.ts](../../src/common/hooks/src/useForm.ts) 的 `useForm` 管理值、错误、脏值、提交和重置，不渲染表单：

```ts
import { required, useForm } from '@vea/hooks'

const { state, actions } = useForm({
  initialValues: { username: '', password: '' },
  rules: {
    username: required('请输入用户名'),
    password: required('请输入密码'),
  },
})

// loginApi 是调用方提供的接口适配器，真实登录还需 employee_no/device_id。
await actions.submit((values) => loginApi(values))
```

这是控制器形态示例，不是 zhuzhao 登录端点完整载荷。服务端字段错误可用 `setErrors` 写入，失焦可调用 `validateField`。模型为浅层快照；嵌套对象应整体替换，避免 dirtyFields 无法反映变化。

## useTableFit：手动表格随容器重排

EP 2.14 的表格列宽可能不随父容器变化重排。`useTableFit` 以 ResizeObserver 观察父容器，配合 window resize 和 rAF 合并 `doLayout()`；ref 被 v-if 延迟挂载时也会补挂，数据晚到可传 watchSource。见 [useTableFit.ts](../../src/common/hooks/src/useTableFit.ts) 的 `useTableFit`，历史原因在[UI规范“踩过的坑”](../design/frontend-ui.md#踩过的坑勿重蹈)。

```ts
import { ref } from 'vue'
import { useTableFit } from '@vea/hooks'

const tableRef = ref()
const rows = ref([])
useTableFit(tableRef, () => rows.value)
```

```vue
<el-table ref="tableRef" :data="rows">…</el-table>
```

ProTable 已内置；手动 el-table 必须挂接。对话框/抽屉定宽表的例外必须在 [epImports.test.ts](../../src/epImports.test.ts) 的 `手动 el-table 挂接 useTableFit` 用例中登记，不能把所有弹层表自动当豁免。该用例是文件中的第三个 `it`；引用以用例名为准，避免数量变化后失效。

## 组合筛选与日期

`useAutoFilterRun` 用于普通分页列表的即时筛选与防抖回首页；游标页需自行重置游标并防晚响应。`useDatePresetRange` 提供全部/近7天/近30天/自定义的统一控件状态，调用方把 range 映射为端点参数。选型与触发细则见[UI筛选配方](../design/frontend-ui.md#筛选栏配方2026-10-12-立工单列表批实测配方)，准确签名以对应源码符号为准。
