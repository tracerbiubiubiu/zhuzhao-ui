/**
 * ticket 域 API（P4-W4 工单域）
 *
 * 列表搜索严格对齐端点：type_code/status（无 keyword/assignee——assignee=me 随 W4 后端
 * 随批件，到时再加）。Ticket 行无 version（乐观锁三件套=用户/组织/角色，工单除外）。
 */
import request from '@vea/request'

/** 工单行（= model.Ticket 的 JSON 投影；assigned_to 可空——创建即未分派；
 * created_by_name/assignee_name 为 W4 后端回填字段（03 S9——real_name 优先/空回退
 * username/软删不回填），缺省时调用方降级显 ID） */
export interface TicketRow {
  id: string
  type_code: string
  title: string
  description: string
  priority: number
  status: string
  created_by: string
  created_by_name?: string
  assigned_to?: string
  assignee_name?: string
  org_id: string
  org_path: string
  custom_data?: unknown
  sla_due_at?: string
  created_at: string
  updated_at: string
}

/** 搜索参数严格对齐 GET /tickets（03 W4：状态筛选可列六态；assignee 仅支持
 * me（W4 P1-c——工作台待办/已办卡数据源），其余值后端 400） */
export interface TicketListQuery {
  type_code?: string
  status?: string
  assignee?: 'me'
}

export async function listTicketsApi(
  params: { page: number; page_size: number } & TicketListQuery,
): Promise<{ list: TicketRow[]; total: number }> {
  const data = await request.get('/api/v1/tickets', { params })
  return data as unknown as { list: TicketRow[]; total: number }
}

/** 工单详情（静态路由 /tickets/:id 消费——W4 详情批扩评论/备注/流转） */
export async function getTicketApi(id: string): Promise<TicketRow> {
  const data = await request.get(`/api/v1/tickets/${id}`)
  return data as unknown as TicketRow
}

/** 工单类型（列表筛选下拉/发起表单 schema 拉取——operator 经 ticket_list 页面行共享 GET） */
export interface TicketTypeRow {
  id: string
  code: string
  name: string
  description: string
  default_sla_hours: number
  has_custom_fields: boolean
}

export async function listTicketTypesApi(): Promise<TicketTypeRow[]> {
  // 响应为 {types:[...]} 包装（gin.H——与其他裸数组端点不同）
  const data = await request.get('/api/v1/ticket-types')
  return ((data as unknown as { types?: TicketTypeRow[] })?.types ?? [])
}

/** 自定义字段定义（= model.TicketTypeField 投影；field_type 七枚举） */
export interface TicketTypeFieldDef {
  id: string
  type_code: string
  field_key: string
  field_label: string
  field_type: 'input' | 'textarea' | 'number' | 'date' | 'select' | 'multi_select' | 'tips'
  /** select/multi_select 的选项（JSON——[{value,label}] 或字符串数组，渲染时归一） */
  field_options?: unknown
  required: boolean
  validate_regex?: string
  sort_order: number
}

export async function getTicketTypeFieldsApi(typeCode: string): Promise<TicketTypeFieldDef[]> {
  // 响应为 {fields:[...]} 包装（gin.H——与 types 端点同款）
  const data = await request.get(`/api/v1/ticket-types/${typeCode}/fields`)
  return ((data as unknown as { fields?: TicketTypeFieldDef[] })?.fields ?? [])
}

/** 发起工单入参（CreateTicketRequest——custom_data 生成类型标 number[] 失真，按实况
 * 覆写为字段键值对象；assigned_to 拒收[W0 P0-5]前端发起不传） */
export interface CreateTicketInput {
  type_code: string
  title: string
  org_id: string
  priority?: number
  description?: string
  template_code?: string
  custom_data?: Record<string, unknown>
}

/** 创建成功返回完整 Ticket 对象（含 id/status/org_path 等——非 {id} 窄形，调用方按需解构） */
export async function createTicketApi(input: CreateTicketInput): Promise<TicketRow> {
  const data = await request.post('/api/v1/tickets', input, { _silentError: true })
  return data as unknown as TicketRow
}

/** 工单状态（03 S11：六态；in_progress/pending_verify/rejected 经 API 流转不可达——
 * 列表筛选仍可列（历史数据/关闭前曾流转），流转按钮只做分派/取消/关闭/更新/删除 */
