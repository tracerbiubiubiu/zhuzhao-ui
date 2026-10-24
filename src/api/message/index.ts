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
