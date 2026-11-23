/**
 * B2 第 8 项逐资产整改/复测跨角色浏览器夹具（独立验证批，2026-11-23）。
 *
 * 准备与运行见 docs/guides/testing.md「B2 第 6–8 项专用真实栈门禁」。
 * 会话身份、处理人、风险责任人与允许动作以本轮 Core 独立读回为准。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Response,
} from '@playwright/test'
import { b2Account, loadB2Endpoints, loginB2Browser, requiredB2Env, restrictB2Browser } from './b2-browser-env'

// ─── 合同形状（与 UI 适配层 src/api/risk/remediation.ts 的发送/校验口径一致） ───

export type Envelope<T> = { code: number; message: string; data: T; request_id?: string }
export type Role = 'P' | 'U' | 'X'
export type Account = { role: Role; employeeNo: string; password: string }

export type RemediationState = 'open' | 'pending_verify' | 'rejected' | 'pending_acceptance' | 'resolved'
export type RemediationItemResult = 'pending_confirmation' | 'applied' | 'rejected' | 'conflict'

export type RemediationItem = {
  link_id: string
  risk_id: string
  risk_revision: string
  link_revision: string
  proposal_version: string
  remediation_state: RemediationState
  title: string
  is_risk_owner?: boolean
  can_manage_risk?: boolean
}

export type RemediationContext = {
  ticket_id: string
  ticket_revision: string
  definition_version: string
  status: string
  writes_enabled?: boolean
  allowed_actions?: string[]
  items: RemediationItem[]
}

export type RemediationOutcomeItem = {
  link_id: string
  risk_id: string
  link_revision: string
  risk_revision: string
  proposal_version: string
  resolution_version: string
  result: RemediationItemResult
}

export type RemediationOutcome = {
  operation_id: string
  ticket_id: string
  ticket_revision: string
  items: RemediationOutcomeItem[]
  terminal_allowed: boolean
}

export type Attachment = { object_key: string; file_name: string; evidence_version?: string }
export type TicketRow = { id: string; status: string; assigned_to?: string; title: string }
export type RiskDetail = {
  risk: { id: string; revision: string; human_key: string }
  title: string
  status: string
  owner_user_id: string | null
}
export type RiskEvent = {
  event_kind: string
  risk_id: string
  operation_id?: string
  actor_id?: string
  aggregate_revision?: string
}
export type RiskHistory = { items: RiskEvent[]; total: number }
export type EvidenceRef = { kind: 'file'; ref: string; version: string }
export type EvidenceSource = { ref: string; fileName: string; version: string; uploaded: boolean }

/** 独立回读入口（本轮 Core，非浏览器代理） */
export const remediationPaths = {
  context: (ticketId: string) => `/api/v1/risk-items/remediation-context/${encodeURIComponent(ticketId)}`,
  finish: '/api/v1/risk-items/remediation-finish',
  review: '/api/v1/risk-items/remediation-review',
  operation: (operationId: string) => `/api/v1/risk-items/remediation-operations/${encodeURIComponent(operationId)}`,
  ticket: (ticketId: string) => `/api/v1/tickets/${encodeURIComponent(ticketId)}`,
  attachments: (ticketId: string) => `/api/v1/tickets/${encodeURIComponent(ticketId)}/attachments`,
  risk: (riskId: string) => `/api/v1/risk-items/${encodeURIComponent(riskId)}`,
  riskHistory: (riskId: string) => `/api/v1/risk-items/${encodeURIComponent(riskId)}/history`,
  profile: '/api/v1/user/profile',
} as const

const STATES: readonly string[] = ['open', 'pending_verify', 'rejected', 'pending_acceptance', 'resolved']
const RESULTS: readonly string[] = ['pending_confirmation', 'applied', 'rejected', 'conflict']
const DECIMAL_ID = /^[1-9]\d{0,18}$/
const DECIMAL_VERSION = /^(0|[1-9]\d{0,18})$/
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const MAX_INT64 = '9223372036854775807'

// ─── 环境与夹具 ───────────────────────────────────────────────────────────────

function readAccount(role: Role): Account {
  return { role, ...b2Account(`B2_REMEDIATION_${role}`) }
}

function ticketIdOf(key: string): string {
  const value = requiredB2Env(key).trim()
  if (!DECIMAL_ID.test(value) || (value.length === 19 && value > MAX_INT64)) {
    throw new Error(`${key} 必须为正 int64 十进制字符串`)
  }
  return value
}

export type RemediationFixture = {
  origin: string
  core: string
  storage?: string
  ticketId: string
  dropTicketId: string
  verifyTicketId: string
  /** 丢响应后默认关闭并重开；显式 0 保留原窗口内核查路径。 */
  accounts: Record<Role, Account>
}

export function loadRemediationFixture(): RemediationFixture {
  const { ui: origin, core, storage } = loadB2Endpoints()
  const accounts = { P: readAccount('P'), U: readAccount('U'), X: readAccount('X') }
  const employeeNos = Object.values(accounts).map(account => account.employeeNo.toUpperCase())
  if (new Set(employeeNos).size !== employeeNos.length) throw new Error('P/U/X 必须是三个不同的合成账号')
  const ticketId = ticketIdOf('B2_REMEDIATION_TICKET_ID')
  const dropTicketId = ticketIdOf('B2_REMEDIATION_DROP_TICKET_ID')
  const verifyTicketId = ticketIdOf('B2_REMEDIATION_VERIFY_TICKET_ID')
  if (new Set([ticketId, dropTicketId, verifyTicketId]).size !== 3) {
    throw new Error('主链路、丢响应与续测须使用三张互不重叠的工单')
  }
  return { origin, core, storage, ticketId, dropTicketId, verifyTicketId, accounts }
}

