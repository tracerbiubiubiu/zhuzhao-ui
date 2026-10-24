/**
 * FlowGraphDesigner 数据面类型（S2 B2-2——02 号附录 A.1/A.3）。
 *
 * 画布数据结构兼容 LogicFlow GraphConfigData（NodeConfig/EdgeConfig 子集），但本文件与
 * mapper/lint/layout 均**不 import LogicFlow 运行时**——纯函数层在 vitest node 环境直测，
 * 画布库只在 index.vue / nodes/stateNode.ts 出现（画布层/适配层分离——02 号 §3.2 纪律）。
 */

/** 自定义状态节点注册名（nodes/stateNode.ts 同名注册） */
export const STATE_NODE_TYPE = 'state-node'
/** 边类型：折线（状态图转换天然适配，LogicFlow 内建） */
export const STATE_EDGE_TYPE = 'polyline'

/**
 * 起始态：工单创建恒置 open（zhuzhao service.go Create `Status: StatusOpen`）——
 * 图中缺 open 则新单无法流转（lint missing_start）。
 */
export const START_STATE = 'open'
/**
 * 终态约定：closed=后端唯一终态判定（service.go 三处 `Status == StatusClosed`——仅非终态可改/
 * 已关闭不可再关）；rejected=设计终态（API 不可达但列为六态之一）。终态允许有出边（默认图
 * closed/rejected → open 为重开边），故终态**按名约定**而非"无出边"——lint 规则的判据基础。
 */
export const TERMINAL_STATES: readonly string[] = ['closed', 'rejected']
/** 状态码命名：标识符形态（与六默认态 snake_case 同构；JSON 源码模式不受此限） */
export const STATE_NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/

/** 后端默认六状态图镜像（type_admin.go defaultStates/defaultTransitions——改一处须同步） */
export const DEFAULT_STATES: readonly string[] = ['open', 'assigned', 'in_progress', 'pending_verify', 'closed', 'rejected']
export const DEFAULT_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  open: ['assigned', 'closed'],
  assigned: ['in_progress', 'open'],
  in_progress: ['pending_verify', 'rejected', 'closed'],
  pending_verify: ['closed', 'in_progress'],
  closed: ['open'],
  rejected: ['open'],
}

/** transitions JSONB 形态 = 邻接表 {from: [to...]}（A.1 关键事实） */
export type Adjacency = Record<string, string[]>
/** 节点坐标表（按状态名键——本地视图偏好，不入库） */
export type Positions = Record<string, { x: number; y: number }>

export interface FlowNode {
  id: string
  type: typeof STATE_NODE_TYPE
  x: number
  y: number
  text: string
}
export interface FlowEdge {
  id: string
  type: typeof STATE_EDGE_TYPE
  sourceNodeId: string
  targetNodeId: string
}
/** toGraph 产物（喂 lf.render） */
export interface FlowGraphData {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

/** fromGraph 入参：lf.getGraphData() 返回形态的最小子集（text 字符串或 {value}） */
export interface RawGraphNode {
  id: string
  x?: number
  y?: number
  text?: string | { value: string } | null
}
export interface RawGraphEdge {
  sourceNodeId: string
  targetNodeId: string
}
export interface RawGraphData {
  nodes: RawGraphNode[]
  edges: RawGraphEdge[]
}

export type GraphErrorCode = 'empty_name' | 'invalid_name' | 'duplicate_name' | 'dangling_edge'
export interface GraphError {
  code: GraphErrorCode
  message: string
  /** 定位用：出错节点 id（dangling_edge 无） */
  nodeId?: string
}

export type FromGraphResult =
  | { ok: true; states: string[]; transitions: Adjacency }
  | { ok: false; errors: GraphError[] }

export type LintCode = 'missing_start' | 'no_terminal' | 'isolated' | 'deadlock' | 'unreachable_terminal'
export interface LintIssue {
  code: LintCode
  message: string
  /** 关联状态（可定位节点）；图级问题无 */
  state?: string
}
