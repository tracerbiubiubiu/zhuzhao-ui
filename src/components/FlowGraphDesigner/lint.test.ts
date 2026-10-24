/**
 * lint 纯逻辑测试（S2 B2-4——02 号附录 A.5 三规则 + 图级前提；B2-3 stuckStates 判据）。
 * 告警不阻断属调用方行为，本层只断言"报什么"。
 */
import { describe, expect, it } from 'vitest'
import { lintGraph, stuckStates } from './lint'
import { DEFAULT_STATES, DEFAULT_TRANSITIONS, type Adjacency } from './types'

const codes = (states: string[], t: Adjacency) => lintGraph(states, t).map((i) => `${i.code}${i.state ? `:${i.state}` : ''}`)

describe('lintGraph', () => {
  it('默认六状态图零告警（回归基线——存量类型零感知）', () => {
    expect(lintGraph([...DEFAULT_STATES], structuredClone(DEFAULT_TRANSITIONS) as Adjacency)).toEqual([])
  })

  it('缺 open → missing_start；缺 closed/rejected → no_terminal', () => {
    expect(codes(['a', 'closed'], { a: ['closed'], closed: ['a'] })).toEqual(['missing_start'])
    expect(codes(['open', 'a'], { open: ['a'], a: ['open'] })).toEqual(['no_terminal'])
  })

  it('② 孤立：无入边且非 open', () => {
    expect(codes(['open', 'closed', 'orphan'], { open: ['closed'], orphan: ['closed'] })).toEqual(['isolated:orphan'])
  })

  it('③ 死锁：非终态零出边；终态零出边不算（closed 无重开边合法）', () => {
    expect(codes(['open', 'stuck', 'closed'], { open: ['stuck', 'closed'] })).toEqual(['deadlock:stuck'])
  })

  it('① 终态可达性：有出边但只在非终态间打转 → unreachable_terminal（零出边者不叠报）', () => {
    expect(codes(['open', 'a', 'b', 'closed'], { open: ['a', 'closed'], a: ['b'], b: ['a'] }))
      .toEqual(['unreachable_terminal:a', 'unreachable_terminal:b'])
  })

  it('终态按名约定：closed 有重开边仍是终态，不触发可达性/死锁', () => {
    expect(codes(['open', 'closed'], { open: ['closed'], closed: ['open'] })).toEqual([])
  })
})

describe('stuckStates（B2-3 在途单告警判据）', () => {
  it('旧图删掉的状态 ∪ 新图非终态零出边；终态零出边不算；去重', () => {
    const old = ['open', 'assigned', 'in_progress', 'closed']
    const next = ['open', 'assigned', 'closed']
    // assigned 出边被清空 → 死路；in_progress 被删
    expect(stuckStates(old, next, { open: ['assigned', 'closed'] })).toEqual(['in_progress', 'assigned'])
    // 全部健康 → 空
    expect(stuckStates(old, old, { open: ['assigned'], assigned: ['in_progress'], in_progress: ['closed'] })).toEqual([])
  })
})