// ─── 形状校验（失败即候选合同漂移或环境异常，不猜测字段） ─────────────────────

function recordOf(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} 必须为对象`)
  return value as Record<string, unknown>
}

export function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function decimalOf(value: unknown, label: string): string {
  if (!isText(value) || !DECIMAL_ID.test(value) || (value.length === 19 && value > MAX_INT64)) {
    throw new Error(`${label} 必须为正 int64 十进制字符串`)
  }
  return value
}

function versionOf(value: unknown, label: string, positive = false): string {
  if (!isText(value) || !DECIMAL_VERSION.test(value) || (positive && value === '0')
    || (value.length === 19 && value > MAX_INT64)) {
    throw new Error(`${label} 必须为${positive ? '正' : '非负'}十进制版本`)
  }
  return value
}

export function assertContextItem(value: unknown, index: number): RemediationItem {
  const record = recordOf(value, `第 ${index + 1} 项资产`)
  const state = record.remediation_state
  if (!STATES.includes(state as string)) throw new Error(`第 ${index + 1} 项资产状态不在合同枚举内`)
  if (!isText(record.title)) throw new Error(`第 ${index + 1} 项资产缺少标题`)
  return {
    link_id: decimalOf(record.link_id, '资产关联 ID'),
    risk_id: decimalOf(record.risk_id, '资产风险 ID'),
    risk_revision: versionOf(record.risk_revision, '资产风险修订'),
    link_revision: versionOf(record.link_revision, '资产关联修订'),
    proposal_version: versionOf(record.proposal_version, '资产提案版本'),
    remediation_state: state as RemediationState,
    title: record.title,
    ...(typeof record.is_risk_owner === 'boolean' ? { is_risk_owner: record.is_risk_owner } : {}),
    ...(typeof record.can_manage_risk === 'boolean' ? { can_manage_risk: record.can_manage_risk } : {}),
  }
}

export function isOperationId(value: unknown): value is string {
  return isText(value) && UUID.test(value)
}

export function assertContext(value: unknown, ticketId: string): RemediationContext {
  const record = recordOf(value, '逐资产办理上下文')
  if (decimalOf(record.ticket_id, '上下文工单 ID') !== ticketId) throw new Error('上下文工单与请求不一致')
  if (record.writes_enabled !== undefined && typeof record.writes_enabled !== 'boolean') {
    throw new Error('上下文 writes_enabled 必须为布尔值')
  }
  if (record.allowed_actions !== undefined
    && (!Array.isArray(record.allowed_actions) || !record.allowed_actions.every(isText))) {
    throw new Error('上下文 allowed_actions 必须为字符串数组')
  }
  if (!Array.isArray(record.items)) throw new Error('上下文 items 必须为数组')
  const items = record.items.map((entry, index) => assertContextItem(entry, index))
  if (new Set(items.map(item => item.link_id)).size !== items.length) throw new Error('上下文资产关联 ID 重复')
  if (!isText(record.status)) throw new Error('上下文缺少工单状态')
  return {
    ticket_id: ticketId,
    ticket_revision: versionOf(record.ticket_revision, '上下文票修订'),
    definition_version: versionOf(record.definition_version, '上下文定义版本'),
    status: record.status,
    ...(typeof record.writes_enabled === 'boolean' ? { writes_enabled: record.writes_enabled } : {}),
    ...(Array.isArray(record.allowed_actions) ? { allowed_actions: record.allowed_actions as string[] } : {}),
    items,
  }
}

export function assertOutcomeItem(value: unknown, index: number): RemediationOutcomeItem {
  const record = recordOf(value, `第 ${index + 1} 项回执`)
  const result = record.result
  if (!RESULTS.includes(result as string)) throw new Error(`第 ${index + 1} 项回执结果不在合同枚举内`)
  return {
    link_id: decimalOf(record.link_id, '回执资产关联 ID'),
    risk_id: decimalOf(record.risk_id, '回执风险 ID'),
    link_revision: versionOf(record.link_revision, '回执关联修订'),
    risk_revision: versionOf(record.risk_revision, '回执风险修订'),
    proposal_version: versionOf(record.proposal_version, '回执提案版本'),
    resolution_version: versionOf(record.resolution_version, '回执处置版本'),
    result: result as RemediationItemResult,
  }
}

export function assertOutcome(value: unknown, operationId: string): RemediationOutcome {
  const record = recordOf(value, '整改回执')
  if (record.operation_id !== operationId) throw new Error('回执原操作号与请求不一致')
  if (typeof record.terminal_allowed !== 'boolean') throw new Error('回执 terminal_allowed 必须为布尔值')
  if (!Array.isArray(record.items)) throw new Error('回执 items 必须为数组')
  const items = record.items.map((entry, index) => assertOutcomeItem(entry, index))
  if (new Set(items.map(item => item.link_id)).size !== items.length) throw new Error('回执资产关联 ID 重复')
  return {
    operation_id: operationId,
    ticket_id: decimalOf(record.ticket_id, '回执工单 ID'),
    ticket_revision: versionOf(record.ticket_revision, '回执票修订'),
    items,
    terminal_allowed: record.terminal_allowed,
  }
}

export function assertAttachmentList(value: unknown): Attachment[] {
  if (!Array.isArray(value)) throw new Error('附件列表必须为数组')
  return value.map((entry, index) => {
    const record = recordOf(entry, `第 ${index + 1} 个附件`)
    if (!isText(record.object_key) || !isText(record.file_name)) throw new Error('附件缺少对象键或文件名')
    if (record.evidence_version !== undefined && record.evidence_version !== null
      && typeof record.evidence_version !== 'string') throw new Error('附件证据版本形状不符')
    return {
      object_key: record.object_key,
      file_name: record.file_name,
      ...(isText(record.evidence_version) ? { evidence_version: record.evidence_version } : {}),
    }
  })
}

export function assertTicket(value: unknown, ticketId: string): TicketRow {
  const record = recordOf(value, '工单详情')
  if (decimalOf(record.id, '工单 ID') !== ticketId) throw new Error('工单详情与请求不一致')
  if (!isText(record.status)) throw new Error('工单详情缺少状态')
  return {
    id: ticketId,
    status: record.status,
    title: isText(record.title) ? record.title : '',
    ...(isText(record.assigned_to) ? { assigned_to: record.assigned_to } : {}),
  }
}

export function assertRiskDetail(value: unknown, riskId: string): RiskDetail {
  const record = recordOf(value, '风险详情')
  const view = recordOf(record.view, '风险详情 view')
  const risk = recordOf(view.risk, '风险详情 risk')
  if (decimalOf(risk.id, '风险详情 ID') !== riskId) throw new Error('风险详情与请求不一致')
  return {
    risk: {
      id: riskId,
      revision: versionOf(risk.revision, '风险详情修订'),
      human_key: isText(risk.human_key) ? risk.human_key : '',
    },
    title: isText(view.title) ? view.title : '',
    status: isText(view.status) ? view.status : '',
    owner_user_id: isText(view.owner_user_id) ? view.owner_user_id : null,
  }
}

export function assertRiskHistory(value: unknown, riskId: string): RiskHistory {
  const record = recordOf(value, '风险历史')
  if (!Array.isArray(record.items)) throw new Error('风险历史 items 必须为数组')
  if (typeof record.total !== 'number' || !Number.isSafeInteger(record.total) || record.total < 0) {
    throw new Error('风险历史缺少有效 total')
  }
  // 只强制本用例依赖的字段；系统事件可缺原操作号，但不得干扰按原号定位本次写入。
  const items = record.items.map((entry, index) => {
    const event = recordOf(entry, `第 ${index + 1} 条风险历史`)
    if (event.risk_id !== undefined && event.risk_id !== riskId) throw new Error('风险历史含其他风险事件')
    if (!isText(event.event_kind)) throw new Error('风险历史事件缺少事件类型')
    if (event.actor_id !== undefined && !isText(event.actor_id)) throw new Error('风险历史操作者形状不符')
    if (event.operation_id !== undefined && !isText(event.operation_id)) throw new Error('风险历史操作号形状不符')
    return {
      event_kind: event.event_kind,
      risk_id: riskId,
      ...(isText(event.operation_id) ? { operation_id: event.operation_id } : {}),
      ...(isText(event.actor_id) ? { actor_id: event.actor_id } : {}),
      ...(event.aggregate_revision === undefined ? {} : {
        aggregate_revision: versionOf(event.aggregate_revision, '风险历史聚合修订'),
      }),
    }
  })
  if (items.length > record.total) throw new Error('风险历史返回条目数大于 total')
  return { items, total: record.total }
}

// ─── 独立 Core 回读 ───────────────────────────────────────────────────────────

export type HttpResult = { status: number; envelope: Envelope<unknown> | null }
export type CoreClient = (path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }) => Promise<HttpResult>

export function coreClient(core: string, token: string): CoreClient {
  const once = async (path: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<HttpResult> => {
    const url = new URL(path, core)
    if (url.origin !== core) throw new Error('独立回读只允许本轮 Core 回环 origin')
    const response = await fetch(url, {
      method: init?.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    const envelope = await response.json().catch(() => null) as Envelope<unknown> | null
    return { status: response.status, envelope }
  }
  // 每用户 20rps/burst 40 桶：浏览器与独立读回共用。仅 429 退避一次（桶 1s 回填），
  // 其他状态原样透出，不掩盖拒绝、冲突或契约漂移。
  return async (path, init) => {
    const first = await once(path, init)
    if (first.status !== 429) return first
    await new Promise(resolve => setTimeout(resolve, 1_100))
    return once(path, init)
  }
}

export async function coreRead<T>(
  client: CoreClient,
  path: string,
  label: string,
  validate: (value: unknown) => T,
): Promise<T> {
  const result = await client(path)
  if (result.status !== 200) throw new Error(`${label} 读取失败：HTTP ${result.status}`)
  if (!result.envelope || result.envelope.code !== 0) {
    throw new Error(`${label} 读取失败：业务码 ${result.envelope?.code ?? 'missing'}`)
  }
  return validate(result.envelope.data)
}

export function readContext(client: CoreClient, ticketId: string): Promise<RemediationContext> {
  return coreRead(client, remediationPaths.context(ticketId), `工单 ${ticketId} 逐资产办理上下文`,
    value => assertContext(value, ticketId))
}

export function readOutcome(client: CoreClient, ticketId: string, operationId: string): Promise<RemediationOutcome> {
  return coreRead(client, remediationPaths.operation(operationId), `原操作号 ${operationId} 回执`, value => {
    const outcome = assertOutcome(value, operationId)
    if (outcome.ticket_id !== ticketId) throw new Error('回执工单与本轮工单不一致')
    return outcome
  })
}

export function readAttachments(client: CoreClient, ticketId: string): Promise<Attachment[]> {
  return coreRead(client, remediationPaths.attachments(ticketId), `工单 ${ticketId} 附件列表`, assertAttachmentList)
}

export type WorkItem = { item: RemediationItem; risk: RiskDetail; history: RiskHistory }
export type Workflow = {
  context: RemediationContext
  ticket: TicketRow
  attachments: Attachment[]
  /** 以 link_id 索引：同一资产的上下文、风险详情与历史成组对照 */
  assets: Record<string, WorkItem>
}

/** 一次独立读回：上下文 + 工单 + 附件 + 逐资产风险详情/历史。 */
export async function readWorkflow(client: CoreClient, ticketId: string): Promise<Workflow> {
  const [context, ticket, attachments] = await Promise.all([
    readContext(client, ticketId),
    coreRead(client, remediationPaths.ticket(ticketId), `工单 ${ticketId} 详情`, value => assertTicket(value, ticketId)),
    readAttachments(client, ticketId),
  ])
  const assets: Record<string, WorkItem> = {}
  for (const item of context.items) {
    const [risk, history] = await Promise.all([
      coreRead(client, remediationPaths.risk(item.risk_id), `风险 ${item.risk_id} 详情`,
        value => assertRiskDetail(value, item.risk_id)),
      coreRead(client, remediationPaths.riskHistory(item.risk_id), `风险 ${item.risk_id} 历史`,
        value => assertRiskHistory(value, item.risk_id)),
    ])
    assets[item.link_id] = { item, risk, history }
  }
  return { context, ticket, attachments, assets }
}

/** 无写入场景的对照口径：上下文版本/状态、逐资产事实、附件事实、工单处理面。
 *  资产与附件按标识排序后再比较，避免同一批事实因返回顺序抖动造成假差异。 */
export function workflowFacts(workflow: Workflow) {
  return {
    context: {
      ...workflow.context,
      items: [...workflow.context.items].sort((left, right) => compareDecimal(left.link_id, right.link_id)),
    },
    ticket: { status: workflow.ticket.status, assigned_to: workflow.ticket.assigned_to ?? null },
    attachments: [...workflow.attachments].sort((left, right) => left.object_key.localeCompare(right.object_key)),
    assets: workflow.assets,
  }
}

function compareDecimal(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length
  return left < right ? -1 : left > right ? 1 : 0
}

export function assetFacts(workflow: Workflow, linkId: string): WorkItem {
  const work = workflow.assets[linkId]
  if (!work) throw new Error(`读回缺少资产关联 ${linkId}`)
  return work
}

export function itemByLink(context: RemediationContext, linkId: string): RemediationItem {
  const item = context.items.find(entry => entry.link_id === linkId)
  if (!item) throw new Error(`上下文缺少资产关联 ${linkId}`)
  return item
}

export function resultMap(outcome: RemediationOutcome): Record<string, RemediationItemResult> {
  return Object.fromEntries(outcome.items.map(item => [item.link_id, item.result]))
}

export function expectResultMap(outcome: RemediationOutcome, expected: Record<string, RemediationItemResult>): void {
  assert.deepEqual(resultMap(outcome), expected)
}

/** 只要求单调不回退：版本推进的严格性由“下一命令被服务端按新修订接受”与历史事件共同证明。 */
function notOlder(next: string, previous: string, label: string): void {
  assert.ok(BigInt(next) >= BigInt(previous), `${label} 不得回退：${previous} → ${next}`)
}

/** 提交后逐项核对：状态、回执与现势一致、版本不回退、历史恰好新增一条本操作/本人事件。 */
export function expectCommitted(options: {
  label: string
  actor: string
  operationId: string
  before: Workflow
  after: Workflow
  outcome: RemediationOutcome
  expectedStates: Record<string, RemediationState>
}): void {
  const { label, actor, operationId, before, after, outcome, expectedStates } = options
  assert.deepEqual(Object.fromEntries(after.context.items.map(item => [item.link_id, item.remediation_state])),
    expectedStates, `${label}：逐资产状态`)
  assert.equal(after.context.ticket_revision, outcome.ticket_revision, `${label}：回执票修订与现势一致`)
  notOlder(after.context.ticket_revision, before.context.ticket_revision, `${label}：票修订`)
  for (const outcomeItem of outcome.items) {
    const linkId = outcomeItem.link_id
    const afterItem = itemByLink(after.context, linkId)
    assert.equal(afterItem.risk_revision, outcomeItem.risk_revision, `${label}：${linkId} 回执风险修订与现势一致`)
    assert.equal(afterItem.link_revision, outcomeItem.link_revision, `${label}：${linkId} 回执关联修订与现势一致`)
    assert.equal(afterItem.proposal_version, outcomeItem.proposal_version, `${label}：${linkId} 回执提案版本与现势一致`)
    assert.equal(after.assets[linkId]?.risk.risk.revision, afterItem.risk_revision,
      `${label}：${linkId} 风险详情修订与上下文一致`)
    const work = assetFacts(after, linkId)
    const previous = assetFacts(before, linkId)
    notOlder(work.item.risk_revision, previous.item.risk_revision, `${label}：${linkId} 风险修订`)
    notOlder(work.item.link_revision, previous.item.link_revision, `${label}：${linkId} 关联修订`)
    // 风险聚合推进一条 => 恰好一条本操作事件；未推进 => 不得出现本操作事件。
    // 这样对“复测可能只写关联/提案”的实现同样成立，且任何重复写入都会暴露。
    const advanced = BigInt(work.item.risk_revision) > BigInt(previous.item.risk_revision)
    assert.equal(work.history.total, previous.history.total + (advanced ? 1 : 0),
      `${label}：${linkId} 风险历史增量与风险修订推进一致`)
    const events = work.history.items.filter(event => event.operation_id === operationId)
    assert.equal(events.length, advanced ? 1 : 0, `${label}：${linkId} 本操作风险事件计数`)
    if (advanced) {
      assert.equal(events[0]?.actor_id, actor, `${label}：${linkId} 风险历史操作者`)
      assert.equal(events[0]?.risk_id, work.item.risk_id, `${label}：${linkId} 风险历史对象`)
      assert.equal((events[0]?.event_kind ?? '').trim().length > 0, true, `${label}：${linkId} 风险事件类型`)
    }
  }
}

// ─── 浏览器会话（每角色独立 context，限本轮 UI 和可选存储） ──────────────────

export type Session = {
  role: Role
  account: Account
  context: BrowserContext
  page: Page
  token: string
  userId: string
  client: CoreClient
  storage?: string
}
export type RoleSessions = Record<Role, Session>

type Profile = { id: string; employee_no: string; must_change_password?: boolean }

function assertProfile(value: unknown): Profile {
  const record = recordOf(value, '会话身份')
  if (!isText(record.employee_no)) throw new Error('会话身份缺少工号')
  return {
    id: decimalOf(record.id, '会话用户 ID'),
    employee_no: record.employee_no,
    ...(typeof record.must_change_password === 'boolean' ? { must_change_password: record.must_change_password } : {}),
  }
}

async function signIn(browser: Browser, fixture: RemediationFixture, account: Account): Promise<Session> {
  const { origin, core, storage } = fixture
  const context = await browser.newContext({
    baseURL: origin,
    serviceWorkers: 'block',
    storageState: { cookies: [], origins: [] },
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  })
  await restrictB2Browser(context, storage ? [origin, storage] : [origin])
  const page = await context.newPage()
  const [login] = await Promise.all([
    page.waitForResponse(response => response.request().method() === 'POST'
      && response.url() === `${origin}/api/v1/auth/login`, { timeout: 30_000 }),
    loginB2Browser(page, account),
  ])
  await page.waitForURL(/#\/home(?:[/?]|$)/)
  assert.equal(login.fromServiceWorker(), false, `${account.role} 登录响应不能来自 Service Worker`)
  const envelope = await login.json() as Envelope<{ access_token?: string; must_change_password?: boolean }>
  assert.equal(envelope.code, 0, `${account.role} 登录业务码`)
  const token = envelope.data?.access_token
  if (!isText(token)) throw new Error(`${account.role} 登录未取得访问令牌`)
  assert.equal(envelope.data.must_change_password, false, `${account.role} 须为可直接登录的合成账号`)
  const client = coreClient(core, token)
  const profile = await coreRead(client, remediationPaths.profile, `${account.role} 会话身份`, assertProfile)
  assert.ok(profile.employee_no.toUpperCase() === account.employeeNo.toUpperCase(),
    `${account.role} 浏览器会话回读工号与夹具不符`)
  assert.equal(profile.must_change_password ?? false, false, `${account.role} 会话仍要求改密`)
  return { role: account.role, account, context, page, token, userId: profile.id, client, storage }
}

/** 按 P/U/X 顺序建立独立浏览器会话，每个会话先回读身份，再由调用方开始业务操作。 */
export async function withRemediationSessions<T>(
  browser: Browser,
  fixture: RemediationFixture,
  run: (sessions: RoleSessions) => Promise<T>,
): Promise<T> {
  const contexts: BrowserContext[] = []
  const sessions: Partial<RoleSessions> = {}
  try {
    for (const role of ['P', 'U', 'X'] as const) {
      const session = await signIn(browser, fixture, fixture.accounts[role])
      contexts.push(session.context)
      sessions[role] = session
    }
    return await run(sessions as RoleSessions)
  } finally {
    await Promise.all(contexts.map(context => context.close()))
  }
}

// ─── 浏览器证据读取 ───────────────────────────────────────────────────────────

async function browserEnvelope(response: Response, label: string): Promise<{
  request: Request
  envelope: Envelope<unknown>
}> {
  assert.equal(response.fromServiceWorker(), false, `${label} 响应不能来自 Service Worker`)
  const address = await response.serverAddr()
  assert.ok(address?.ipAddress && address.port > 0, `${label} 缺少真实服务端地址`)
  const envelope = await response.json().catch(() => null) as Envelope<unknown> | null
  assert.equal(response.status(), 200, `${label} HTTP 状态（${envelope?.code ?? '无业务码'} ${envelope?.message ?? ''}）`)
  if (!envelope) throw new Error(`${label} 响应不是统一信封`)
  assert.equal(envelope.code, 0, `${label} 业务码`)
  return { request: response.request(), envelope }
}

export async function browserMutation(response: Response, ticketId: string, label: string): Promise<{
  request: Request
  body: Record<string, unknown>
  outcome: RemediationOutcome
}> {
  const { request, envelope } = await browserEnvelope(response, label)
  const body = request.postDataJSON() as Record<string, unknown>
  const operationId = body.operation_id
  assert.ok(isText(operationId) && UUID.test(operationId), `${label} 原操作号必须为 canonical UUID`)
  const outcome = assertOutcome(envelope.data, operationId)
  assert.equal(outcome.ticket_id, ticketId, `${label} 回执工单与当前工单不一致`)
  return { request, body, outcome }
}

async function settleContextResponse(
  page: Page,
  ticketId: string,
  navigate: () => Promise<unknown>,
): Promise<RemediationContext> {
  const path = remediationPaths.context(ticketId)
  const pending = page.waitForResponse(response => response.request().method() === 'GET'
    && new URL(response.url()).pathname === path, { timeout: 30_000 }).catch(() => null)
  await navigate()
  const response = await pending
  if (!response) {
    const body = await page.locator('body').innerText().catch(() => '')
    throw new Error(`页面未取得逐资产办理上下文（入口或读权不满足）；页面片段：${body.slice(0, 300)}`)
  }
  assert.equal(response.fromServiceWorker(), false, '浏览器整改上下文不能来自 Service Worker')
  assert.equal(response.status(), 200, '浏览器整改上下文 HTTP 状态')
  const envelope = await response.json() as Envelope<unknown>
  assert.equal(envelope.code, 0, '浏览器整改上下文业务码')
  await expect(page.getByTestId('open-risk-remediation')).toBeVisible()
  return assertContext(envelope.data, ticketId)
}

export function openWorkflowPage(session: Session, ticketId: string): Promise<RemediationContext> {
  return settleContextResponse(session.page, ticketId,
    () => session.page.goto(`/#/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' }))
}

