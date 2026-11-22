import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// 本仓 "type": "module"（ESM）——无 __dirname，用 import.meta 定位
const here = fileURLToPath(new URL('.', import.meta.url))

/** 后端 API 基址（宿主进程 make dev） */
export const API_BASE = process.env.E2E_API_BASE ?? 'http://127.0.0.1:33333'

/** globalSetup 产物：凭据与账号（幂等闭环后的终态） */
export interface E2EState {
  admin: { employeeNo: string; password: string }
  operator: { employeeNo: string; password: string }
  viewer: { employeeNo: string; password: string }
  /** S1 强制改密账号：password=被重置后的当前密码（must_change=true），newPassword=改密目标 */
  s1: { employeeNo: string; password: string; newPassword: string }
}

export const STATE_FILE = resolve(here, '.state.json')

export function loadState(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf-8')) as E2EState
}

/** 统一信封（zhuzhao-utils/response）：{code, message, data, request_id}，code≠0 恒非 2xx */
export interface Envelope<T = unknown> {
  code: number
  message: string
  data: T
  request_id?: string
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  expires_in: number
  must_change_password: boolean
}

interface ApiOptions {
  token?: string
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

/** 标准栈同一user_id共享20rps/40burst桶；夹具与浏览器、不同device/token也共用。
 * 仅在密集夹具完成或API分派后强制reload前，预留完整补桶窗40/20s+100ms。
 * 不是失败后重试；不改变真实限流，改测试栈规则时须同批核此预算。 */
export async function waitUserRateBudget(): Promise<void> {
  await new Promise((done) => setTimeout(done, 2100))
}

/** 裸 API 调用（Node fetch；信封与 HTTP 状态原样透出，由调用方分流）。
 *  仅 429 退避重试一次：串行 spec 密集预置（登录+profile+orgs+建单+分派…）会打穿每用户 20rps/burst 40 桶
 *  （p5 五 spec 连跑实证 http=429 code=10007）；桶 1s 回填，退避 1.1s 足够；其他状态码原样透出不掩盖缺陷。 */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<{ status: number; env: Envelope<T> | null }> {
  const once = async () => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    const env = (await res.json().catch(() => null)) as Envelope<T> | null
    return { status: res.status, env }
  }
  const first = await once()
  if (first.status !== 429) return first
  await new Promise((r) => setTimeout(r, 1100))
  return once()
}

export async function apiLogin(employeeNo: string, password: string, deviceId: string): Promise<{ status: number; env: Envelope<TokenPair> | null }> {
  return api<TokenPair>('/api/v1/auth/login', {
    method: 'POST',
    body: { employee_no: employeeNo, password, device_id: deviceId },
  })
}

/** 信封 code=0 断言并取 data——失败抛出含 http 状态/信封 code/message 的错误
 *  （防 `.env!.data[0]` 式解构在瞬态非零信封时只剩 TypeError，吞掉真实原因） */
export async function mustData<T>(call: Promise<{ status: number; env: Envelope<T> | null }>, label: string): Promise<T> {
  const r = await call
  if (r.env?.code !== 0) {
    throw new Error(`${label} 失败：http=${r.status} code=${r.env?.code ?? 'non-json'} message=${r.env?.message ?? ''}`)
  }
  return r.env.data
}

interface TicketTypeDraft {
  id: string
  code: string
  version: number
  current_published_version: string | null
}

export interface TicketDefinitionRef {
  type_code: string
  definition_version: string
  definition_hash: string
}

async function findTicketTypeDraft(token: string, code: string): Promise<TicketTypeDraft | undefined> {
  const { types } = await mustData(api<{ types: TicketTypeDraft[] }>('/api/v1/ticket-types', { token }), '读取工单类型草稿')
  const draft = types.find(row => row.code === code)
  if (draft && (typeof draft.id !== 'string' || !/^[1-9]\d*$/.test(draft.id) || !Number.isSafeInteger(draft.version) || draft.version < 1
    || (draft.current_published_version !== null && (typeof draft.current_published_version !== 'string'
    || !/^[1-9]\d*$/.test(draft.current_published_version))))) {
    throw new Error(`工单类型 ${code} 的草稿身份、修订号或发布指针不完整`)
  }
  return draft
}

