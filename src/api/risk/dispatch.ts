import request from '@vea/request'
import type { RiskPostBody } from './contracts'

export interface DispatchPlanInput {
  items: { risk_id: string; expected_revision: string }[]
  target_org_id: string
  target_type_code: string
}

export type DispatchInput = RiskPostBody<'/api/v1/risk-items/dispatch'>

/** 仅后端确认当前仍有读权时出现；缺省时不可推断原票存在性。 */
export interface TicketReference {
  id: string
  ref: string
}

export interface DispatchPlanItem {
  risk_id: string
  revision: string
  human_key: string
  title: string
}

export interface DispatchPlanGroup {
  group_key: string
  owner_user_id: string
  ticket?: TicketReference
  items: DispatchPlanItem[]
}

export interface DispatchPlanBlock {
  risk_id: string
  reason: string
}

export interface DispatchPlan {
  plan_id: string
  plan_hash: string
  expires_at: string
  groups: DispatchPlanGroup[]
  blocked: DispatchPlanBlock[]
}

export type DispatchItemResult = 'created' | 'linked' | 'already_linked' | 'denied' | 'invalid' | 'conflict'

export interface DispatchItemOutcome {
  risk_id: string
  result: DispatchItemResult
  ticket?: TicketReference
  reason?: string
}

export interface DispatchGroupOutcome {
  group_key: string
  group_operation_id?: string
  status: 'completed' | 'failed'
  ticket?: TicketReference
  owner_user_id?: string
  owner_org_at_dispatch?: string
  items: DispatchItemOutcome[]
}

export interface DispatchResult {
  operation_id: string
  plan_id: string
  status: 'pending' | 'partial' | 'completed'
  groups: DispatchGroupOutcome[]
}

type DispatchPlanWire = Omit<DispatchPlan, 'groups' | 'blocked'> & {
  groups: (Omit<DispatchPlanGroup, 'items'> & { items: DispatchPlanItem[] | null })[] | null
  blocked?: DispatchPlanBlock[] | null
}

type DispatchResultWire = Omit<DispatchResult, 'groups'> & {
  groups: (Omit<DispatchGroupOutcome, 'items'> & { items: DispatchItemOutcome[] | null })[] | null
}

function assertDecimalInt64(value: unknown, allowZero: boolean): asserts value is string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)
    || (!allowZero && value === '0') || BigInt(value) > 9223372036854775807n) {
    throw new Error('风险、组织和版本必须为有效的十进制字符串')
  }
}

function normalizeList<T>(items: T[] | null): T[] {
  if (items === null) return [] // Go nil slice 的合法空集合。
  if (!Array.isArray(items)) throw new Error('派单响应不完整，请重新核对')
  return items
}

function assertResponseStrings(...values: unknown[]): void {
  if (values.some(value => typeof value !== 'string' || !value.trim())) {
    throw new Error('派单响应不完整，请重新核对')
  }
}

function validateTicket(ticket?: TicketReference): void {
  if (ticket === undefined) return
  assertDecimalInt64(ticket.id, false)
  assertResponseStrings(ticket.ref)
}

/** 预览只提交具名风险版本及目标配置，所有 int64 保持十进制字符串。 */
export async function planDispatch(input: DispatchPlanInput): Promise<DispatchPlan> {
  assertDecimalInt64(input.target_org_id, false)
  const items = input.items.map(item => {
    assertDecimalInt64(item.risk_id, false)
    assertDecimalInt64(item.expected_revision, true)
    return { risk_id: item.risk_id, expected_revision: item.expected_revision }
  })
  const data = await request.post('/api/v1/risk-items/dispatch-plan', {
    items, target_org_id: input.target_org_id, target_type_code: input.target_type_code,
  } satisfies RiskPostBody<'/api/v1/risk-items/dispatch-plan'>, { _silentError: true }) as unknown as DispatchPlanWire
  assertResponseStrings(data.plan_id, data.plan_hash, data.expires_at)
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(data.expires_at)
    || Number.isNaN(Date.parse(data.expires_at))) throw new Error('派单预览有效期无效，请重新核对')
  return {
    ...data,
    groups: normalizeList(data.groups).map(group => {
      assertResponseStrings(group.group_key)
      assertDecimalInt64(group.owner_user_id, false)
      validateTicket(group.ticket)
      const items = normalizeList(group.items)
      for (const item of items) {
        assertDecimalInt64(item.risk_id, false)
        assertDecimalInt64(item.revision, true)
      }
      return { ...group, items }
    }),
    blocked: (data.blocked === undefined ? [] : normalizeList(data.blocked)).map(block => {
      assertDecimalInt64(block.risk_id, false)
      assertResponseStrings(block.reason)
      return block
    }),
  }
}

function normalizeDispatchResult(data: DispatchResultWire, operationId: string): DispatchResult {
  assertResponseStrings(data.operation_id, data.plan_id)
  if (data.operation_id !== operationId) throw new Error('派单响应操作号不一致，请按原操作号核对')
  if (!['pending', 'partial', 'completed'].includes(data.status)) throw new Error('派单结果状态无效，请按原操作号核对')
  return {
    ...data,
    groups: normalizeList(data.groups).map(group => {
      assertResponseStrings(group.group_key)
      if (!['completed', 'failed'].includes(group.status)) throw new Error('派单组状态无效，请按原操作号核对')
      if (group.group_operation_id !== undefined) assertResponseStrings(group.group_operation_id)
      if (group.owner_user_id !== undefined) assertDecimalInt64(group.owner_user_id, false)
      if (group.owner_org_at_dispatch !== undefined) assertDecimalInt64(group.owner_org_at_dispatch, false)
      validateTicket(group.ticket)
      const items = normalizeList(group.items)
      for (const item of items) {
        assertDecimalInt64(item.risk_id, false)
        if (!['created', 'linked', 'already_linked', 'denied', 'invalid', 'conflict'].includes(item.result)) {
          throw new Error('派单项结果无效，请按原操作号核对')
        }
        validateTicket(item.ticket)
        if (item.reason !== undefined) assertResponseStrings(item.reason)
      }
      return { ...group, items }
    }),
  }
}

/** 按原三元组提交或恢复，不添加业务覆盖字段，不自行重试或换号。 */
export async function applyDispatch(input: DispatchInput): Promise<DispatchResult> {
  const data = await request.post('/api/v1/risk-items/dispatch', {
    operation_id: input.operation_id, plan_id: input.plan_id, plan_hash: input.plan_hash,
  } satisfies DispatchInput, { _silentError: true }) as unknown as DispatchResultWire
  return normalizeDispatchResult(data, input.operation_id)
}

/** 只读取原操作已提交的结果；404 与丢响应原样拒绝，不续建、不回退提交。 */
export async function getDispatchOperation(operationId: string): Promise<DispatchResult> {
  const data = await request.get(`/api/v1/risk-items/dispatch-operations/${encodeURIComponent(operationId)}`, {
    _silentError: true,
  }) as unknown as DispatchResultWire
  return normalizeDispatchResult(data, operationId)
}
