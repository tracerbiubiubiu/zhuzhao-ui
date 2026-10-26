import { describe, expect, it } from 'vitest'
import { buildTransitionMeta, isTransitionKey, splitTransitionMeta } from './transitionMeta'

/** A-6 footgun 场景锚：API 配好的转换级配置（S3a condition/validator/post_actions）经一次 UI 加载→保存不被清掉 */
const rawWithTransitionMeta = {
  open: { timeout_minutes: 30, escalation: { notify: ['assignee', 'supervisor'], reminder_interval_minutes: 10, max_reminders: 3 } },
  'open>assigned': {
    condition: { roles: ['assignee'] },
    validator: 'priority == 1',
    post_actions: [{ name: 'spawn_task', params: { action: 'enrich', params: { from: 'ticket.host_ip' } } }],
  },
  'assigned>open': { condition: { roles: ['creator'] } },
}

describe('isTransitionKey', () => {
  it('含 ">" 判为转换级键，state 键不误判', () => {
    expect(isTransitionKey('open>assigned')).toBe(true)
    expect(isTransitionKey('open')).toBe(false)
  })
})

describe('splitTransitionMeta', () => {
  it('state 级键解析为表单行（超时+催办标记），转换级键整段进透传桶', () => {
    const { stateRows, preserved } = splitTransitionMeta(rawWithTransitionMeta)
    expect(stateRows).toEqual([
      { state: 'open', timeout: 30, notifyAssignee: true, notifySupervisor: true, interval: 10, max: 3 },
    ])
    expect(preserved).toEqual({
      'open>assigned': rawWithTransitionMeta['open>assigned'],
      'assigned>open': rawWithTransitionMeta['assigned>open'],
    })
  })

  it('escalation 缺省=仅通知处理人；非对象段跳过；null/标量整体安全', () => {
    const { stateRows } = splitTransitionMeta({
      pending: { timeout_minutes: 60 },
      broken: 'not-an-object',
    })
    expect(stateRows).toEqual([
      { state: 'pending', timeout: 60, notifyAssignee: true, notifySupervisor: false, interval: undefined, max: undefined },
    ])
    expect(splitTransitionMeta(null)).toEqual({ stateRows: [], preserved: {} })
    expect(splitTransitionMeta('x')).toEqual({ stateRows: [], preserved: {} })
  })
})

describe('buildTransitionMeta', () => {
  it('往返：拆了再建，转换级键原值保留、state 行重组一致', () => {
    const { stateRows, preserved } = splitTransitionMeta(rawWithTransitionMeta)
    const r = buildTransitionMeta(stateRows, ['open', 'assigned', 'in_progress'], preserved)
    expect(r).toMatchObject({ ok: true, droppedRows: 0, droppedTransitions: [] })
    if (!r.ok) return
    expect(r.meta['open>assigned']).toEqual(rawWithTransitionMeta['open>assigned'])
    expect(r.meta['assigned>open']).toEqual(rawWithTransitionMeta['assigned>open'])
    expect(r.meta.open).toEqual(rawWithTransitionMeta.open)
  })

  it('端点状态被删的转换级键丢弃并计数（后端 400 前置），存活键不受牵连', () => {
    const { preserved } = splitTransitionMeta({
      'open>assigned': { condition: { roles: ['assignee'] } },
      'open>closed': { validator: 'priority == 1' },
    })
    const r = buildTransitionMeta([], ['open', 'assigned'], preserved)
    expect(r).toMatchObject({ ok: true, droppedRows: 0 })
    if (!r.ok) return
    expect(r.droppedTransitions).toEqual(['open>closed'])
    expect(r.meta['open>assigned']).toBeDefined()
    expect(r.meta['open>closed']).toBeUndefined()
  })

  it('引用已删状态的行丢弃计数；escalation 段有任一配置才出、notify 空回退 assignee', () => {
    const r = buildTransitionMeta(
      [
        { state: 'ghost', timeout: 10, notifyAssignee: true, notifySupervisor: false, interval: undefined, max: undefined },
        { state: 'open', timeout: 15, notifyAssignee: false, notifySupervisor: true, interval: undefined, max: undefined },
      ],
      ['open'],
      {},
    )
    expect(r).toMatchObject({ ok: true, droppedRows: 1 })
    if (!r.ok) return
    expect(r.meta.open).toEqual({
      timeout_minutes: 15,
      escalation: { notify: ['supervisor'] },
    })
  })

  it('行校验三错误：未选状态 / 超时 <1 / 催办间隔 <5', () => {
    const blank: Parameters<typeof buildTransitionMeta>[0] = [
      { state: '', timeout: 10, notifyAssignee: true, notifySupervisor: false, interval: undefined, max: undefined },
    ]
    expect(buildTransitionMeta(blank, ['open'], {})).toEqual({ ok: false, error: '节点超时配置存在未选状态的行' })

    const zero: Parameters<typeof buildTransitionMeta>[0] = [
      { state: 'open', timeout: 0, notifyAssignee: true, notifySupervisor: false, interval: undefined, max: undefined },
    ]
    expect(buildTransitionMeta(zero, ['open'], {})).toEqual({ ok: false, error: '节点「open」超时分钟须 ≥1' })

    const tight: Parameters<typeof buildTransitionMeta>[0] = [
      { state: 'open', timeout: 10, notifyAssignee: true, notifySupervisor: false, interval: 4, max: undefined },
    ]
    expect(buildTransitionMeta(tight, ['open'], {})).toEqual({
      ok: false,
      error: '节点「open」催办间隔须 ≥5 分钟（小于通知节流窗会被吞）',
    })
  })
})