/** 换角色复核或同页再入：hash 同址 goto 不会重载，必须显式 reload 取现势上下文。 */
export function reloadWorkflowPage(session: Session, ticketId: string): Promise<RemediationContext> {
  return settleContextResponse(session.page, ticketId,
    () => session.page.reload({ waitUntil: 'domcontentloaded' }))
}

export async function openRemediationDialog(page: Page, itemCount: number): Promise<Locator> {
  await page.getByTestId('open-risk-remediation').click()
  const dialog = page.getByRole('dialog', { name: '逐资产整改与复测' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('status')).toContainText(`共 ${itemCount} 项关联资产`)
  return dialog
}

export async function closeRemediationDialog(dialog: Locator): Promise<void> {
  await dialog.locator('.el-dialog__footer').getByRole('button', { name: /^关闭/ }).click()
  await expect(dialog).toBeHidden()
}

// ─── 弹窗内定位与操作 ─────────────────────────────────────────────────────────

export function itemRow(dialog: Locator, linkId: string): Locator {
  return dialog.getByTestId('remediation-items').locator('li')
    .filter({ hasText: new RegExp(`关联 ${linkId}(?!\\d)`) })
}

export function finishDraft(dialog: Locator, linkId: string): Locator {
  return dialog.getByTestId('remediation-drafts').locator('li').filter({ hasText: `（关联 ${linkId}）` })
}

export function reviewDraft(dialog: Locator, linkId: string): Locator {
  return dialog.getByTestId('remediation-review-drafts').locator('li').filter({ hasText: `（关联 ${linkId}）` })
}

export async function expectAssetToggleable(row: Locator, expected: boolean): Promise<void> {
  const checkbox = row.locator('input.el-checkbox__original')
  if (expected) await expect(checkbox).toBeEnabled()
  else await expect(checkbox).toBeDisabled()
}

export async function selectAssetByClick(row: Locator): Promise<void> {
  await row.locator('.el-checkbox__inner').click()
  await expect(row.locator('label.el-checkbox.is-checked')).toHaveCount(1)
}

async function focusByTab(page: Page, target: Locator, label: string, maxSteps = 90): Promise<void> {
  for (let step = 0; step < maxSteps; step++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate(element => element === document.activeElement)) return
  }
  throw new Error(`键盘 Tab 未能在 ${maxSteps} 步内到达${label}`)
}