/** 在最后一次字段或流程保存后显式发布，按精确草稿修订和当前指针生成计划。 */
export async function publishTicketType(token: string, code: string): Promise<TicketDefinitionRef> {
  const draft = await findTicketTypeDraft(token, code)
  if (!draft) throw new Error(`找不到待发布草稿 ${code}`)
  const baseline = {
    code,
    expected_draft_revision: String(draft.version),
    expected_published_version: draft.current_published_version,
  }
  const plan = await mustData(api<{
    plan_id: string
    canonical_hash: string
    draft_revision: string
    current_definition_ref: TicketDefinitionRef | null
    warnings: Array<{ id: string }>
  }>('/api/v1/ticket-types/definitions/plan', { token, method: 'POST', body: baseline }), `预览发布 ${code}`)
  if (!plan.plan_id || !plan.canonical_hash || plan.draft_revision !== baseline.expected_draft_revision
    || (plan.current_definition_ref?.definition_version ?? null) !== baseline.expected_published_version) {
    throw new Error(`工单类型 ${code} 的发布计划与草稿基线不一致`)
  }
  const operationId = randomUUID()
  const receipt = await mustData(api<{
    operation_id: string
    draft_revision: string
    definition_ref: TicketDefinitionRef
  }>('/api/v1/ticket-types/definitions/publish', {
    token,
    method: 'POST',
    headers: { 'Idempotency-Key': operationId },
    body: {
      ...baseline,
      plan_id: plan.plan_id,
      canonical_hash: plan.canonical_hash,
      acknowledged_warning_ids: plan.warnings.map(({ id }) => id),
    },
  }), `发布工单类型 ${code}`)
  const ref = receipt.definition_ref
  if (receipt.operation_id !== operationId || receipt.draft_revision !== baseline.expected_draft_revision
    || ref.type_code !== code || typeof ref.definition_version !== 'string' || !/^[1-9]\d*$/.test(ref.definition_version) || !ref.definition_hash) {
    throw new Error(`工单类型 ${code} 的发布回执与请求不一致`)
  }
  return ref
}

/** 草稿走受控删除，已有发布历史的夹具类型通过现行版本停用。 */
export async function cleanupTicketType(token: string, code: string): Promise<void> {
  const draft = await findTicketTypeDraft(token, code)
  if (!draft) return
  const { id, version, current_published_version } = draft
  if (current_published_version === null) {
    await mustData(api('/api/v1/ticket-types/delete', { token, method: 'POST', body: { id, code, version } }), `删除临时草稿 ${code}`)
  } else {
    await mustData(api('/api/v1/ticket-types/update', { token, method: 'POST', body: { id, code, version, is_active: false } }), `停用临时类型 ${code}`)
  }
}

/** 临时工单类型（后端默认六状态图，open→assigned/closed 与 incident 同）——给依赖「新单初始态=open」的
 *  用例隔离自动分派规则：dev 栈是共享走查环境，可能存在 incident 全量命中规则（任何 incident 新单即刻
 *  assigned——2026-10-26 实证致 s2-home/s10/p5-s3a-transition 三 spec 假红）。
 *  transitionMeta 可选：create 端点不带 meta，须建后经 /ticket-types/update 全量替换（version 省略=不做 CAS）；
 *  建单用例须显式发布；业务工单按用例清理，类型由 cleanup 退出。 */
export async function tempTicketType(
  h: { token: string },
  prefix: string,
  transitionMeta?: Record<string, unknown>,
): Promise<{ code: string; cleanup: () => Promise<void> }> {
  const code = `${prefix}_${randomUUID().slice(0, 12).replace('-', '')}`
  await mustData(api('/api/v1/ticket-types', { ...h, method: 'POST', body: { code, name: `E2E 临时类型 ${code}` } }), `POST /ticket-types(${code})`)
  const cleanup = () => cleanupTicketType(h.token, code)
  try {
    if (transitionMeta) {
      await mustData(api('/api/v1/ticket-types/update', { ...h, method: 'POST', body: { code, transition_meta: transitionMeta } }), `POST /ticket-types/update(${code} meta)`)
    }
  } catch (error) {
    await cleanup()
    throw error
  }
  return { code, cleanup }
}

// ─── 直写 DB（panic 预造等无 API 触发面的场景——复核①：容器名/凭据 env 可覆盖）───

/** PG 容器名（env 覆盖：换容器名/远程 DB 时设 E2E_PG_CONTAINER） */
export const PG_CONTAINER = process.env.E2E_PG_CONTAINER ?? 'zhuzhao-dev-postgres'
const PG_USER = process.env.E2E_PG_USER ?? 'zhuzhao'
const PG_DB = process.env.E2E_PG_DB ?? 'zhuzhao'

/** docker exec psql 单条 SQL（同步——造数/清理场景无并发诉求） */
export function psql(sql: string): string {
  return execSync(
    `docker exec ${PG_CONTAINER} psql -U ${PG_USER} -d ${PG_DB} -qt -A -c ${JSON.stringify(sql)}`,
    { timeout: 10_000 },
  ).toString().trim()
}

/** PG 容器是否可达（不可达→调用方 test.skip 而非 fail——复核①优雅降级） */
export function pgAvailable(): boolean {
  try {
    psql('SELECT 1')
    return true
  } catch {
    return false
  }
}

// ─── taskrunner SQLite（宿主形态 data/taskrunner.db——jobs 定义无 API 删除面，
// E2E 建的任务定义清理走此直删；兄弟仓路径，env 覆盖适配非标准布局）───

export const TASKRUNNER_DB = process.env.E2E_TASKRUNNER_DB
  ?? resolve(here, '../../taskrunner/data/taskrunner.db')

export function taskrunnerSqlite(sql: string): string {
  return execSync(
    `sqlite3 ${JSON.stringify(TASKRUNNER_DB)} ${JSON.stringify(sql)}`,
    { timeout: 10_000 },
  ).toString().trim()
}

export function taskrunnerDbAvailable(): boolean {
  try {
    taskrunnerSqlite('SELECT 1')
    return true
  } catch {
    return false
  }
}
