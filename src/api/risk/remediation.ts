/**
 * 逐资产整改/复测 HTTP 适配（B2 第 8 项——候选风险工作流）。
 *
 * 契约形状来自候选 handler `risk_workflow_handler.go` 与 migrations/000092
 * （remediation_state 五态 CHECK、evidence/measures/note 上限）：
 * - GET  /risk-items/remediation-context/:ticket_id   逐资产办理当前修订（全部 int64 十进制字符串）
 * - POST /risk-items/remediation-finish               办理人提交整改证据（resolution 恒 fixed；
 *                                                     accept 属风险接受接线，不在本适配范围）
 * - POST /risk-items/remediation-review               复测责任人逐项通过(A)/打回(B)，证据恒空数组
 * - GET  /risk-items/remediation-operations/:id       按原操作号只读核查（403/404 保持安全语义）
 *
 * 同号同参幂等、同号异参 409；断网/超时/5xx=提交结果未知——按原号核查，
 * 不换号重做。办理与复测字段互斥由服务端强制（办理提交含复测字段=400），
 * 序列化前同样拒绝跨域字段，不静默丢弃。当前无菜单权限种子：权限入口由
 * 调用方（工单详情）注入，本适配只按既有 request 层携带登录态。
 */
import type { AxiosRequestConfig } from 'axios'
import request from '@vea/request'
import type { RiskPostBody } from './contracts'

export type RemediationState = 'open' | 'pending_verify' | 'rejected' | 'pending_acceptance' | 'resolved'
/** 回执逐项结果（service 层常量）：待复测确认/已生效/已打回/冲突未生效 */
export type RemediationItemResult = 'pending_confirmation' | 'applied' | 'rejected' | 'conflict'
export type RemediationDecision = 'approve' | 'reject'
export type RemediationAction = 'finish' | 'review' | 'accept_request' | 'accept_decision' | 'assign_handler' | 'accept_assignment'

export interface RemediationContextItemDto {
  link_id: string
  risk_id: string
  risk_revision: string
  link_revision: string
  proposal_version: string
  remediation_state: RemediationState
  title: string
  is_risk_owner?: boolean
  can_manage_risk?: boolean
  pending_acceptance_id?: string
  pending_acceptance_revision?: string
  pending_acceptance_recoverable?: boolean
  submissions?: RemediationSubmissionDto[]
}

export interface RemediationSubmissionDto {
  proposal_version: string
  measures: string
  evidence: RemediationEvidenceRefInput[]
  submitted_at: string
  decision?: RemediationDecision
  review_note?: string
  reviewed_at?: string
}

export interface RemediationContextDto {
  ticket_id: string
  ticket_revision: string
  definition_version: string
  status: string
  writes_enabled?: boolean
  allowed_actions?: RemediationAction[]
  items: RemediationContextItemDto[]
}

/** 证据引用（evidence_refs JSONB 元素；kind 仅 file|reference，ref/version 非空有界） */
export interface RemediationEvidenceRefInput {
  kind: 'file' | 'reference'
  ref: string
  version: string
}

/** 通用提交头：原操作号 + 票版本 CAS + 定义版本钉 + 可选票级公共输入 */
export interface RemediationCommonInput {
  operation_id: string
  ticket_id: string
  expected_ticket_revision: string
  definition_version: string
  custom_data_patch?: Record<string, unknown>
  comment?: string
}

export interface RemediationFinishItemInput {
  link_id: string
  expected_link_revision: string
  expected_risk_revision: string
  resolution: 'fixed'
  measures: string
  evidence: RemediationEvidenceRefInput[]
}

export interface RemediationReviewItemInput {
  link_id: string
  expected_link_revision: string
  expected_risk_revision: string
  expected_proposal_version: string
  decision: RemediationDecision
  note: string
  /** 复测不携带新证据（后端 evidence 可空）；契约恒空数组 */
  evidence: []
}

export interface RemediationFinishInput extends RemediationCommonInput {
  items: RemediationFinishItemInput[]
}

export interface RemediationReviewInput extends RemediationCommonInput {
  items: RemediationReviewItemInput[]
}

export interface RemediationOutcomeItemDto {
  link_id: string
  risk_id: string
  link_revision: string
  risk_revision: string
  proposal_version: string
  resolution_version: string
  result: RemediationItemResult
}

/** 提交与只读核查共用回执（acceptance_* 属风险接受接线，本组件不渲染仅透传） */
export interface RemediationOutcomeDto {
  operation_id: string
  ticket_id: string
  ticket_revision: string
  items: RemediationOutcomeItemDto[]
  terminal_allowed: boolean
  acceptance_id?: string
  acceptance_revision?: string
  acceptance_status?: string
}

