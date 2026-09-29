/**
 * PAT API（P4-6——个人 API token：脚本/CI 非交互凭据，GitHub PAT 蓝本）
 *
 * 明文 zpat_* 仅创建响应返回一次（前端弹窗展示+复制，不落本地）；
 * Bearer 直发（JWT 中间件 zpat_ 分支）；可吊销。
 */
import request from '@vea/request'

export interface PatRow {
  id: string
  user_id: string
  name: string
  scope: string
  expires_at?: string | null
  revoked_at?: string | null
  last_used_at?: string | null
  created_at: string
}

export async function listPatsApi(): Promise<PatRow[]> {
  const data = await request.get('/api/v1/user/pats')
  return ((data as unknown as { pats?: PatRow[] })?.pats ?? [])
}

/** 创建——响应含明文 secret（仅此一次） */
export async function createPatApi(input: { name: string; expires_days: number }): Promise<{ pat: PatRow; secret: string }> {
  const data = await request.post('/api/v1/user/pats', input, { _silentError: true })
  return data as unknown as { pat: PatRow; secret: string }
}

export async function revokePatApi(id: string): Promise<void> {
  await request.post('/api/v1/user/pats/delete', { id }, { _silentError: true })
}
