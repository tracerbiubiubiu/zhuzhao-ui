/**
 * message 域 API（S6 二期 B6-7 站内消息中心——收件箱读面）。
 * title/link 入站即渲染（读面零渲染逻辑）；深链=link 直跳。
 */
import request from '@vea/request'

/** 站内通知行（事件快照——读过即完；read_at 空=未读） */
export interface NotificationRow {
  id: string
  recipient_id: string
  biz_type: string
  biz_id?: string
  title: string
  link?: string
  created_at: string
  read_at?: string
}

/** 收件箱分页（倒序） */
export async function listNotificationsApi(params: {
  page: number
  page_size: number
  unread?: boolean
}): Promise<{ list: NotificationRow[]; total: number; page: number; page_size: number }> {
  const data = await request.get('/api/v1/notifications/inbox', { params })
  return data as unknown as { list: NotificationRow[]; total: number; page: number; page_size: number }
}

/** 单条已读（幂等；非本人 404 同形） */
export async function markNotificationReadApi(id: string): Promise<void> {
  await request.post('/api/v1/notifications/read', { id }, { _silentError: true })
}

/** 全部已读（返回置读条数） */
export async function markAllNotificationsReadApi(): Promise<number> {
  const data = await request.post('/api/v1/notifications/read-all', {})
  return ((data as unknown as { marked?: number })?.marked ?? 0)
}

// ─── 管理面：模板/规则/发送日志（2026-10-31 自 system/notification 页收口——外部审计 M-2）───
// ⚠ 生成类型缺口：三端点 swag 注解未产 response schema（codegen `responses: never`）——
// 出入参暂手写对齐 model（api/system/org.ts 同款先例），主仓补注解后 codegen 切生成类型。

export interface MessageTemplateRow {
  id?: string
  code: string
  name: string
  channel: string
  biz_type: string
  subject: string
  body: string
  enabled: boolean
  is_system?: boolean
  version?: number
}

export interface MessageRuleRow {
  id: string
  biz_type: string
  event_action: string
  template_code: string
  recipient_type: string
  fixed_recipients?: string
  enabled: boolean
  version?: number
}

export interface MessageLogQuery {
  page: number
  page_size: number
  template_code?: string
  status?: string
  biz_id?: string
}

/** 模板列表（管理面拉全——配置量小，页面头注释豁免口径） */
export async function listMessageTemplatesApi(params: { page: number; page_size: number }): Promise<{ list: MessageTemplateRow[] }> {
  const data = await request.get('/api/v1/message-templates', { params })
  return { list: (data as unknown as { list?: MessageTemplateRow[] })?.list ?? [] }
}

export async function createMessageTemplateApi(body: MessageTemplateRow): Promise<void> {
  await request.post('/api/v1/message-templates', body, { _silentError: true })
}

export async function updateMessageTemplateApi(body: MessageTemplateRow): Promise<void> {
  await request.post('/api/v1/message-templates/update', body, { _silentError: true })
}

export async function deleteMessageTemplateApi(code: string): Promise<void> {
  await request.post('/api/v1/message-templates/delete', { code }, { _silentError: true })
}

/** 规则列表（upsert 面：同 biz_type+event_action 保存=改绑） */
export async function listMessageRulesApi(): Promise<MessageRuleRow[]> {
  const data = await request.get('/api/v1/message-rules')
  return (data as unknown as MessageRuleRow[]) ?? []
}

export async function upsertMessageRuleApi(body: Omit<MessageRuleRow, 'id'>): Promise<void> {
  await request.post('/api/v1/message-rules', body, { _silentError: true })
}

export async function deleteMessageRuleApi(id: string): Promise<void> {
  await request.post('/api/v1/message-rules/delete', { id }, { _silentError: true })
}

/** 发送日志分页（排障三筛选：模板/状态/业务 ID） */
export async function listMessageLogsApi(params: MessageLogQuery): Promise<{ list: Record<string, unknown>[]; total: number }> {
  const data = await request.get('/api/v1/message-logs', { params })
  return data as unknown as { list: Record<string, unknown>[]; total: number }
}
