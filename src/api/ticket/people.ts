import request from '@vea/request'
import { assignmentId, assignmentRecord } from '@/api/system/assignmentPayload'

export type TicketPeopleContext =
  | { purpose: 'assign' | 'transfer' | 'cc'; ticketId: string }
  | { purpose: 'create-supervisor'; orgId: string; typeCode: string }
  | { purpose: 'rule-target'; orgId: string }

export interface PersonOption { id: string; label: string }

/** Only business-context identities; user management keeps its original API. */
export async function searchTicketPeopleApi(context: TicketPeopleContext, q: string): Promise<PersonOption[]> {
  const params = 'ticketId' in context
    ? { purpose: context.purpose, ticket_id: context.ticketId, q }
    : { purpose: context.purpose, org_id: context.orgId, ...('typeCode' in context ? { type_code: context.typeCode } : {}), q }
  const data = await request.get('/api/v1/tickets/people', { params, _silentError: true })
  const body = assignmentRecord(data)
  if (!Array.isArray(body.list) || body.list.length > 20) throw new Error('选人响应列表无效')
  const seen = new Set<string>()
  return body.list.map((raw) => {
    const row = assignmentRecord(raw)
    const id = assignmentId(row.id)
    if (seen.has(id) || typeof row.label !== 'string' || !row.label.trim()) throw new Error('选人项无效')
    seen.add(id)
    return { id, label: row.label }
  })
}

/** Management callers still require GET /users. Never fall back here after business denial. */
export async function searchManagedPeopleApi(q: string): Promise<PersonOption[]> {
  const results = await Promise.all([{ employee_no: q }, { username: q }].map((filter) =>
    request.get('/api/v1/users', { params: { page: 1, page_size: 20, status: 1, ...filter }, _silentError: true })))
  const merged = new Map<string, PersonOption>()
  for (const result of results) {
    const body = assignmentRecord(result)
    if (!Array.isArray(body.list)) throw new Error('用户搜索响应列表无效')
    for (const raw of body.list) {
      const row = assignmentRecord(raw)
      const id = assignmentId(row.id)
      if (typeof row.username !== 'string' || typeof row.employee_no !== 'string' || typeof row.real_name !== 'string') throw new Error('用户搜索项无效')
      merged.set(id, { id, label: `${row.real_name || row.username}(${row.employee_no})` })
    }
  }
  return [...merged.values()].slice(0, 20)
}
