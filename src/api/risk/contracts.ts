/**
 * 风险域前端契约（B2 第 6 项接线——本轮真实候选形状，来自冻结源码
 * `internal/model/risk_item.go` 与 `migrations/000089` 菜单种子）。
 *
 * 与旧首片的差异（本轮候选契约错配修复）：
 * - 写返回 `receipt_ref` 是 RiskReceipt **对象**（operation_id/command/status/
 *   risk_id/revision/created_at/replayed），不再是字符串回执号；
 * - 详情 data 以 `view` 包裹列表行（RiskDetailView.view），另带
 *   description/system_ref/evidence_refs/attributes/source_summary；
 * - 新增按原号查回收据的读取端点 GET /risk-items/operations/:id（提交结果未知
 *   时受权核查，同号同命令才确认生效）。
 *
 * 本文件只做 DTO 形状与页面投影校验；HTTP 适配在 ./index.ts（existing request 层）。
 */
import type { paths } from '../__generated__/schema'

type RiskPath = Extract<keyof paths, `/api/v1/risk-items/${string}`>
type JSONPost<Endpoint> = Endpoint extends {
  post: { requestBody: { content: { 'application/json': infer Body } } }
} ? Body : never

export type RiskPostBody<Path extends RiskPath> = JSONPost<paths[Path]>

export type RiskId = string
export type RiskRevision = string
export type RiskLevel = 'urgent' | 'high' | 'medium' | 'low'
export type RiskState = 'new' | 'assessed' | 'remediating' | 'pending_verify' | 'accepted' | 'closed'
export type RiskTreatment = 'mitigate' | 'accept' | 'transfer' | 'avoid'
/** 写命令名（RiskReceipt.command；服务端 mutation.go 恒 create|assess|assign） */
export type RiskCommand = 'create' | 'assess' | 'assign'

/** 派单阻断标记（本轮服务端仅显式给出该值；D10 派单属第 7 项消费者） */
export const OWNER_UNCONFIRMED = 'owner_unconfirmed'

export interface RiskRefDto {
  id: RiskId
  human_key: string
  revision: RiskRevision
}

export interface SourceSeverityDto {
  scheme: string
  value: string
}

export interface AssetRefDto {
  provider: string
  external_id: string
}

/** 证据引用（provider/external_id/version? 对象——生命周期合同 §8.1） */
export interface RiskEvidenceRefDto {
  provider: string
  external_id: string
  version?: string
}

/** 列表行与详情 view 包裹共用的候选 RiskView（交接清单 §3 data 内字段） */
export interface RiskViewDto {
  risk: RiskRefDto
  title: string
  status: RiskState
  closure_kind: string | null
  level: RiskLevel | null
  owner_user_id: RiskId | null
  org_id: RiskId
  affected_org_id: RiskId | null
  deadline: string | null
  init_deadline: string | null
  treatment: RiskTreatment | null
  source_severity: SourceSeverityDto | null
  asset_ref: AssetRefDto | null
  dispatch_blockers: string[]
}

/** 详情 data 实势：RiskDetailView（view 包裹 + 有界扩展；evidence_refs 可为 null） */
export interface RiskDetailDto {
  view: RiskViewDto
  description: string
  system_ref: string
  evidence_refs: RiskEvidenceRefDto[] | null
  attributes: unknown
  source_summary: unknown
}

/** durable 操作收据（risk_operations 行投影；risk_item.go RiskReceipt）。
 * risk_id/revision 为 Go omitempty：新建恒有，查回未知归属时缺省 */
export interface RiskReceiptDto {
  operation_id: string
  command: RiskCommand
  status: RiskState
  risk_id?: RiskId
  revision?: RiskRevision
  created_at: string
  /** true=同号同参返回原收据/按原号查回，未产生新业务效果 */
  replayed: boolean
}

interface RiskPagination {
  page: number
  page_size: number
}

export interface RiskFilters {
  q: string
  level: RiskLevel | ''
}

export interface RiskListParams extends RiskPagination {
  q?: string
  level?: RiskLevel
}

export interface RiskPageDto {
  items: RiskViewDto[]
  total: number
}

