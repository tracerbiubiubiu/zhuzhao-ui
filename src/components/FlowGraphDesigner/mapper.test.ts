/**
 * mapper 纯逻辑测试（S2 B2-2——02 号附录 A.3「往返幂等承重」+ A.6 验收补充）。
 *
 * 契约：邻接表 {from:[to...]} ↔ 画布 graphData 双向浅层纯函数；默认六状态图 roundtrip 零 diff；
 * 负向：空名/非标识符/重名/悬空端点 → errors；toGraph 对悬空端点 throw（先 validate 再加载）。
 */
import { describe, expect, it } from 'vitest'
import { autoLayout } from './layout'
import { edgeId, fromGraph, nextStateName, positionsOf, toGraph, validateTypeGraph } from './mapper'
import { DEFAULT_STATES, DEFAULT_TRANSITIONS, STATE_EDGE_TYPE, STATE_NODE_TYPE, type Adjacency } from './types'

const def = () => ({ states: [...DEFAULT_STATES], transitions: structuredClone(DEFAULT_TRANSITIONS) as Adjacency })

describe('toGraph', () => {
  it('状态=节点（id/text=状态名）、邻接表展开为边、边 id 确定性', () => {
    const { states, transitions } = def()
    const g = toGraph(states, transitions)
    expect(g.nodes.map((n) => n.id)).toEqual(states)
    expect(g.nodes.every((n) => n.type === STATE_NODE_TYPE && n.text === n.id)).toBe(true)
    // 2+2+3+2+1+1 = 11 条转换
    expect(g.edges).toHaveLength(11)
    expect(g.edges[0]).toEqual({ id: edgeId('open', 'assigned'), type: STATE_EDGE_TYPE, sourceNodeId: 'open', targetNodeId: 'assigned' })
  })

  it('同向重复转换去重（邻接表里写两遍只出一条边）', () => {
    const g = toGraph(['a', 'b'], { a: ['b', 'b'] })
    expect(g.edges).toHaveLength(1)
  })

  it('有坐标取存量、缺坐标补自动布局（不会落 0,0）', () => {
    const { states, transitions } = def()
    const g = toGraph(states, transitions, { open: { x: 999, y: 888 } })
    expect(g.nodes.find((n) => n.id === 'open')).toMatchObject({ x: 999, y: 888 })
    const others = g.nodes.filter((n) => n.id !== 'open')
    expect(others.every((n) => n.x > 0 && n.y > 0)).toBe(true)
  })

  it('端点悬空 throw（to / from 两路）——前置条件 validateTypeGraph', () => {
    expect(() => toGraph(['a'], { a: ['zz'] })).toThrow(/"zz" 不在 states 中/)
    expect(() => toGraph(['a'], { zz: [] })).toThrow(/"zz" 不在 states 中/)
  })
})