/** 组件注入端口：生产走真实请求；测试经模块替身注入（DispatchDialog.test.ts 同型） */
export interface RemediationPort {
  context(ticketId: string, signal?: AbortSignal): Promise<RemediationContextDto>
  finish(input: RemediationFinishInput): Promise<RemediationOutcomeDto>
  review(input: RemediationReviewInput): Promise<RemediationOutcomeDto>
  operation(operationId: string, signal?: AbortSignal): Promise<RemediationOutcomeDto>
}

/** 挂载方（工单详情）注入的同票已绑定附件源；version 空=不可作整改证据 */
export interface RemediationEvidenceSource {
  kind?: RemediationEvidenceRefInput['kind']
  /** 附件 object_key 或同票公开记录引用。 */
  ref: string
  file_name: string
  /** 对应 evidence.version（服务端带版本附件校验依据） */
  version: string
}

const maxInt64 = '9223372036854775807'
const REMEDIATION_STATES = ['open', 'pending_verify', 'rejected', 'pending_acceptance', 'resolved'] as const
const ITEM_RESULTS = ['pending_confirmation', 'applied', 'rejected', 'conflict'] as const
const MEASURES_NOTE_MAX = 16000
const EVIDENCE_MAX = 50
const EVIDENCE_REF_MAX = 1000
const EVIDENCE_VERSION_MAX = 200
const OPERATION_KEY_MAX = 128

function isDecimalId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
    && (value.length < maxInt64.length || value <= maxInt64)
}

function isDecimalVersion(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value)
    && (value.length < 19 || value <= maxInt64)
}

function isOperationKey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= OPERATION_KEY_MAX
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isBoundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max
}

/** 证据引用发送侧校验：同票带版本附件由服务端终审，这里只做形状与界限 */
function isEvidenceRef(value: unknown): value is RemediationEvidenceRefInput {
  return isObject(value) && (value.kind === 'file' || value.kind === 'reference')
    && typeof value.ref === 'string' && value.ref.trim().length > 0 && value.ref.length <= EVIDENCE_REF_MAX
    && typeof value.version === 'string' && value.version.trim().length > 0 && value.version.length <= EVIDENCE_VERSION_MAX
}

function isEvidenceList(value: unknown, required: boolean): value is RemediationEvidenceRefInput[] {
  return Array.isArray(value) && value.length <= EVIDENCE_MAX && (required ? value.length > 0 : true)
    && value.every(isEvidenceRef)
}

function assertId(value: unknown, label: string): void {
  if (!isDecimalId(value)) throw new Error(`${label}必须为有效的十进制字符串`)
}

function assertVersion(value: unknown, label: string): void {
  if (!isDecimalVersion(value)) throw new Error(`${label}必须为有效的十进制版本`)
}

/** 预期修订/提案版本发送侧恒为正（服务端 expected<=0 即无效参数） */
function assertPositiveVersion(value: unknown, label: string): void {
  if (!isDecimalVersion(value) || value === '0') throw new Error(`${label}必须为正的十进制版本`)
}

function assertOperationKey(value: unknown): void {
  if (!isOperationKey(value)) throw new Error('原操作号必须为 1-128 位非空字符串')
}

function isPlainPatch(value: unknown): value is Record<string, unknown> {
  return isObject(value) && Object.keys(value).length > 0
}

/** 通用提交头序列化（空 patch/空注释不发送，服务端按缺省归一） */
function commonWire(input: RemediationCommonInput) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.operation_id)) {
    throw new Error('原操作号必须为规范 UUID')
  }
  assertId(input.ticket_id, '工单 ID')
  assertPositiveVersion(input.expected_ticket_revision, '预期工单修订')
  assertVersion(input.definition_version, '定义版本')
  if (input.custom_data_patch !== undefined && !isObject(input.custom_data_patch)) {
    throw new Error('自定义数据补丁必须为对象')
  }
  if (input.comment !== undefined && typeof input.comment !== 'string') throw new Error('办理说明必须为字符串')
  return {
    operation_id: input.operation_id,
    ticket_id: input.ticket_id,
    expected_ticket_revision: input.expected_ticket_revision,
    definition_version: input.definition_version,
    ...(isPlainPatch(input.custom_data_patch) && { custom_data_patch: input.custom_data_patch }),
    ...(input.comment ? { comment: input.comment } : {}),
  }
}