/** 键盘路径：从弹窗状态区起 Tab 到资产复选框，Space 选中后 Tab 到措施与证据并键入。 */
export async function finishFirstAssetByKeyboard(options: {
  page: Page
  dialog: Locator
  linkId: string
  measures: string
  fileName: string
}): Promise<void> {
  const { page, dialog, linkId, measures, fileName } = options
  const row = itemRow(dialog, linkId)
  await expect(row).toHaveCount(1)
  await dialog.getByRole('status').focus()
  await focusByTab(page, row.locator('input.el-checkbox__original'), `资产 ${linkId} 复选框`)
  await page.keyboard.press('Space')
  await expect(row.locator('label.el-checkbox.is-checked')).toHaveCount(1)
  const draft = finishDraft(dialog, linkId)
  await expect(draft).toHaveCount(1)
  const textarea = draft.locator(`textarea[name="measures-${linkId}"]`)
  await focusByTab(page, textarea, `资产 ${linkId} 整改措施`)
  // Deliver the mixed Chinese/ASCII text in one input event, as with IME commit.
  await page.keyboard.insertText(measures)
  await expect(textarea).toHaveValue(measures)
  const evidence = draft.locator('label.el-checkbox').filter({ hasText: fileName })
  await expect(evidence).toHaveCount(1)
  await focusByTab(page, evidence.locator('input.el-checkbox__original'), `资产 ${linkId} 证据复选框`)
  await page.keyboard.press('Space')
  await expect(evidence).toHaveClass(/is-checked/)
}

