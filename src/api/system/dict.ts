/**
 * 字典 API（P4-3——业务枚举运行时化；边界：不碰权限策略面）
 *
 * 类型/项两级+启停+version 乐观锁；消费端点 GET /user/dicts/:code/items 只回启用项
 * （000038 挪 SelfService——审计修正旧路径 404 潜伏雷）
 * （type 停用返回空）——业务表单选项场景用。
 */
import request from '@vea/request'

export interface DictTypeRow {
  id: string
  code: string
  name: string
  enabled: boolean
  remark: string
  version: number
  created_at: string
  updated_at: string
}

export interface DictItemRow {
  id: string
  type_code: string
  code: string
  label: string
  sort_order: number
  enabled: boolean
  remark: string
  version: number
  created_at: string
  updated_at: string
}

export async function listDictTypesApi(
  params: { page: number; page_size: number; keyword?: string },
  config?: { _silentError?: boolean },
): Promise<{ list: DictTypeRow[]; total: number }> {
  const data = await request.get('/api/v1/dicts', { params, ...config })
  return data as unknown as { list: DictTypeRow[]; total: number }
}

export async function createDictTypeApi(input: { code: string; name: string; remark?: string }): Promise<DictTypeRow> {
  const data = await request.post('/api/v1/dicts', input, { _silentError: true })
  return data as unknown as DictTypeRow
}

export async function updateDictTypeApi(input: {
  id: string
  name: string
  enabled?: boolean
  /** 必填：启停沿用完整替换更新，空备注也要显式回传，防止启停清掉备注 */
  remark: string
  version: number
}): Promise<void> {
  await request.post('/api/v1/dicts/update', input, { _silentError: true })
}

/** 删除类型：旧 code 定位目标 + 成对 id+version 乐观锁；版本不符 409 且零写 */
export async function deleteDictTypeApi(input: { id: string; code: string; version: number }): Promise<void> {
  await request.post('/api/v1/dicts/delete', input, { _silentError: true })
}

export async function listDictItemsApi(
  params: { page: number; page_size: number; type_code: string },
  config?: { _silentError?: boolean },
): Promise<{ list: DictItemRow[]; total: number }> {
  const data = await request.get('/api/v1/dict-items', { params, ...config })
  return data as unknown as { list: DictItemRow[]; total: number }
}

export async function createDictItemApi(input: {
  type_code: string
  code: string
  label: string
  sort_order?: number
  enabled?: boolean
  remark?: string
}): Promise<DictItemRow> {
  const data = await request.post('/api/v1/dict-items', input, { _silentError: true })
  return data as unknown as DictItemRow
}

export async function updateDictItemApi(input: {
  id: string
  label: string
  sort_order?: number
  enabled?: boolean
  /** 必填：启停沿用完整替换更新，空备注也要显式回传，防止启停清掉备注 */
  remark: string
  version: number
}): Promise<void> {
  await request.post('/api/v1/dict-items/update', input, { _silentError: true })
}

/** 删除条目：id+version 乐观锁；版本不符 409 且零写（旧无版本请求后端仍兼容，前端一律带版本） */
export async function deleteDictItemApi(input: { id: string; version: number }): Promise<void> {
  await request.post('/api/v1/dict-items/delete', input, { _silentError: true })
}

/** 消费面：按 type 拉取字典项（业务表单选项——登录可读）。默认仅启用项；
 * includeDisabled=true 含停用项（存量工单回显名称/编辑回显旧值——RR-HY-02，
 * 停用项由调用方标灰禁选）。类型停用时两种口径都返回空。 */
export async function getDictItemsByCodeApi(code: string, includeDisabled = false): Promise<DictItemRow[]> {
  const q = includeDisabled ? '?include_disabled=true' : ''
  const data = await request.get(`/api/v1/user/dicts/${encodeURIComponent(code)}/items${q}`)
  return ((data as unknown as { items?: DictItemRow[] })?.items ?? [])
}
