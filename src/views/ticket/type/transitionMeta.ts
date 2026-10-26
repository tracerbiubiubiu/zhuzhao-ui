/**
 * transition_meta 载荷拆分/重组（纯函数——类型编辑弹窗与单测共用）
 *
 * 双形键共存（S10 B10-4 state 级 × S3a B3-1 转换级，03 号「校验分层」）：
 * - state 级键（"open"）= 超时/催办行，表单化编辑面消费；
 * - 转换级键（"open>assigned"，含 ">"）= condition/validator/post_actions，
 *   无编辑面——**原样透传**（审计 A-6：此前 load/serialize 双侧不识别该键形，
 *   一次 UI 保存即静默清掉 API 侧配好的转换级配置）。
 */

export interface MetaDraft {
  state: string
  timeout: number | undefined
  notifyAssignee: boolean
  notifySupervisor: boolean
  interval: number | undefined
  max: number | undefined
}

export function isTransitionKey(key: string): boolean {
  return key.includes('>')
}

/** meta 对象 → 表单行 + 转换级键透传桶（非对象段跳过，同旧口径） */
export function splitTransitionMeta(raw: unknown): { stateRows: MetaDraft[]; preserved: Record<string, unknown> } {
  const stateRows: MetaDraft[] = []
  const preserved: Record<string, unknown> = {}
  if (typeof raw !== 'object' || raw === null) return { stateRows, preserved }
  for (const [key, seg] of Object.entries(raw as Record<string, unknown>)) {
    if (isTransitionKey(key)) {
      preserved[key] = seg
      continue
    }
    if (typeof seg !== 'object' || seg === null) continue
    const m = seg as { timeout_minutes?: number; escalation?: { notify?: string[]; reminder_interval_minutes?: number; max_reminders?: number } }
    stateRows.push({
      state: key,
      timeout: m.timeout_minutes,
      notifyAssignee: !m.escalation?.notify || m.escalation.notify.includes('assignee'),
      notifySupervisor: m.escalation?.notify?.includes('supervisor') ?? false,
      interval: m.escalation?.reminder_interval_minutes,
      max: m.escalation?.max_reminders,
    })
  }
  return { stateRows, preserved }
}

export type BuildMetaResult =
  | { ok: true; meta: Record<string, unknown>; droppedRows: number; droppedTransitions: string[] }
  | { ok: false; error: string }

/** 表单行 + 透传桶 → meta 对象；端点状态已删的转换级键与引用已删状态的行同样静默丢弃计数（后端 400 前置） */
export function buildTransitionMeta(rows: MetaDraft[], states: string[], preserved: Record<string, unknown>): BuildMetaResult {
  const stateSet = new Set(states)
  const out: Record<string, unknown> = {}
  let droppedRows = 0
  for (const r of rows) {
    if (!r.state) return { ok: false, error: '节点超时配置存在未选状态的行' }
    if (!stateSet.has(r.state)) {
      droppedRows++
      continue
    }
    if (r.timeout === undefined || r.timeout < 1) return { ok: false, error: `节点「${r.state}」超时分钟须 ≥1` }
    if (r.interval !== undefined && r.interval < 5) {
      return { ok: false, error: `节点「${r.state}」催办间隔须 ≥5 分钟（小于通知节流窗会被吞）` }
    }
    const seg: Record<string, unknown> = { timeout_minutes: r.timeout }
    const hasEsc = r.notifySupervisor || r.interval !== undefined || r.max !== undefined
    if (hasEsc) {
      const notify: string[] = []
      if (r.notifyAssignee) notify.push('assignee')
      if (r.notifySupervisor) notify.push('supervisor')
      seg.escalation = {
        notify: notify.length ? notify : ['assignee'],
        ...(r.interval !== undefined ? { reminder_interval_minutes: r.interval } : {}),
        ...(r.max !== undefined ? { max_reminders: r.max } : {}),
      }
    }
    out[r.state] = seg
  }
  const droppedTransitions: string[] = []
  for (const [key, value] of Object.entries(preserved)) {
    const parts = key.split('>')
    if (parts.length === 2 && parts.every((p) => stateSet.has(p))) out[key] = value
    else droppedTransitions.push(key)
  }
  return { ok: true, meta: out, droppedRows, droppedTransitions }
}