export async function fillFinishDraft(dialog: Locator, linkId: string, measures: string, fileName: string): Promise<void> {
  const draft = finishDraft(dialog, linkId)
  await expect(draft).toHaveCount(1)
  await draft.locator(`textarea[name="measures-${linkId}"]`).fill(measures)
  const evidence = draft.locator('label.el-checkbox').filter({ hasText: fileName })
  await expect(evidence).toHaveCount(1)
  await evidence.click()
  await expect(evidence).toHaveClass(/is-checked/)
}

export async function fillReviewDraft(dialog: Locator, linkId: string, decision: 'approve' | 'reject', note: string): Promise<void> {
  const draft = reviewDraft(dialog, linkId)
  await expect(draft).toHaveCount(1)
  const radio = draft.locator('label.el-radio').filter({ hasText: decision === 'approve' ? '通过（A）' : '打回（B）' })
  await expect(radio).toHaveCount(1)
  await radio.click()
  await expect(radio).toHaveClass(/is-checked/)
  await draft.locator(`textarea[name="note-${linkId}"]`).fill(note)
}

/** 键盘选择复测决定：聚焦对应单选输入后 Space，再核对选中态。 */
export async function chooseDecisionByKeyboard(dialog: Locator, linkId: string, decision: 'approve' | 'reject'): Promise<void> {
  const draft = reviewDraft(dialog, linkId)
  const radio = draft.locator('label.el-radio').filter({ hasText: decision === 'approve' ? '通过（A）' : '打回（B）' })
  await expect(radio).toHaveCount(1)
  await radio.locator('input.el-radio__original').focus()
  await expect(radio.locator('input.el-radio__original')).toBeFocused()
  await radio.page().keyboard.press('Space')
  await expect(radio).toHaveClass(/is-checked/)
}