export const TICKET_STATUSES: Array<{ value: string; label: string }> = [
  { value: 'open', label: '待处理' },
  { value: 'assigned', label: '已分派' },
  { value: 'in_progress', label: '进行中' },
  { value: 'pending_verify', label: '待验证' },
  { value: 'closed', label: '已关闭' },
  { value: 'rejected', label: '已驳回' },
]

export const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  TICKET_STATUSES.map((s) => [s.value, s.label]),
)

// ===== W4 详情批：评论/备注/关联/流转（S10/S11——按钮码 ticket:comment/note/relation/close/assign/update/delete） =====

/** 评论/备注行（= model.TicketComment 投影；作者为裸 user_id——comments 姓名回填
 * 属后续后端批，前端暂显 ID，勿 N+1 逐条反查） */
export interface TicketCommentRow {
  id: string
  ticket_id: string
  user_id: string
  content: string
  is_internal: boolean
  created_at: string
}

/** 评论列表（无分页——01 §8-W4：详情页「全部展示+条数上限提示」，勿假设 page/total） */
export async function getTicketCommentsApi(id: string): Promise<TicketCommentRow[]> {
  const data = await request.get(`/api/v1/tickets/${id}/comments`)
  return ((data as unknown as { comments?: TicketCommentRow[] })?.comments ?? [])
}

/** 发表公开评论（POST /tickets/comments） */
export async function createTicketCommentApi(ticketId: string, content: string): Promise<void> {
  await request.post('/api/v1/tickets/comments', { ticket_id: ticketId, content }, { _silentError: true })
}

/** 发表内部备注（POST /tickets/notes——仅创建人/处理人/admin 可见，服务端过滤） */
export async function createTicketNoteApi(ticketId: string, content: string): Promise<void> {
  await request.post('/api/v1/tickets/notes', { ticket_id: ticketId, content }, { _silentError: true })
}

/** 关联行（= model.TicketRelation 投影；deleted_at 软删不返回） */
export interface TicketRelationRow {
  id: string
  source_ticket_id: string
  target_ticket_id: string
  relation_type: string
  created_by: string
  created_at: string
}

/** 关联列表（正反向均返回——渲染按 source 是否为本单判方向） */
export async function getTicketRelationsApi(id: string): Promise<TicketRelationRow[]> {
  const data = await request.get(`/api/v1/tickets/${id}/relations`)
  return ((data as unknown as { relations?: TicketRelationRow[] })?.relations ?? [])
}

/** 建立关联（relation_type 缺省 related；自关联 400/正反向判重 409——调用方内联呈现） */
export async function createTicketRelationApi(
  sourceTicketId: string,
  targetTicketId: string,
  relationType?: string,
): Promise<void> {
  await request.post('/api/v1/tickets/relations', {
    source_ticket_id: sourceTicketId,
    target_ticket_id: targetTicketId,
    ...(relationType ? { relation_type: relationType } : {}),
  }, { _silentError: true })
}

/** 编辑工单（patch：title/description/priority——后端字段级 COALESCE，nil 不覆盖；
 * closed 后 409+90004） */
export async function updateTicketApi(
  id: string,
  patch: { title?: string; description?: string; priority?: number },
): Promise<void> {
  await request.post('/api/v1/tickets/update', { id, ...patch }, { _silentError: true })
}

/** 关闭工单（状态机校验；成功无响应体——调用方靠失效刷新，勿依赖返回值） */
export async function closeTicketApi(id: string, comment?: string): Promise<void> {
  await request.post('/api/v1/tickets/close', { id, ...(comment ? { comment } : {}) }, { _silentError: true })
}

/** 分派/取消分派（assignedTo=null 取消分派；open→assigned/assigned→open 自动推状态；
 * assigned_to 用户存在性校验属后端随手项池——传错 ID 500 兜底，前端仅格式预检） */
export async function assignTicketApi(id: string, assignedTo: string | null): Promise<void> {
  await request.post('/api/v1/tickets/assign', { id, ...(assignedTo ? { assigned_to: assignedTo } : { assigned_to: null }) }, { _silentError: true })
}

/** 删除工单（软删） */
export async function deleteTicketApi(id: string): Promise<void> {
  await request.post('/api/v1/tickets/delete', { id }, { _silentError: true })
}