export interface RiskReader {
  list(params: RiskListParams, signal: AbortSignal): Promise<RiskPageDto>
  detail(id: RiskId, signal: AbortSignal): Promise<RiskDetailDto>
  /** 按原操作号受权核查写回执（提交结果未知时的只读出口） */
  operation(operationId: string, signal?: AbortSignal): Promise<RiskReceiptDto>
}

/** 写端口：operation_id 由调用方（写会话管理器）分配并保持稳定 */
export interface RiskWriter {
  create(command: RiskCreateCommand): Promise<RiskCreateResult>
  assess(command: RiskAssessCommand): Promise<RiskAssessResult>
  assign(command: RiskAssignCommand): Promise<RiskMutationResult>
}

/** 写命令统一 Mutation：operation_id + expected_revision（同号同参幂等，同号异参 409） */
export interface RiskCreateCommand {
  operation_id: string
  title: string
  description: string
  org_id: RiskId
  affected_org_id?: RiskId
  /** 可选；不传=责任待确认（owner_unconfirmed） */
  owner_user_id?: RiskId
  expected_revision: RiskRevision
  attributes: Record<string, never>
}

export interface RiskAssessCommand {
  operation_id: string
  id: RiskId
  expected_revision: RiskRevision
  level: RiskLevel
  assessment_note: string
  treatment: RiskTreatment
  /** 可选；首次写入即 init_deadline，缺省按级别策略带出 */
  deadline?: string
}

export interface RiskAssignCommand {
  operation_id: string
  id: RiskId
  expected_revision: RiskRevision
  owner_user_id: RiskId
  reason: string
}

/** 写命令统一返回（risk_item.go RiskMutationResult）：receipt_ref 恒为对象 */
export interface RiskMutationResult {
  risk: RiskRefDto
  receipt_ref: RiskReceiptDto
}

export interface RiskCreateResult extends RiskMutationResult {
  status: RiskState
}

export interface RiskAssessResult {
  risk: RiskRefDto
  status: RiskState
  level: RiskLevel
  deadline: string | null
  receipt_ref: RiskReceiptDto
}

export function riskListParams({ page, page_size }: RiskPagination, filters: RiskFilters): RiskListParams {
  const q = filters.q.trim()
  return { page, page_size, ...(q && { q }), ...(filters.level && { level: filters.level }) }
}

/** 责任待确认判据：RiskView.dispatch_blockers 显式给出（派单预览须拒绝该组）；
 * 空集可序列化为 null/省略（Go nil slice），消费端宽容处理 */
export function ownerUnconfirmed(row: Pick<RiskViewDto, 'dispatch_blockers'>): boolean {
  return row.dispatch_blockers?.includes(OWNER_UNCONFIRMED) === true
}

const maxInt64 = '9223372036854775807'

export function isRiskId(value: unknown): value is RiskId {
  return typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value)
    && (value.length < maxInt64.length || value <= maxInt64)
}

function isRevision(value: unknown): value is RiskRevision {
  return typeof value === 'string' && /^(0|[1-9]\d{0,18})$/.test(value)
    && (value.length < 19 || value <= maxInt64)
}

const RISK_LEVELS = ['urgent', 'high', 'medium', 'low'] as const
const RISK_STATES = ['new', 'assessed', 'remediating', 'pending_verify', 'accepted', 'closed'] as const
const RISK_TREATMENTS = ['mitigate', 'accept', 'transfer', 'avoid'] as const
const RISK_COMMANDS = ['create', 'assess', 'assign'] as const

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLevel(value: unknown): value is RiskLevel {
  return (RISK_LEVELS as readonly unknown[]).includes(value)
}

function isState(value: unknown): value is RiskState {
  return (RISK_STATES as readonly unknown[]).includes(value)
}

function isTreatment(value: unknown): value is RiskTreatment {
  return (RISK_TREATMENTS as readonly unknown[]).includes(value)
}

function isCommand(value: unknown): value is RiskCommand {
  return (RISK_COMMANDS as readonly unknown[]).includes(value)
}

