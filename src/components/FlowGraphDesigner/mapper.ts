/**
 * 邻接表 ↔ 画布 graphData 映射器（S2 B2-2——02 号附录 A.1/A.3，**唯一适配层**）。
 *
 * - toGraph：states 逐个建节点（id=状态名，确定性）+ 邻接表展开为边（from→to 各一条，Set 去重）；
 *   坐标取 positions（本地视图偏好），缺省落 autoLayout。前置条件=validateTypeGraph 通过——
 *   端点悬空直接 throw（调用方先校验再加载，不静默丢边）。
 * - fromGraph：节点文本=状态名（双击改名后 id 不变、以 text 为准），边按 source 折叠回
 *   `{from: [to...]}`；**每个状态都出键**（无出边=[]，与后端默认图"六态皆键"同构）。
 *   负向：空名/非标识符/重名/边端点无节点 → errors（保存前拦截 + 调用方高亮定位）。
 * - validateTypeGraph：后端 type_admin.go validateTypeGraph 镜像预检（端点合法性，文案对齐），
 *   前端先拦、后端兜底（A.3 校验双保险）。
 *
 * 往返幂等：默认六状态图 fromGraph(toGraph(def)) 深比较零 diff（mapper.test.ts 承重）。
 */
import { autoLayout } from './layout'
import {
  STATE_EDGE_TYPE, STATE_NAME_RE, STATE_NODE_TYPE,
  type Adjacency, type FlowEdge, type FlowGraphData, type FlowNode, type FromGraphResult,
  type GraphError, type Positions, type RawGraphData, type RawGraphNode,
} from './types'

/** 后端 validateTypeGraph 镜像：返回错误文案列表（空=通过）。接受 unknown 以便直喂 JSON.parse 产物。 */
export function validateTypeGraph(states: unknown, transitions: unknown): string[] {
  if (!Array.isArray(states) || states.some((s) => typeof s !== 'string')) return ['states 须为字符串数组']
  const set = new Set(states as string[])
  if (set.size === 0) return ['states 不能为空']
  if (typeof transitions !== 'object' || transitions === null || Array.isArray(transitions)) {
    return ['transitions 须为 {from: [to...]} 对象']
  }
  const errs: string[] = []
  for (const [from, tos] of Object.entries(transitions as Record<string, unknown>)) {
    if (!set.has(from)) errs.push(`transitions.from "${from}" 不在 states 中`)
    if (!Array.isArray(tos) || tos.some((t) => typeof t !== 'string')) {
      errs.push(`transitions."${from}" 须为字符串数组`)
      continue
    }
    for (const to of tos as string[]) if (!set.has(to)) errs.push(`transitions.to "${to}" 不在 states 中`)
  }
  return errs
}

export function edgeId(from: string, to: string): string {
  return `e:${from}>${to}`
}

export function toGraph(states: readonly string[], transitions: Adjacency, positions: Positions = {}): FlowGraphData {
  const set = new Set(states)
  const missing = states.filter((s) => !positions[s])
  // 仅为缺坐标的状态补自动布局，但布局按全图算以保持层次（有坐标的取存量值）
  const layout = missing.length ? autoLayout(states, transitions) : {}
  const nodes: FlowNode[] = states.map((s) => {
    const p = positions[s] ?? layout[s] ?? { x: 0, y: 0 }
    return { id: s, type: STATE_NODE_TYPE, x: p.x, y: p.y, text: s }
  })
  const edges: FlowEdge[] = []
  const seen = new Set<string>()
  for (const from of states) {
    for (const to of transitions[from] ?? []) {
      if (!set.has(to)) throw new Error(`transitions.to "${to}" 不在 states 中`)
      const key = edgeId(from, to)
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ id: key, type: STATE_EDGE_TYPE, sourceNodeId: from, targetNodeId: to })
    }
  }
  for (const from of Object.keys(transitions)) {
    if (!set.has(from)) throw new Error(`transitions.from "${from}" 不在 states 中`)
  }
  return { nodes, edges }
}

export function nodeText(n: RawGraphNode): string {
  const t = n.text
  if (t == null) return ''
  return (typeof t === 'string' ? t : t.value ?? '').trim()
}

export function fromGraph(g: RawGraphData): FromGraphResult {
  const errors: GraphError[] = []
  const idToName = new Map<string, string>()
  const seenNames = new Set<string>()
  const states: string[] = []
  for (const n of g.nodes) {
    const name = nodeText(n)
    if (!name) {
      errors.push({ code: 'empty_name', message: '存在未命名状态节点', nodeId: n.id })
      continue
    }
    if (!STATE_NAME_RE.test(name)) {
      errors.push({ code: 'invalid_name', message: `状态名「${name}」须为字母开头的字母/数字/下划线`, nodeId: n.id })
      continue
    }
    if (seenNames.has(name)) {
      errors.push({ code: 'duplicate_name', message: `状态名「${name}」重复`, nodeId: n.id })
      continue
    }
    seenNames.add(name)
    idToName.set(n.id, name)
    states.push(name)
  }
  const transitions: Adjacency = {}
  for (const s of states) transitions[s] = []
  for (const e of g.edges) {
    const from = idToName.get(e.sourceNodeId)
    const to = idToName.get(e.targetNodeId)
    if (!from || !to) {
      // 端点节点本身已报错（空名/重名）时不再叠报悬空
      const endpointErrored = errors.some((x) => x.nodeId === e.sourceNodeId || x.nodeId === e.targetNodeId)
      if (!endpointErrored) errors.push({ code: 'dangling_edge', message: `存在端点缺失的转换 ${e.sourceNodeId} → ${e.targetNodeId}` })
      continue
    }
    const list = transitions[from]!
    if (!list.includes(to)) list.push(to)
  }
  if (errors.length) return { ok: false, errors }
  return { ok: true, states, transitions }
}

/** 从画布数据抽坐标表（按状态名键——重命名后以新名存，旧名条目随之失效属可接受） */
export function positionsOf(g: RawGraphData): Positions {
  const pos: Positions = {}
  for (const n of g.nodes) {
    const name = nodeText(n)
    if (name && typeof n.x === 'number' && typeof n.y === 'number') pos[name] = { x: n.x, y: n.y }
  }
  return pos
}

/** 产一个未占用的新状态名（state_1、state_2…） */
export function nextStateName(existing: Iterable<string>): string {
  const set = new Set(existing)
  for (let i = 1; ; i++) {
    const cand = `state_${i}`
    if (!set.has(cand)) return cand
  }
}
