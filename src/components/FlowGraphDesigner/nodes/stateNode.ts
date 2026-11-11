/**
 * 状态节点（S2 B2-2——02 号附录 A.2 nodes/StateNode：状态名 + 终态/起始态语义样式）。
 *
 * 画布层唯一 LogicFlow 子类文件。样式按**当前文本**判定角色（open=起始态/closed·rejected=终态/
 * 其余普通），双击改名后样式随文本即时切换；`properties.invalid` 由壳层按 fromGraph 错误回写
 * （空名/非标识符/重名）→ 红色描边定位。
 * 连接规则（目标侧）：禁自环（状态转到自身对工单流转无意义）、禁重复边（邻接表天然去重，画布
 * 不让画出第二条）——违规触发 `connection:not-allowed`，壳层弹提示。
 */
import { RectNode, RectNodeModel, type BaseNodeModel, type Model } from '@logicflow/core'
import { START_STATE, STATE_NODE_TYPE, TERMINAL_STATES } from '../types'

type Role = 'start' | 'terminal' | 'normal'

export function roleOf(state: string): Role {
  if (state === START_STATE) return 'start'
  if (TERMINAL_STATES.includes(state)) return 'terminal'
  return 'normal'
}

/** 角色配色（对齐 element-plus success/info/primary 浅色系，暗色主题下由 LogicFlow 主题层接管） */
const PALETTE: Record<Role, { fill: string; stroke: string }> = {
  start: { fill: '#f0f9eb', stroke: '#67c23a' },
  terminal: { fill: '#f4f4f5', stroke: '#909399' },
  normal: { fill: '#ecf5ff', stroke: '#409eff' },
}

class StateNodeModel extends RectNodeModel {
  initNodeData(data: Parameters<RectNodeModel['initNodeData']>[0]) {
    super.initNodeData(data)
    this.width = 140
    this.height = 44
    this.radius = 8
  }

  getNodeStyle() {
    const style = super.getNodeStyle()
    const role = roleOf((this.text?.value ?? '').trim())
    const c = PALETTE[role]
    style.fill = c.fill
    style.stroke = c.stroke
    style.strokeWidth = role === 'normal' ? 1.5 : 2
    if (this.properties?.invalid) {
      style.stroke = '#f56c6c'
      style.strokeWidth = 2
      style.strokeDasharray = '4 2'
    }
    return style
  }

  getTextStyle() {
    const style = super.getTextStyle()
    style.fontSize = 13
    style.color = '#303133'
    if (roleOf((this.text?.value ?? '').trim()) !== 'normal') style.fontWeight = 600
    return style
  }

  getConnectedTargetRules(): Model.ConnectRule[] {
    const rules = super.getConnectedTargetRules()
    rules.push({
      message: '状态不能转换到自身',
      validate: (source?: BaseNodeModel, target?: BaseNodeModel) => !source || !target || source.id !== target.id,
    })
    rules.push({
      message: '该转换已存在',
      validate: (source?: BaseNodeModel, target?: BaseNodeModel) => {
        if (!source || !target) return true
        return !this.graphModel.edges.some((e) => e.sourceNodeId === source.id && e.targetNodeId === target.id)
      },
    })
    return rules
  }
}

class StateNodeView extends RectNode {}

export default {
  type: STATE_NODE_TYPE,
  view: StateNodeView,
  model: StateNodeModel,
}