/** nullable 列可缺省（Go 序列化 null/省略同义），出现则须类型正确；返回 undefined=形状漂移 */
function optional<T>(value: unknown, check: (v: unknown) => boolean): T | null | undefined {
  if (value === undefined || value === null) return value as null | undefined
  return check(value) ? (value as T) : undefined
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isRiskRef(value: unknown): value is RiskRefDto {
  return isObject(value) && isRiskId(value.id) && isRevision(value.revision) && typeof value.human_key === 'string'
}

function isRiskView(value: unknown): value is RiskViewDto {
  if (!isObject(value) || !isRiskRef(value.risk) || typeof value.title !== 'string') return false
  if (!isState(value.status)) return false
  if (!isRiskId(value.org_id)) return false
  const level = optional(value.level, isLevel)
  const treatment = optional(value.treatment, isTreatment)
  const affected = optional(value.affected_org_id, isRiskId)
  const owner = optional(value.owner_user_id, isRiskId)
  const closure = optional<string>(value.closure_kind, v => typeof v === 'string' && v.length > 0)
  const deadline = optional<string>(value.deadline, v => typeof v === 'string' && v.length > 0)
  const initDeadline = optional<string>(value.init_deadline, v => typeof v === 'string' && v.length > 0)
  const severity = optional<SourceSeverityDto>(value.source_severity, v => isObject(v)
    && typeof v.scheme === 'string' && typeof v.value === 'string')
  const asset = optional<AssetRefDto>(value.asset_ref, v => isObject(v)
    && typeof v.provider === 'string' && typeof v.external_id === 'string')
  // dispatch_blockers 空集可序列化为 null/省略（Go nil slice）——校验宽松、消费端归一
  const blockers = value.dispatch_blockers
  if (blockers !== undefined && blockers !== null && !Array.isArray(blockers)) return false
  if (Array.isArray(blockers) && !blockers.every(item => typeof item === 'string' && item.length > 0)) return false
  return [level, treatment, affected, owner, closure, deadline, initDeadline, severity, asset]
    .every(field => field !== undefined)
}

function isRiskReceipt(value: unknown): value is RiskReceiptDto {
  if (!isObject(value) || !isNonEmpty(value.operation_id) || !isCommand(value.command)
    || !isState(value.status) || !isNonEmpty(value.created_at) || typeof value.replayed !== 'boolean') {
    return false
  }
  // Go omitempty：缺省=未知归属；出现（或 null）则必须是十进制字符串
  const idOk = value.risk_id === undefined || value.risk_id === null || isRiskId(value.risk_id)
  const revisionOk = value.revision === undefined || value.revision === null || isRevision(value.revision)
  return idOk && revisionOk
}

/** 列表分页校验（HTTP 边界与读取端口共用；超出末页=items 空而 total>0 的合法形态） */
export function toRiskPage(value: unknown): RiskPageDto {
  if (!isObject(value) || !Array.isArray(value.items) || !value.items.every(isRiskView)
    || typeof value.total !== 'number' || !Number.isSafeInteger(value.total) || value.total < value.items.length) {
    throw new Error('风险列表数据格式异常')
  }
  return { items: value.items, total: value.total }
}

/** ProTable fetcher 形状（list/total） */
export function toRiskTablePage(value: unknown): { list: RiskViewDto[]; total: number } {
  const page = toRiskPage(value)
  return { list: page.items, total: page.total }
}

export function validateRiskDetail(value: unknown, id: RiskId): RiskDetailDto {
  // 详情 data 以 view 包裹列表行（risk_item.go RiskDetailView）；旧扁平形状视为漂移
  if (!isObject(value) || !isRiskView(value.view) || value.view.risk.id !== id) {
    throw new Error('风险详情数据格式异常')
  }
  if (typeof value.description !== 'string' || typeof value.system_ref !== 'string') {
    throw new Error('风险详情数据格式异常')
  }
  const evidence = value.evidence_refs === undefined || value.evidence_refs === null
    ? null : value.evidence_refs
  if (evidence !== null && (!Array.isArray(evidence) || !evidence.every(item => isObject(item)
    && typeof item.provider === 'string' && typeof item.external_id === 'string'))) {
    throw new Error('风险详情数据格式异常')
  }
  const attributes = value.attributes === undefined || value.attributes === null
    ? {} : value.attributes
  return {
    view: value.view, description: value.description, system_ref: value.system_ref,
    evidence_refs: evidence as RiskEvidenceRefDto[] | null, attributes,
    source_summary: value.source_summary,
  }
}

/** 按原号查回的收据校验（GET /risk-items/operations/:id） */
export function validateRiskReceipt(value: unknown): RiskReceiptDto {
  if (!isRiskReceipt(value)) throw new Error('操作回执数据格式异常')
  return value
}

/** 只读核查判据：同号且同命令才认定提交已生效（replayed 恒 true，不参与判定） */
export function riskReceiptMatches(receipt: RiskReceiptDto, operationId: string, command: RiskCommand): boolean {
  return receipt.operation_id === operationId && receipt.command === command
}

function validateMutationEnvelope(value: unknown, operationId: string, message: string):
  { risk: RiskRefDto; receipt_ref: RiskReceiptDto } {
  if (!isObject(value) || !isRiskRef(value.risk) || !isRiskReceipt(value.receipt_ref)
    || value.receipt_ref.operation_id !== operationId) {
    throw new Error(message)
  }
  return { risk: value.risk, receipt_ref: value.receipt_ref }
}

/** 人工登记回执：{risk, status:'new', receipt_ref}，回执同号绑定本次操作号 */
export function validateCreateResult(value: unknown, operationId: string): RiskCreateResult {
  const base = validateMutationEnvelope(value, operationId, '登记回执数据格式异常')
  if (!isObject(value) || !isState(value.status)) throw new Error('登记回执数据格式异常')
  return { ...base, status: value.status }
}

/** 核实回执：{risk, status, level, deadline, receipt_ref}，回执同号且命令=assess */
export function validateAssessResult(value: unknown, operationId: string): RiskAssessResult {
  const base = validateMutationEnvelope(value, operationId, '核实回执数据格式异常')
  if (!isObject(value) || !isState(value.status) || !isLevel(value.level)) {
    throw new Error('核实回执数据格式异常')
  }
  const deadline = value.deadline === undefined ? null : optional<string>(value.deadline, v => typeof v === 'string' && v.length > 0)
  if (deadline === undefined) throw new Error('核实回执数据格式异常')
  if (base.receipt_ref.command !== 'assess') throw new Error('核实回执数据格式异常')
  return { ...base, status: value.status, level: value.level, deadline: deadline ?? null }
}

/** 责任确认回执：{risk, receipt_ref}，回执同号且命令=assign */
export function validateAssignResult(value: unknown, operationId: string): RiskMutationResult {
  const base = validateMutationEnvelope(value, operationId, '责任确认回执数据格式异常')
  if (base.receipt_ref.command !== 'assign') throw new Error('责任确认回执数据格式异常')
  return base
}

type RegistrationErrors = Partial<Record<'title' | 'org_id' | 'affected_org_id' | 'owner_user_id', string>>

export interface RiskRegistrationDraft {
  title: string
  description: string
  org_id: RiskId
  affected_org_id: string
  owner_user_id: string
}

export function validateRiskRegistration(input: RiskRegistrationDraft): {
  draft: Omit<RiskCreateCommand, 'operation_id' | 'expected_revision' | 'attributes'> | null
  errors: RegistrationErrors
} {
  const title = input.title.trim()
  const org_id = input.org_id.trim()
  const affected_org_id = input.affected_org_id.trim()
  const owner_user_id = input.owner_user_id.trim()
  const errors: RegistrationErrors = {}
  if (!title) errors.title = '请填写标题'
  if (!isRiskId(org_id)) errors.org_id = '请填写有效的风险管理组织 ID'
  if (affected_org_id && !isRiskId(affected_org_id)) errors.affected_org_id = '请填写有效的受影响组织 ID'
  if (owner_user_id && !isRiskId(owner_user_id)) errors.owner_user_id = '请填写有效的责任人 ID，留空则待确认'
  const draft = Object.keys(errors).length ? null : {
    title, description: input.description, org_id,
    ...(affected_org_id && { affected_org_id }),
    ...(owner_user_id && { owner_user_id }),
  }
  return { draft, errors }
}
