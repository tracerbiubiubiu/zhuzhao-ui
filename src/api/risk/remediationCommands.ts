/**
 * B2 候选分派/接单/风险接受命令合同。
 * 请求受已生成 API Schema 约束，页面保留语义验证和窄类型。
 * POST 只提交一次；传输失败交由调用方保留原 K，使用注入的只读查询核查。
 */
import request from '@vea/request'
import type { RiskPostBody } from './contracts'

export interface RemediationCommandItem {
  link_id: string
  risk_id: string
  risk_revision: string
  link_revision: string
  remediation_state: string
  title: string
  is_risk_owner: boolean
  can_manage_risk: boolean
  pending_acceptance_id?: string
  pending_acceptance_revision?: string
  pending_acceptance_recoverable?: boolean
  expired_acceptance_id?: string
  expired_acceptance_revision?: string
  proposal_version?: string
}

export interface RemediationCommandContext {
  ticket_id: string
  ticket_revision: string
  definition_version: string
  status: string
  writes_enabled?: boolean
  items: RemediationCommandItem[]
}

export interface RemediationCommandPermissions {
  canAssign: boolean
  canAcceptAssignment: boolean
  canRequestAcceptance: boolean
  canDecideAcceptance: boolean
  canReworkAcceptance?: boolean
}

export interface RemediationCommandCommon {
  operation_id: string
  ticket_id: string
  expected_ticket_revision: string
  definition_version: string
  custom_data_patch?: Record<string, unknown>
  comment?: string
}

export interface AssignRemediationHandlerInput extends RemediationCommandCommon {
  assigned_to_user_id: string
}

export interface RequestRemediationAcceptanceInput extends RemediationCommandCommon {
  risk_id: string
  expected_risk_revision: string
  link_id: string
  expected_link_revision: string
  reason: string
  valid_until: string
}

export interface DecideRemediationAcceptanceInput extends RemediationCommandCommon {
  acceptance_id: string
  expected_acceptance_revision: string
  expected_risk_revision: string
  decision: 'approve' | 'reject'
  reason: string
}

export interface ReworkRemediationAcceptanceInput extends RemediationCommandCommon {
  risk_id: string
  expected_risk_revision: string
  link_id: string
  expected_link_revision: string
  acceptance_id: string
  expected_acceptance_revision: string
  reason: string
}

export interface RemediationCommandOutcomeItem {
  link_id: string
  risk_id: string
  link_revision: string
  risk_revision: string
  proposal_version: string
  resolution_version: string
  result: 'pending_confirmation' | 'applied' | 'rejected' | 'conflict' | 'reworked'
}

/** 对齐 handler riskWorkflowOutcome；分派/接单的 items 可以为空。 */
export interface RemediationCommandOutcome {
  operation_id: string
  ticket_id: string
  ticket_revision: string
  definition_version?: string
  assigned_to_user_id?: string
  assignment_generation?: string
  status?: string
  items: RemediationCommandOutcomeItem[]
  acceptance_id?: string
  acceptance_revision?: string
  acceptance_status?: 'pending' | 'approved' | 'rejected' | 'superseded' | 'expired' | 'reworked'
  terminal_allowed: boolean
}

const maxInt64 = '9223372036854775807'
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const commonFields = [
  'operation_id', 'ticket_id', 'expected_ticket_revision', 'definition_version', 'custom_data_patch', 'comment',
]
const silent = { _silentError: true } as const

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isDecimal(value: unknown, zeroAllowed = false): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value)
    && (zeroAllowed || value !== '0') && (value.length < 19 || value <= maxInt64)
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function assertDecimal(value: unknown, label: string): void {
  if (!isDecimal(value)) throw new Error(`${label}必须为正 int64 十进制字符串`)
}

/** 拒绝 JSON 会静默删除或改写的值，避免原 K 对应的参数发生隐式变化。 */
function isJsonValue(value: unknown, parents: Set<object>): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object' || parents.has(value)) return false
  if (!Array.isArray(value) && !isRecord(value)) return false
  if (Object.getOwnPropertySymbols(value).length > 0) return false
  parents.add(value)
  let valid: boolean
  if (Array.isArray(value)) {
    valid = Object.keys(value).length === value.length
      && Array.from({ length: value.length }, (_, index) => index)
        .every(index => Object.hasOwn(value, index) && isJsonValue(value[index], parents))
  } else {
    valid = Object.values(value).every(entry => isJsonValue(entry, parents))
  }
  parents.delete(value)
  return valid
}

