# @vea/hooks — CRUD/表单控制器（与 UI、请求库、业务模型无关）

## useCrud

`useCrud` 是与 UI、请求库和业务模型无关的 Vue 3 CRUD 控制器。页面只负责把后端接口适配为 `CrudService`，表格、弹窗、确认提示、权限和表单校验留在应用层。

```ts
import { useCrud, type CrudService } from '@vea/hooks'

type User = { id: number; name: string }
type UserQuery = { keyword?: string }
type CreateUser = Pick<User, 'name'>
type UpdateUser = Partial<CreateUser>

// ⚠ 示例按 zhuzhao standards §3-1「全仓仅 GET/POST」风格书写（写操作 = POST 动作段端点）
const service: CrudService<User, User, UserQuery, CreateUser, UpdateUser, number> = {
  list: async (params, { signal }) => {
    const result = await request.get('/users', { params, signal })
    return { list: result.data.items, total: result.data.total }
  },
  detail: (id, { signal }) => request.get(`/users/${id}`, { signal }),
  create: (input, { signal }) => request.post('/users', input, { signal }),
  update: (id, input, { signal }) => request.post('/users/update', { id, ...input }, { signal }),
  remove: (ids, { signal }) => request.post('/users/delete', { ids }, { signal })
}

const { state, actions } = useCrud({
  service,
  initialQuery: { keyword: '' },
  initialPageSize: 20
})
```

状态按职责分开：

- 列表：`items`、`total`、`page`、`pageSize`、`query`
- 详情：`current`、`currentKey`
- 选择：`selectedKeys`
- 请求状态：`listLoading`、`detailLoading`、`mutationLoading` 及对应错误

动作覆盖列表与详情读取、查询重置、分页、增改删、选择、取消请求和整体重置。增改删默认在成功后刷新列表，可通过 `{ refresh: false }` 关闭；删除最后一页数据时会自动回退到有效页码。

控制器会取消同类旧请求，并阻止不支持 `AbortSignal` 的请求库用过期响应覆盖新数据。它不包含表格列、表单 schema、弹窗状态、消息提示、权限、缓存或乐观更新，这些能力应由应用层按需组合。

## useForm

`useForm` 管理表单值、字段校验、错误、脏值、提交和重置，不负责渲染具体表单组件。

```ts
import { required, useForm } from '@vea/hooks'

const { state, actions } = useForm({
  initialValues: { username: '', password: '' },
  rules: {
    username: required('请输入用户名'),
    password: required('请输入密码')
  }
})

await actions.submit((values) => loginApi(values))
```

服务端字段错误可通过 `setErrors` 写入；`validateField` 可用于失焦校验。表单模型采用浅层快照，嵌套对象应整体替换，以便正确计算 `dirtyFields`。

## useTableFit

`useTableFit` 是 el-table 列宽自适应兜底（frontend-standard.md 踩坑⑦）：EP 2.14 列宽拟合不随
容器变化重排（侧栏收起/面板调整/数据晚到），本 composable 以 ResizeObserver 盯表格父容器 +
window resize 兜底，变化即 rAF 合并调 `doLayout()`。可重入挂接覆盖「表格被 `v-if` 门控、
挂载瞬间尚不存在」的页面（ref 迟挂自动补挂）。

```ts
import { useTableFit } from '@vea/hooks'

const tableRef = ref()
useTableFit(tableRef, () => rows.value)
```

```html
<el-table ref="tableRef" :data="rows">…</el-table>
```

手动 `el-table` 必须挂接（ProTable 已内置）；对话框/抽屉内定宽表豁免（见 frontend-standard.md）。
覆盖面由 `src/epImports.test.ts` 第三用例扫描闸守护（漏挂即红）。