export async function expectOutcomeRows(dialog: Locator, expected: Record<string, string>): Promise<void> {
  const list = dialog.getByTestId('remediation-outcome')
  await expect(list).toBeVisible()
  await expect(list.getByRole('listitem')).toHaveCount(Object.keys(expected).length)
  for (const [linkId, text] of Object.entries(expected)) {
    await expect(list.getByRole('listitem').filter({ hasText: `关联 ${linkId}（` }).first()).toContainText(text)
  }
}

export async function expectDialogOperation(dialog: Locator, operationId: string): Promise<void> {
  await expect(dialog.getByRole('status')).toContainText(operationId)
}

// ─── 请求观察 ─────────────────────────────────────────────────────────────────

/** 只观察本轮整改写入口：排除附件直传/确认等其他业务写，避免计数串台。 */
export function observeRemediationWrites(page: Page): Request[] {
  const writes: Request[] = []
  page.on('request', request => {
    const { pathname } = new URL(request.url())
    if ((pathname === remediationPaths.finish || pathname === remediationPaths.review)
      && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request)
  })
  return writes
}

/** 业务写观察（风险/工单域）：只用于确认无关成员页面零写入。 */
export function observeBusinessWrites(page: Page): Request[] {
  const writes: Request[] = []
  page.on('request', request => {
    const { pathname } = new URL(request.url())
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return
    if (pathname.startsWith('/api/v1/risk-items') || pathname === '/api/v1/tickets'
      || pathname.startsWith('/api/v1/tickets/')) writes.push(request)
  })
  return writes
}

