/**
 * intel 域 API（S9 B9-1——威胁情报缓存代理查询）。
 * 前端审计补件：从 intel/query/index.vue 内联 request 抽入 API 层。
 */
import request from '@vea/request'

/** 情报查询结果（09 号 A.4 契约——result 上游原样 ACL 透传；stale=过期缓存降级标记；expires_at=缓存到期，2026-10-27 增补） */
export interface IntelQueryResult {
  type: string
  value: string
  result: Record<string, unknown>
  stale: boolean
  fetched_at: string
  expires_at?: string
  hit_count?: number
}

/** 情报查询（先缓存后上游；同键二查命中零上游调用） */
export async function queryIntelApi(intelType: string, value: string): Promise<IntelQueryResult> {
  const data = await request.get('/api/v1/intel/query', { params: { type: intelType, value } })
  return data as unknown as IntelQueryResult
}
