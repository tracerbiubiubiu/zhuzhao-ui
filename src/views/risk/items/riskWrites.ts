/**
 * 风险写会话管理（B2 第 6 项——登记/核实/责任写携 operation_id 的稳定性纪律）
 *
 * 不变量（来自本轮接线要求与 Mutation 合同「同号同参幂等、同号异参 409」）：
 * - 每个逻辑操作（对话框槽位）持有稳定 operation_id：窗口关闭/重复点击/响应未知
 *   都不更换原号；重投必须携带与首次完全一致的原始业务输入。
 * - 已提交过（服务端可能见过该号）之后再改参数 ⇒ 换新号重发（同号异参必 409）。
 * - 响应未知（无 HTTP response：断网/超时/取消，或 5xx 有响应但提交结果未知）
 *   ⇒ 输入锁定，进入「待核查」：仅可原号原参重投、只读核查，或显式放弃后重填；
 *   不得静默改号重做。
 * - 首次提交收到明确 4xx 时回到草稿态；参数不变可原号重试，改参换新号。
 * - 结果未知后的同号重投收到拒绝，首笔仍待核查，保留原号和输入。
 */
import { apiErrorMessage } from '@/utils/apiError'

export type WritePhase = 'draft' | 'pending' | 'unknown'

export interface WriteSession<C> {
  readonly key: string
  operationId: string
  /** 最近一次实际提交（或即将提交）的业务输入；unknown 期间被锁定 */
  input: C
  phase: WritePhase
  error: string
  /** 最近一次 definitive 失败是否为版本冲突（409，提示刷新比较而非盲目覆盖） */
  conflict: boolean
  /** 服务端是否已见过本号（提交已发出且获得 definitive 响应） */
  submitted: boolean
}

export type WriteOutcome<R> =
  | { kind: 'done'; result: R }
  | { kind: 'definitive'; error: string; conflict: boolean }
  | { kind: 'unknown'; error: string }

/** 提交结果未知 ⇒ 无业务结论可依赖：断网/超时/取消（无 HTTP response），
 * 或 5xx（网关/服务端故障，提交是否落库不可知）；4xx 有明确业务拒绝 ⇒ definitive */
export function isUnknownOutcome(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status
  return status === undefined || status >= 500
}

/** 与 key 顺序无关的输入一致性比较（重投与原输入必须逐字段相等） */
function canonicalInput(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalInput).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalInput(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? String(value)
}

export interface WriteSessionsOptions<C, R> {
  /** 操作号新源（crypto 随机，见 ./api/risk/operationKey 同实现） */
  newId: () => string
  /** 实际提交：adapter 的写端口；reject 的 error 携带 axios response 与否区分未知/definitive */
  run: (input: C, operationId: string) => Promise<R>
  definitiveFallback?: string
}

export function createWriteSessions<C, R>(options: WriteSessionsOptions<C, R>) {
  const sessions = new Map<string, WriteSession<C>>()
  const fallback = options.definitiveFallback ?? '提交失败，请稍后重试'

  /** 服务端可能已见过的会话（不得静默换号重做） */
  function seen(key: string): WriteSession<C> | undefined {
    const session = sessions.get(key)
    return session && session.submitted ? session : undefined
  }

  function fresh(key: string, input: C): WriteSession<C> {
    const session: WriteSession<C> = {
      key, operationId: options.newId(), input, phase: 'draft', error: '', conflict: false, submitted: false,
    }
    sessions.set(key, session)
    return session
  }

  /** 打开对话框槽位：已有会话（草稿/进行中/未知）原样恢复，否则开新草稿 */
  function open(key: string, input: C): WriteSession<C> {
    const existing = sessions.get(key)
    return existing ?? fresh(key, input)
  }

  function session(key: string): WriteSession<C> | undefined {
    const current = sessions.get(key)
    return current && { ...current }
  }

  /** 显式放弃未决提交（未知结果放弃后重填=发起一次新业务操作，UI 须明示） */
  function discard(key: string): void {
    sessions.delete(key)
  }

  /** 只读核查确认：仅未知态会话可确认（页面已按原号查回同号同命令收据）；
   * 确认后销毁会话，下一次提交使用新号。返回是否确认了会话。 */
  function confirm(key: string): boolean {
    const session = sessions.get(key)
    if (!session || session.phase !== 'unknown') return false
    sessions.delete(key)
    return true
  }

  async function submit(key: string, input: C): Promise<WriteOutcome<R>> {
    let current = sessions.get(key)
    if (current?.phase === 'pending') {
      return { kind: 'definitive', error: '已有提交进行中，请等待结果', conflict: false }
    }
    const original = seen(key)
    if (original && canonicalInput(original.input) !== canonicalInput(input)) {
      // 服务端见过原号：改参必须换新号（同号异参被服务端 409 拒绝）
      if (original.phase === 'unknown') {
        return { kind: 'definitive', error: '上次提交结果未知，请按原参数重投或放弃此次提交', conflict: false }
      }
      current = fresh(key, input)
    }
    const target = current ?? fresh(key, input)
    const hadUnknownResult = target.phase === 'unknown'
    target.input = input
    target.phase = 'pending'
    target.error = ''
    target.conflict = false
    try {
      const result = await options.run(input, target.operationId)
      sessions.delete(key)
      return { kind: 'done', result }
    } catch (error) {
      const unknown = isUnknownOutcome(error)
      if (hadUnknownResult || unknown) {
        target.phase = 'unknown'
        target.submitted = true
        target.error = unknown
          ? '提交结果未知（网络中断或服务故障）。已保留原操作号，可只读核查、原号重投或放弃此次提交'
          : '本次重投已被拒绝，首笔提交仍待核查。请保留原操作号'
        return { kind: 'unknown', error: target.error }
      }
      target.phase = 'draft'
      target.submitted = true
      target.conflict = (error as { response?: { status?: number } } | null)?.response?.status === 409
      target.error = apiErrorMessage(error, fallback)
      return { kind: 'definitive', error: target.error, conflict: target.conflict }
    }
  }

  return { open, session, submit, discard, confirm }
}
