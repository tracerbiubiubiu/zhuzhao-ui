/**
 * audit 域 API（P4-W5——GET /audit/logs 唯一查询端点，000025 菜单 audit:read）
 *
 * wire 实况：start/end 为 YYYY-MM-DD（服务端严格解析）；employee_no 非空时按工号
 * 解析 user_id（含软删用户——历史审计仍可查，D2-27）；offset 分页 {list,total,...}。
 */
import request from '@vea/request'

/** 审计行（model.AuditLog 投影——id/user_id int64 string 序列化） */
export interface AuditLogRow {
  id: string
  user_id?: string
  username: string
  method: string
  path: string
  status_code: number
  duration: number
  ip: string
  user_agent: string
  request_body?: string
  request_id?: string
  created_at: string
}

export interface AuditListQuery {
  employee_no?: string
  path?: string
  /** YYYY-MM-DD */
  start?: string
  end?: string
}

export async function listAuditLogsApi(
  params: { page: number; page_size: number } & AuditListQuery,
): Promise<{ list: AuditLogRow[]; total: number }> {
  const data = await request.get('/api/v1/audit/logs', { params })
  return data as unknown as { list: AuditLogRow[]; total: number }
}

// ===== P4-8：panic 聚合 + 路由对账（P2-9：视图直连 request 收归 API 层） =====

/** panic 聚合行（同指纹计数——最近优先） */
export interface PanicRow {
  id: string
  message: string
  path: string
  count: number
  last_at: string
}

export interface PanicPage {
  list: PanicRow[]
  total: number
  page: number
}

/** panic 聚合列表（offset 分页） */
export async function listPanicsApi(page = 1, pageSize = 20): Promise<PanicPage> {
  const data = await request.get('/api/v1/audit/panics', { params: { page, page_size: pageSize } })
  return data as unknown as PanicPage
}

/** 路由对账（对账缺口清单——审计溯源） */
export async function reconcileAuditApi(): Promise<{ gaps: string[]; gap_count: number; checked_at: string }> {
  const data = await request.get('/api/v1/audit/reconcile')
  return data as unknown as { gaps: string[]; gap_count: number; checked_at: string }
}