/** 办理项序列化：拒绝复测字段混入（服务端同语义 400），resolution 只接受 fixed */
function finishItemWire(item: RemediationFinishItemInput) {
  assertId(item.link_id, '资产关联 ID')
  assertPositiveVersion(item.expected_link_revision, '预期关联修订')
  assertPositiveVersion(item.expected_risk_revision, '预期风险修订')
  if ('decision' in item || 'note' in item || 'expected_proposal_version' in item) {
    throw new Error('办理提交不得携带复测字段')
  }
  if (item.resolution !== 'fixed') throw new Error('办理方式仅支持 fixed，风险接受不在本提交范围')
  if (!isBoundedText(item.measures, MEASURES_NOTE_MAX)) throw new Error('整改措施必须为非空且有界文本')
  if (!isEvidenceList(item.evidence, true)) throw new Error('整改证据必须为 1-50 条带版本引用')
  return {
    link_id: item.link_id,
    expected_link_revision: item.expected_link_revision,
    expected_risk_revision: item.expected_risk_revision,
    resolution: item.resolution,
    measures: item.measures,
    evidence: item.evidence.map(ref => ({ kind: ref.kind, ref: ref.ref, version: ref.version })),
  }
}

/** 复测项序列化：拒绝办理字段混入，证据恒空数组 */
function reviewItemWire(item: RemediationReviewItemInput) {
  assertId(item.link_id, '资产关联 ID')
  assertPositiveVersion(item.expected_link_revision, '预期关联修订')
  assertPositiveVersion(item.expected_risk_revision, '预期风险修订')
  assertPositiveVersion(item.expected_proposal_version, '预期提案版本')
  if ('resolution' in item || 'measures' in item) throw new Error('复测提交不得携带办理字段')
  if (item.decision !== 'approve' && item.decision !== 'reject') throw new Error('复测决定仅支持 approve 或 reject')
  if (!isBoundedText(item.note, MEASURES_NOTE_MAX)) throw new Error('复测说明必须为非空且有界文本')
  if (!Array.isArray(item.evidence) || item.evidence.length !== 0) throw new Error('复测提交证据恒为空数组')
  return {
    link_id: item.link_id,
    expected_link_revision: item.expected_link_revision,
    expected_risk_revision: item.expected_risk_revision,
    expected_proposal_version: item.expected_proposal_version,
    decision: item.decision,
    note: item.note,
    evidence: [] as [],
  }
}

function isContextItem(value: unknown): value is RemediationContextItemDto {
  return isObject(value) && isDecimalId(value.link_id) && isDecimalId(value.risk_id)
    && isDecimalVersion(value.risk_revision) && isDecimalVersion(value.link_revision)
    && isDecimalVersion(value.proposal_version)
    && (REMEDIATION_STATES as readonly unknown[]).includes(value.remediation_state)
    && (value.is_risk_owner === undefined || typeof value.is_risk_owner === 'boolean')
    && (value.can_manage_risk === undefined || typeof value.can_manage_risk === 'boolean')
    && optionalDecimal(value.pending_acceptance_id) && optionalDecimal(value.pending_acceptance_revision)
    && (value.pending_acceptance_recoverable === undefined || typeof value.pending_acceptance_recoverable === 'boolean')
    && (value.submissions === undefined || (Array.isArray(value.submissions) && value.submissions.every(isSubmission)))
    && isBoundedText(value.title, Number.MAX_SAFE_INTEGER)
}

function isSubmission(value: unknown): value is RemediationSubmissionDto {
  return isObject(value) && isDecimalId(value.proposal_version) && typeof value.measures === 'string'
    && typeof value.submitted_at === 'string' && (value.review_note === undefined || typeof value.review_note === 'string')
    && (value.decision === undefined || value.decision === 'approve' || value.decision === 'reject')
    && Array.isArray(value.evidence) && value.evidence.every(ref => isObject(ref)
      && (ref.kind === 'file' || ref.kind === 'reference') && typeof ref.ref === 'string' && typeof ref.version === 'string')
}

function isOutcomeItem(value: unknown): value is RemediationOutcomeItemDto {
  return isObject(value) && isDecimalId(value.link_id) && isDecimalId(value.risk_id)
    && isDecimalVersion(value.link_revision) && isDecimalVersion(value.risk_revision)
    && isDecimalVersion(value.proposal_version) && isDecimalVersion(value.resolution_version)
    && (ITEM_RESULTS as readonly unknown[]).includes(value.result)
}