export async function clickInspect(page: Page, dialog: Locator, ticketId: string, operationId: string): Promise<{
  reads: Request[]
  outcome: RemediationOutcome
  context: RemediationContext
  ticket: TicketRow
}> {
  const path = remediationPaths.operation(operationId)
  const reads: Request[] = []
  const record = (request: Request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === path) reads.push(request)
  }
  page.on('request', record)
  try {
    const [response, ticketResponse, contextResponse] = await Promise.all([
      page.waitForResponse(candidate => candidate.request().method() === 'GET'
        && new URL(candidate.url()).pathname === path, { timeout: 20_000 }),
      page.waitForResponse(candidate => candidate.request().method() === 'GET'
        && new URL(candidate.url()).pathname === remediationPaths.ticket(ticketId), { timeout: 20_000 }),
      page.waitForResponse(candidate => candidate.request().method() === 'GET'
        && new URL(candidate.url()).pathname === remediationPaths.context(ticketId), { timeout: 20_000 }),
      dialog.getByTestId('remediation-inspect').click(),
    ])
    const { request, envelope } = await browserEnvelope(response, '按原号只读核查')
    assert.equal(request.postData(), null, '只读核查必须是 GET 且不带请求体')
    const outcome = assertOutcome(envelope.data, operationId)
    assert.equal(outcome.ticket_id, ticketId, '只读核查回执工单与当前工单不一致')
    const refreshedTicket = await browserEnvelope(ticketResponse, '只读核查后刷新父页工单')
    const refreshedContext = await browserEnvelope(contextResponse, '只读核查后刷新父页办理上下文')
    const ticket = assertTicket(refreshedTicket.envelope.data, ticketId)
    const context = assertContext(refreshedContext.envelope.data, ticketId)
    assert.equal(ticket.status, context.status, '只读核查后父页工单与办理上下文状态一致')
    return { reads, outcome, context, ticket }
  } finally {
    page.off('request', record)
  }
}

