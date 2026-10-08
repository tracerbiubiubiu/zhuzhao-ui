/**
 * al 域 API（P4-W5——经网关反代 /al/api/v1 → activelist 上游）
 *
 * wire 实况（与 activelist handler 对齐注记）：
 * - 类型列表 {list,total}（全量小列表，无分页参数）；数据列表 **cursor 分页**
 *   {list,page_size,next_cursor}——无 total（十三批「无 total 形态」适用面=al 域+死信），
 *   next_cursor={after_created_at,after_id} 满页才有、空页 null=遍历终止
 * - 写端点 zhuzhao 风格（000032 整改后）：deprecate/schema/restore 标识入 body；
 *   update/delete 仍带 :id 路径参数（activelist 侧未整改——规划仅点名三端点）
 * - 导出=裸 JSON 数组流（非信封，blob 旁路下载）；导入=同格式 JSON 直发 body
 *   （网关实际上限 1MB——非 activelist 自身 1GiB，二十二批）
 */
import request from '@vea/request'

/** 字段定义（meta.Field——类型四枚举） */
export interface AlFieldDef {
  name: string
  type: 'int' | 'string' | 'int_list' | 'string_list'
  required: boolean
  /** 敏感字段（日志侧脱敏语义——响应值原样，前端不脱显） */
  sensitive?: boolean
}

/** 类型定义（meta.Definition 投影） */
export interface AlTypeDef {
  type_name: string
  fields: AlFieldDef[]
  status: 'active' | 'deprecated'
  version: number
  created_at: string
  updated_at: string
}

/** schema 变更历史行 */
export interface AlTypeHistoryRow {
  version: number
  op: string
  fields: AlFieldDef[]
  created_at: string
}

/** 数据行（repository.Document 投影——id int64 string 序列化） */
export interface AlDataDoc {
  id: string
  version: number
  status: 'active' | 'deleted'
  data: Record<string, unknown>
  created_by: string
  updated_by: string
  created_at: string
  updated_at: string
}

/** keyset 游标（after_created_at/after_id 须成对——缺一 400） */
export interface AlCursor {
  after_created_at: string
  after_id: string
}

/** 导入结果（ImportResult 投影） */
export interface AlImportResult {
  inserted?: number
  skipped?: number
  duration_ms?: number
  [k: string]: unknown
}

// ─── 类型管理（activelist:type:read / type:manage）───

export async function listAlTypesApi(): Promise<{ list: AlTypeDef[]; total: number }> {
  const data = await request.get('/al/api/v1/admin/types')
  return data as unknown as { list: AlTypeDef[]; total: number }
}

/** 字段创建规则（静态提示数据——注册/演进弹窗展示用） */
export async function getAlTypeRulesApi(): Promise<unknown> {
  const data = await request.get('/al/api/v1/admin/types/rules')
  return data
}

export async function registerAlTypeApi(input: { type_name: string; fields: AlFieldDef[] }): Promise<AlTypeDef> {
  const data = await request.post('/al/api/v1/admin/types', input, { _silentError: true })
  return data as unknown as AlTypeDef
}

/** schema 演进（全量定义+version 乐观锁；兼容变更零迁移、破坏性旧数据懒执行） */
export async function evolveAlTypeApi(input: {
  type_name: string
  fields: AlFieldDef[]
  version: number
}): Promise<AlTypeDef> {
  const data = await request.post('/al/api/v1/admin/types/schema', input, { _silentError: true })
  return data as unknown as AlTypeDef
}

/** 废弃类型（幂等；deprecated 后数据端点只读门关闭——写操作 409） */
export async function deprecateAlTypeApi(typeName: string): Promise<AlTypeDef> {
  const data = await request.post('/al/api/v1/admin/types/deprecate', { type_name: typeName }, { _silentError: true })
  return data as unknown as AlTypeDef
}

export async function listAlTypeHistoryApi(typeName: string): Promise<{ list: AlTypeHistoryRow[] }> {
  const data = await request.get(`/al/api/v1/admin/types/${encodeURIComponent(typeName)}/history`)
  return data as unknown as { list: AlTypeHistoryRow[] }
}

// ─── 数据 CRUD（activelist:data:read / data:write）───

export async function listAlDataApi(
  typeName: string,
  params: { page_size?: number; after_created_at?: string; after_id?: string; include_deleted?: boolean },
): Promise<{ list: AlDataDoc[]; page_size: number; next_cursor: AlCursor | null }> {
  const data = await request.get(`/al/api/v1/data/${encodeURIComponent(typeName)}`, { params })
  return data as unknown as { list: AlDataDoc[]; page_size: number; next_cursor: AlCursor | null }
}

export async function createAlDataApi(typeName: string, dataBody: Record<string, unknown>): Promise<AlDataDoc> {
  const data = await request.post(`/al/api/v1/data/${encodeURIComponent(typeName)}`, { data: dataBody }, { _silentError: true })
  return data as unknown as AlDataDoc
}

export async function updateAlDataApi(
  typeName: string,
  id: string,
  input: { data: Record<string, unknown>; version: number },
): Promise<AlDataDoc> {
  const data = await request.post(
    `/al/api/v1/data/${encodeURIComponent(typeName)}/${id}/update`,
    input,
    { _silentError: true },
  )
  return data as unknown as AlDataDoc
}

/** 软删（幂等；返回删除后完整文档） */
export async function deleteAlDataApi(typeName: string, id: string): Promise<AlDataDoc> {
  const data = await request.post(`/al/api/v1/data/${encodeURIComponent(typeName)}/${id}/delete`, {}, { _silentError: true })
  return data as unknown as AlDataDoc
}

/** 恢复软删行（幂等；000032 整改形态——标识入 body。废弃类型下仍放行：存量数据生命周期操作） */
export async function restoreAlDataApi(typeName: string, id: string): Promise<AlDataDoc> {
  const data = await request.post('/al/api/v1/data/restore', { type_name: typeName, id }, { _silentError: true })
  return data as unknown as AlDataDoc
}

// ─── 导入导出（blob 流式旁路——响应非信封，拦截器透传 Blob）───

/** 导出=裸 JSON 数组流（全量遍历；文本量可能大——走 blob 下载不占内存解析） */
export async function exportAlDataApi(typeName: string): Promise<Blob> {
  const data = await request.get(`/al/api/v1/data/${encodeURIComponent(typeName)}/export`, { responseType: 'blob' })
  return data as unknown as Blob
}

/** 导入=JSON 数组直发 body（网关实际上限 1MB；格式与导出对称） */
export async function importAlDataApi(typeName: string, jsonText: string): Promise<AlImportResult> {
  const data = await request.post(`/al/api/v1/data/${encodeURIComponent(typeName)}/import`, jsonText, {
    headers: { 'Content-Type': 'application/json' },
    _silentError: true,
  })
  return data as unknown as AlImportResult
}