/** nullable/optional 回执扩展：出现（或 null）则必须形状正确（Go omitempty 同义缺省） */
function optionalDecimal(value: unknown): boolean {
  return value === undefined || value === null || isDecimalId(value)
}

function optionalStatus(value: unknown): boolean {
  return value === undefined || value === null || isBoundedText(value, Number.MAX_SAFE_INTEGER)
}

/** 上下文响应校验：票号必须与请求一致，其余漂移一律拒绝 */
export function validateRemediationContext(value: unknown, ticketId: string): RemediationContextDto {
  if (!isObject(value) || value.ticket_id !== ticketId || !isDecimalId(value.ticket_id)
    || !isDecimalVersion(value.ticket_revision) || !isDecimalVersion(value.definition_version)
    || !isBoundedText(value.status, Number.MAX_SAFE_INTEGER)
    || (value.writes_enabled !== undefined && typeof value.writes_enabled !== 'boolean')
    || (value.allowed_actions !== undefined && (!Array.isArray(value.allowed_actions)
      || !value.allowed_actions.every(action => typeof action === 'string')))
    || !Array.isArray(value.items) || !value.items.every(isContextItem)) {
    throw new Error('逐资产办理数据格式异常')
  }
  return value as unknown as RemediationContextDto
}

/** 回执校验：原号一致才确认（原请求明确回据）；acceptance_* 仅形状校验不渲染 */
export function validateRemediationOutcome(value: unknown, operationId: string): RemediationOutcomeDto {
  if (!isObject(value) || value.operation_id !== operationId || !isOperationKey(value.operation_id)
    || !isDecimalId(value.ticket_id) || !isDecimalVersion(value.ticket_revision)
    || !Array.isArray(value.items) || !value.items.every(isOutcomeItem)
    || typeof value.terminal_allowed !== 'boolean'
    || !optionalDecimal(value.acceptance_id) || !optionalDecimal(value.acceptance_revision)
    || !optionalStatus(value.acceptance_status)) {
    throw new Error('整改回执数据格式异常')
  }
  return value as unknown as RemediationOutcomeDto
}

type SilentConfig = Pick<AxiosRequestConfig, '_silentError' | 'signal'>

const silent = { _silentError: true } satisfies SilentConfig

/** 逐资产办理当前修订（403/404 保持安全语义，由调用方按读取失败展示） */
export async function getRemediationContextApi(ticketId: string, signal?: AbortSignal): Promise<RemediationContextDto> {
  assertId(ticketId, '工单 ID')
  const data: unknown = await request.get(`/api/v1/risk-items/remediation-context/${ticketId}`, { ...silent, signal })
  return validateRemediationContext(data, ticketId)
}

/** 办理提交（断网/超时/5xx=结果未知：保留原号原参，按 operations/:id 只读核查） */
export async function finishRemediationApi(input: RemediationFinishInput): Promise<RemediationOutcomeDto> {
  const body = { ...commonWire(input), items: input.items.map(finishItemWire) } satisfies RiskPostBody<'/api/v1/risk-items/remediation-finish'>
  if (body.items.length === 0) throw new Error('整改提交至少包含一项资产')
  const data: unknown = await request.post('/api/v1/risk-items/remediation-finish', body, silent)
  return validateRemediationOutcome(data, input.operation_id)
}

/** 逐项通过/打回（同号同参幂等；A=approve 生效，B=reject 打回重办） */
export async function reviewRemediationApi(input: RemediationReviewInput): Promise<RemediationOutcomeDto> {
  const body = { ...commonWire(input), items: input.items.map(reviewItemWire) } satisfies RiskPostBody<'/api/v1/risk-items/remediation-review'>
  if (body.items.length === 0) throw new Error('复测提交至少包含一项资产')
  const data: unknown = await request.post('/api/v1/risk-items/remediation-review', body, silent)
  return validateRemediationOutcome(data, input.operation_id)
}

/** 按原操作号只读核查（404=服务端尚未记录该号，不代表未提交；绝不回退 POST） */
export async function getRemediationOperationApi(operationId: string, signal?: AbortSignal): Promise<RemediationOutcomeDto> {
  assertOperationKey(operationId)
  const data: unknown = await request.get(`/api/v1/risk-items/remediation-operations/${encodeURIComponent(operationId)}`, { ...silent, signal })
  return validateRemediationOutcome(data, operationId)
}

export const riskRemediationHttpPort: RemediationPort = {
  context: getRemediationContextApi,
  finish: finishRemediationApi,
  review: reviewRemediationApi,
  operation: getRemediationOperationApi,
}