function commonWire(input: RemediationCommandCommon, fields: string[] = []): RemediationCommandCommon {
  if (!isRecord(input) || Object.keys(input).some(key => !commonFields.includes(key) && !fields.includes(key))) {
    throw new Error('整改命令包含不支持的字段')
  }
  if (!isUuid(input.operation_id)) throw new Error('原操作号必须为 canonical UUID')
  assertDecimal(input.ticket_id, '工单 ID')
  assertDecimal(input.expected_ticket_revision, '预期工单修订')
  assertDecimal(input.definition_version, '定义版本')
  if (input.custom_data_patch !== undefined
    && (!isRecord(input.custom_data_patch) || !isJsonValue(input.custom_data_patch, new Set()))) {
    throw new Error('自定义数据补丁必须为可序列化的 JSON 对象')
  }
  if (input.comment !== undefined && typeof input.comment !== 'string') throw new Error('办理说明必须为字符串')
  return {
    operation_id: input.operation_id, ticket_id: input.ticket_id,
    expected_ticket_revision: input.expected_ticket_revision, definition_version: input.definition_version,
    ...(input.custom_data_patch === undefined ? {} : {
      custom_data_patch: JSON.parse(JSON.stringify(input.custom_data_patch)) as Record<string, unknown>,
    }),
    ...(input.comment === undefined ? {} : { comment: input.comment }),
  }
}

/** Go time.Time 接收 RFC3339；此处同时排除 JS Date.parse 会归一的无效日历日期。 */
function isFutureDeadline(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!parts) return false
  const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3])
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth
    && Number(parts[4]) <= 23 && Number(parts[5]) <= 59 && Number(parts[6]) <= 59
    && Number(parts[7] ?? 0) <= 23 && Number(parts[8] ?? 0) <= 59
    && Number.isFinite(Date.parse(value)) && Date.parse(value) > Date.now()
}

function isOutcomeItem(value: unknown): value is RemediationCommandOutcomeItem {
  return isRecord(value) && isDecimal(value.link_id) && isDecimal(value.risk_id)
    && isDecimal(value.link_revision) && isDecimal(value.risk_revision)
    && isDecimal(value.proposal_version, true) && isDecimal(value.resolution_version, true)
    && typeof value.result === 'string' && ['pending_confirmation', 'applied', 'rejected', 'conflict', 'reworked'].includes(value.result)
}

/** POST 与挂载方注入的 GET 均须绑定原 K 和原票，不能把异号或错票当成功。 */
export function validateRemediationCommandOutcome(value: unknown, operationId: string, ticketId: string): RemediationCommandOutcome {
  if (!isUuid(operationId) || !isDecimal(ticketId) || !isRecord(value)
    || value.operation_id !== operationId || value.ticket_id !== ticketId
    || !isDecimal(value.ticket_revision) || !Array.isArray(value.items) || !value.items.every(isOutcomeItem)
    || typeof value.terminal_allowed !== 'boolean'
    || ['definition_version', 'assigned_to_user_id', 'assignment_generation', 'acceptance_id', 'acceptance_revision']
      .some(key => value[key] !== undefined && !isDecimal(value[key]))
    || (value.status !== undefined && !isText(value.status))
    || (value.acceptance_status !== undefined && (typeof value.acceptance_status !== 'string'
      || !['pending', 'approved', 'rejected', 'superseded', 'expired', 'reworked'].includes(value.acceptance_status)))) {
    throw new Error('整改命令回执格式异常或与原操作号、工单不一致')
  }
  return value as unknown as RemediationCommandOutcome
}

