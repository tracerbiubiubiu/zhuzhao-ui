/**
 * storage 域 API（phase5 S5——B5-1/B5-2/B5-3/B5-4 前端批）
 *
 * 端点面（05 号 A.4——全部走 @vea/request 信封）：
 * - presignUpload: 预签名直传（ticket 态必带 ticket_id——L2 在 handler 编排）
 * - confirm: 确认（HEAD 实测 + 翻 confirmed + ticket 态落绑）
 * - bindAvatar: 头像回写（B5-2）
 * - listAttachments / deleteAttachment: 工单附件区（B5-3）
 * - renderRichtext: 服务端 MD 白名单渲染（B5-4 渲染 SSOT）
 */

import request from '@vea/request'

// ─── 类型 ───

export interface PresignResponse {
  upload_url: string
  method: string
  headers: Record<string, string>
  object_key: string
  expires_at: string
}

export interface ConfirmResponse {
  id: string
  bucket: string
  object_key: string
  purpose: string
  status: string
  file_name: string
  mime_type: string
  size_bytes?: string
  etag?: string
  confirmed_at?: string
  owner_kind?: string
  owner_id?: string
}

export interface AttachmentView {
  id: string
  ticket_id: string
  object_key: string
  file_name: string
  mime_type: string
  size_bytes?: string
  uploaded_by: string
  uploaded_by_name?: string // 后端回填（real_name 优先）
  created_at: string
}

export type PresignPurpose =
  | 'avatar' | 'avatar_create'
  | 'ticket_attachment' | 'attachment_create'
  | 'ticket_richtext' | 'richtext_create'

// ─── API 调用 ───

/** 预签名直传（POST /storage/presign/upload——登录态自服务+L2 ticket 态 handler 编排） */
export async function presignUpload(data: {
  purpose: PresignPurpose
  file_name: string
  mime_type: string
  size_bytes: string
  ticket_id?: string
}): Promise<PresignResponse> {
  const res = await request.post('/storage/presign/upload', data)
  return res as unknown as PresignResponse
}

/** 确认上传（POST /tickets/attachments/confirm——HEAD 实测+翻 confirmed+ticket 态落绑） */
export async function confirmUpload(data: { object_key: string; ticket_id?: string }): Promise<ConfirmResponse> {
  const res = await request.post('/tickets/attachments/confirm', data)
  return res as unknown as ConfirmResponse
}

/** 头像回写（POST /storage/avatar/bind——本人 confirmed avatar 对象→users.avatar） */
export async function bindAvatar(data: { object_key: string }): Promise<ConfirmResponse> {
  const res = await request.post('/storage/avatar/bind', data)
  return res as unknown as ConfirmResponse
}

/** 工单附件列表（GET /tickets/:id/attachments——L2 read 面） */
export async function listAttachments(ticketId: string): Promise<AttachmentView[]> {
  const res = await request.get(`/tickets/${ticketId}/attachments`)
  return res as unknown as AttachmentView[]
}

/** 删除附件（POST /tickets/attachments/delete——L2 update 面，删关联+GC） */
export async function deleteAttachment(data: { ticket_id: string; object_key: string }): Promise<void> {
  await request.post('/tickets/attachments/delete', data)
}

/** 服务端 MD 渲染（POST /tickets/richtext/render——白名单 HTML 出站） */
export async function renderRichtext(data: { content: string }): Promise<{ html: string }> {
  const res = await request.post('/tickets/richtext/render', data)
  return res as unknown as { html: string }
}

// ─── 直传辅助（presign→PUT→confirm 三步封装） ───

/**
 * uploadAndConfirm 三步直传：
 * ① presign 拿 upload_url+headers → ② PUT 原生 fetch 直传（不带 auth——签名已钉）
 * → ③ confirm HEAD 实测翻 confirmed（ticket 态自动落绑）
 * 返回 confirm 后的 FileObject（含 object_key/status/etag 等）。
 */
export async function uploadAndConfirm(
  file: File,
  purpose: PresignPurpose,
  ticketId?: string,
): Promise<ConfirmResponse> {
  const pre = await presignUpload({
    purpose,
    file_name: file.name,
    mime_type: file.type,
    size_bytes: String(file.size),
    ...(ticketId ? { ticket_id: ticketId } : {}),
  })
  // PUT 直传（原生 fetch——不带 Authorization，签名已含 Content-Type）
  const resp = await fetch(pre.upload_url, {
    method: pre.method,
    headers: pre.headers as Record<string, string>,
    body: file,
  })
  if (!resp.ok) {
    throw new Error(`直传失败 HTTP ${resp.status}`)
  }
  return confirmUpload({
    object_key: pre.object_key,
    ...(ticketId ? { ticket_id: ticketId } : {}),
  })
}