// ─── 附件证据源（现有带版本附件优先；没有则在浏览器上传真实文件） ─────────────

export async function ensureEvidenceSource(session: Session, ticketId: string): Promise<EvidenceSource> {
  const existing = await readAttachments(session.client, ticketId)
  const usable = existing.find(row => isText(row.evidence_version))
  if (usable) {
    const source: EvidenceSource = {
      ref: usable.object_key, fileName: usable.file_name, version: usable.evidence_version as string, uploaded: false,
    }
    await expect(session.page.locator('.ticket-attachments')).toContainText(source.fileName)
    return source
  }
  if (!session.storage) throw new Error('工单缺少可用的版本化附件，浏览器上传须显式提供 B2_RISK_STORAGE_ORIGIN')
  const card = session.page.locator('.ticket-attachments')
  await expect(card).toBeVisible()
  const input = card.locator('input[type=file]')
  if (await input.count() !== 1) {
    throw new Error('附件上传入口不可用：P 角色缺少附件写权限或详情页未就绪（夹具需提供现有带版本附件）')
  }
  const fileName = `b2-remediation-${randomUUID().slice(0, 12)}.txt`
  const [presign] = await Promise.all([
    session.page.waitForResponse(response => response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/v1/storage/presign/upload', { timeout: 20_000 }),
    input.setInputFiles({
      name: fileName,
      mimeType: 'text/plain',
      buffer: Buffer.from(`B2 第8项合成整改证据 ${fileName}\n`, 'utf8'),
    }),
  ])
  const presignEnvelope = await presign.json().catch(() => null) as Envelope<unknown> | null
  if (presign.status() !== 200 || presignEnvelope?.code !== 0) {
    const text = await card.innerText().catch(() => '')
    throw new Error(`附件预签名失败：HTTP ${presign.status()} 业务码 ${presignEnvelope?.code ?? 'non-json'}；页面片段：${text.slice(0, 200)}`)
  }
  let created: Attachment | undefined
  for (let attempt = 0; attempt < 30 && !created; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500))
    created = (await readAttachments(session.client, ticketId)).find(row => row.file_name === fileName)
  }
  if (!created) {
    const text = await card.innerText().catch(() => '')
    throw new Error(`附件上传未形成可用证据（直传/确认未完成）；页面片段：${text.slice(0, 200)}`)
  }
  if (!isText(created.evidence_version)) throw new Error('上传附件缺少服务端证据版本，不能作为整改证据')
  await expect(card).toContainText(fileName)
  return { ref: created.object_key, fileName: created.file_name, version: created.evidence_version, uploaded: true }
}

// ─── 无关成员拒绝探针（HTTP，同轮 Core；不改用浏览器按钮） ────────────────────

export function denialFinishBody(context: RemediationContext, operationId: string, evidence: EvidenceSource) {
  return {
    operation_id: operationId,
    ticket_id: context.ticket_id,
    expected_ticket_revision: context.ticket_revision,
    definition_version: context.definition_version,
    items: context.items.map(item => ({
      link_id: item.link_id,
      expected_link_revision: item.link_revision,
      expected_risk_revision: item.risk_revision,
      resolution: 'fixed',
      measures: '无关成员权限核对，不应落库',
      evidence: [{ kind: 'file', ref: evidence.ref, version: evidence.version }],
    })),
  }
}

export function denialReviewBody(context: RemediationContext, operationId: string) {
  const items = context.items.filter(item => item.remediation_state === 'pending_verify')
  return {
    operation_id: operationId,
    ticket_id: context.ticket_id,
    expected_ticket_revision: context.ticket_revision,
    definition_version: context.definition_version,
    items: items.map(item => ({
      link_id: item.link_id,
      expected_link_revision: item.link_revision,
      expected_risk_revision: item.risk_revision,
      expected_proposal_version: item.proposal_version,
      decision: 'approve',
      note: '无关成员复测权限核对，不应落库',
      evidence: [],
    })),
  }
}

/** 拒绝探针的无状态口径：403 + 业务码非零 + 双方均查不到回执 + 现势读回不变。 */
export async function expectDeniedWrite(options: {
  label: string
  path: string
  body: Record<string, unknown>
  actor: Session
  reader: Session
  before: Workflow
  ticketId: string
}): Promise<void> {
  const { label, path, body, actor, reader, before, ticketId } = options
  const operationId = body.operation_id as string
  assert.ok(isText(operationId) && UUID.test(operationId), `${label} 探针需要独立原操作号`)
  const denied = await actor.client(path, { method: 'POST', body })
  assert.equal(denied.status, 403, `${label} 必须被服务端拒绝`)
  assert.ok((denied.envelope?.code ?? 0) > 0, `${label} 拒绝业务码必须非零`)
  const ownReceipt = await actor.client(remediationPaths.operation(operationId))
  assert.notEqual(ownReceipt.status, 200, `${label} 拒绝后不得留下可读回执`)
  const otherReceipt = await reader.client(remediationPaths.operation(operationId))
  assert.notEqual(otherReceipt.status, 200, `${label} 拒绝后他人也不得读到回执`)
  assert.deepEqual(workflowFacts(await readWorkflow(reader.client, ticketId)), workflowFacts(before),
    `${label} 被拒绝后现势状态必须保持不变`)
}