export function newRemediationCommandId(): string {
  const crypto = globalThis.crypto
  if (typeof crypto?.randomUUID === 'function') {
    const id = crypto.randomUUID()
    if (!isUuid(id)) throw new Error('随机操作号不是 canonical UUID')
    return id
  }
  if (typeof crypto?.getRandomValues !== 'function') throw new Error('当前环境没有安全随机源，无法创建原操作号')
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function assignRemediationHandlerApi(input: AssignRemediationHandlerInput): Promise<RemediationCommandOutcome> {
  const body = commonWire(input, ['assigned_to_user_id'])
  assertDecimal(input.assigned_to_user_id, '目标办理人 ID')
  const value: unknown = await request.post('/api/v1/risk-items/remediation-assign-handler', {
    ...body, assigned_to_user_id: input.assigned_to_user_id,
  } satisfies RiskPostBody<'/api/v1/risk-items/remediation-assign-handler'>, silent)
  return validateRemediationCommandOutcome(value, body.operation_id, body.ticket_id)
}

export async function acceptRemediationAssignmentApi(input: RemediationCommandCommon): Promise<RemediationCommandOutcome> {
  const body = commonWire(input)
  const value: unknown = await request.post('/api/v1/risk-items/remediation-accept-assignment',
    body satisfies RiskPostBody<'/api/v1/risk-items/remediation-accept-assignment'>, silent)
  return validateRemediationCommandOutcome(value, body.operation_id, body.ticket_id)
}

export async function requestRemediationAcceptanceApi(input: RequestRemediationAcceptanceInput): Promise<RemediationCommandOutcome> {
  const body = commonWire(input, ['risk_id', 'expected_risk_revision', 'link_id', 'expected_link_revision', 'reason', 'valid_until'])
  assertDecimal(input.risk_id, '风险 ID')
  assertDecimal(input.expected_risk_revision, '预期风险修订')
  assertDecimal(input.link_id, '资产关联 ID')
  assertDecimal(input.expected_link_revision, '预期关联修订')
  if (!isText(input.reason)) throw new Error('风险接受理由不能为空')
  if (!isFutureDeadline(input.valid_until)) throw new Error('接受期限必须为带时区的有效未来时间')
  const value: unknown = await request.post('/api/v1/risk-items/remediation-accept-request', {
    ...body, risk_id: input.risk_id, expected_risk_revision: input.expected_risk_revision,
    link_id: input.link_id, expected_link_revision: input.expected_link_revision,
    reason: input.reason, valid_until: input.valid_until,
  } satisfies RiskPostBody<'/api/v1/risk-items/remediation-accept-request'>, silent)
  return validateRemediationCommandOutcome(value, body.operation_id, body.ticket_id)
}

export async function decideRemediationAcceptanceApi(input: DecideRemediationAcceptanceInput): Promise<RemediationCommandOutcome> {
  const body = commonWire(input, ['acceptance_id', 'expected_acceptance_revision', 'expected_risk_revision', 'decision', 'reason'])
  assertDecimal(input.acceptance_id, '接受申请 ID')
  assertDecimal(input.expected_acceptance_revision, '预期接受申请修订')
  assertDecimal(input.expected_risk_revision, '预期风险修订')
  if (input.decision !== 'approve' && input.decision !== 'reject') throw new Error('审批决定必须为 approve 或 reject')
  if (!isText(input.reason)) throw new Error('审批理由不能为空')
  const value: unknown = await request.post('/api/v1/risk-items/remediation-accept-decision', {
    ...body, acceptance_id: input.acceptance_id, expected_acceptance_revision: input.expected_acceptance_revision,
    expected_risk_revision: input.expected_risk_revision, decision: input.decision, reason: input.reason,
  } satisfies RiskPostBody<'/api/v1/risk-items/remediation-accept-decision'>, silent)
  return validateRemediationCommandOutcome(value, body.operation_id, body.ticket_id)
}

export async function reworkRemediationAcceptanceApi(input: ReworkRemediationAcceptanceInput): Promise<RemediationCommandOutcome> {
  const fields = ['risk_id', 'expected_risk_revision', 'link_id', 'expected_link_revision', 'acceptance_id', 'expected_acceptance_revision', 'reason']
  const body = commonWire(input, fields)
  assertDecimal(input.risk_id, '风险 ID')
  assertDecimal(input.expected_risk_revision, '预期风险修订')
  assertDecimal(input.link_id, '资产关联 ID')
  assertDecimal(input.expected_link_revision, '预期关联修订')
  assertDecimal(input.acceptance_id, '原批准 ID')
  assertDecimal(input.expected_acceptance_revision, '预期原批准修订')
  if (!isText(input.reason)) throw new Error('到期接续理由不能为空')
  const data: unknown = await request.post('/api/v1/risk-items/remediation-accept-rework', {
    ...body, risk_id: input.risk_id, expected_risk_revision: input.expected_risk_revision,
    link_id: input.link_id, expected_link_revision: input.expected_link_revision,
    acceptance_id: input.acceptance_id, expected_acceptance_revision: input.expected_acceptance_revision,
    reason: input.reason,
  }, silent)
  return validateRemediationCommandOutcome(data, body.operation_id, body.ticket_id)
}