describe('fromGraph', () => {
  it('默认六状态图往返幂等：fromGraph(toGraph(def)) 深比较零 diff', () => {
    const { states, transitions } = def()
    const r = fromGraph(toGraph(states, transitions))
    expect(r).toEqual({ ok: true, states, transitions })
  })

  it('以节点 text 为状态名（双击改名后 id 陈旧以 text 为准）；text 支持 {value} 形态；每个状态都出键', () => {
    const r = fromGraph({
      nodes: [
        { id: 'open', text: { value: 'open' } },
        { id: 'n_uuid', text: ' done ' },
      ],
      edges: [{ sourceNodeId: 'open', targetNodeId: 'n_uuid' }],
    })
    expect(r).toEqual({ ok: true, states: ['open', 'done'], transitions: { open: ['done'], done: [] } })
  })

  it('画布重复连线折叠为一条', () => {
    const r = fromGraph({
      nodes: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }],
      edges: [{ sourceNodeId: 'a', targetNodeId: 'b' }, { sourceNodeId: 'a', targetNodeId: 'b' }],
    })
    expect(r.ok && r.transitions).toEqual({ a: ['b'], b: [] })
  })

  it('负向：空名 / 非标识符 / 重名 各报一条并携带 nodeId 供定位', () => {
    const r = fromGraph({
      nodes: [
        { id: '1', text: '' },
        { id: '2', text: 'in progress' },
        { id: '3', text: '9lives' },
        { id: '4', text: 'open' },
        { id: '5', text: 'open' },
      ],
      edges: [],
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.map((e) => [e.code, e.nodeId])).toEqual([
      ['empty_name', '1'], ['invalid_name', '2'], ['invalid_name', '3'], ['duplicate_name', '5'],
    ])
  })

  it('负向：边端点无节点 → dangling_edge；端点节点自身已报错则不叠报', () => {
    const dangling = fromGraph({ nodes: [{ id: 'a', text: 'a' }], edges: [{ sourceNodeId: 'a', targetNodeId: 'ghost' }] })
    expect(!dangling.ok && dangling.errors.map((e) => e.code)).toEqual(['dangling_edge'])
    const errored = fromGraph({
      nodes: [{ id: 'a', text: 'a' }, { id: 'b', text: '' }],
      edges: [{ sourceNodeId: 'a', targetNodeId: 'b' }],
    })
    expect(!errored.ok && errored.errors.map((e) => e.code)).toEqual(['empty_name'])
  })
})

describe('validateTypeGraph（后端镜像）', () => {
  it('合法图通过', () => {
    const { states, transitions } = def()
    expect(validateTypeGraph(states, transitions)).toEqual([])
  })
  it('文案与 type_admin.go 对齐', () => {
    expect(validateTypeGraph('x', {})).toEqual(['states 须为字符串数组'])
    expect(validateTypeGraph([1], {})).toEqual(['states 须为字符串数组'])
    expect(validateTypeGraph([], {})).toEqual(['states 不能为空'])
    expect(validateTypeGraph(['a'], [])).toEqual(['transitions 须为 {from: [to...]} 对象'])
    expect(validateTypeGraph(['a'], { b: ['a'] })).toEqual(['transitions.from "b" 不在 states 中'])
    expect(validateTypeGraph(['a'], { a: ['c'] })).toEqual(['transitions.to "c" 不在 states 中'])
    expect(validateTypeGraph(['a'], { a: 'c' })).toEqual(['transitions."a" 须为字符串数组'])
  })
})

describe('autoLayout', () => {
  it('默认图分层：open 第 0 列；assigned/closed 第 1 列；in_progress 第 2 列；pending_verify/rejected 第 3 列', () => {
    const { states, transitions } = def()
    const p = autoLayout(states, transitions, { x0: 0, y0: 0, dx: 1, dy: 1 })
    expect(p.open).toEqual({ x: 0, y: 0 })
    expect([p.assigned.x, p.closed.x]).toEqual([1, 1])
    expect(p.in_progress.x).toBe(2)
    expect([p.pending_verify.x, p.rejected.x]).toEqual([3, 3])
    expect(p.pending_verify.y).not.toBe(p.rejected.y)
  })
  it('不可达状态续接在最后一列之后；无 open 时首状态为根；确定性', () => {
    const p = autoLayout(['a', 'b', 'lonely'], { a: ['b'] }, { x0: 0, y0: 0, dx: 1, dy: 1 })
    expect(p).toEqual({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, lonely: { x: 2, y: 0 } })
    expect(autoLayout(['a', 'b', 'lonely'], { a: ['b'] }, { x0: 0, y0: 0, dx: 1, dy: 1 })).toEqual(p)
  })
})

describe('辅助件', () => {
  it('positionsOf 按状态名抽坐标；nextStateName 跳过已占用', () => {
    expect(positionsOf({ nodes: [{ id: 'x', x: 1, y: 2, text: 'open' }, { id: 'y', text: '' }], edges: [] })).toEqual({ open: { x: 1, y: 2 } })
    expect(nextStateName(['state_1', 'open'])).toBe('state_2')
  })
})
