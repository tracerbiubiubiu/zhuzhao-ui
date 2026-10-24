<template>
  <div class="fg-designer">
    <div class="fg-toolbar">
      <el-button size="small" type="primary" plain data-testid="fg-add-state" @click="addState">添加状态</el-button>
      <el-button size="small" plain data-testid="fg-delete-selected" @click="deleteSelected">删除选中</el-button>
      <el-button size="small" plain @click="relayout">自动布局</el-button>
      <el-button size="small" plain @click="fitView">适应画布</el-button>
      <span class="fg-hint">双击节点改名 · 悬停节点拖出锚点连线 · Delete 删除选中</span>
      <div class="fg-spacer" />
      <el-popover v-if="issues.length" placement="bottom-end" :width="380" trigger="click">
        <template #reference>
          <el-badge :value="issues.length" type="warning" class="fg-badge">
            <el-button size="small" type="warning" plain data-testid="fg-lint-badge">图检查</el-button>
          </el-badge>
        </template>
        <div class="fg-issues">
          <div class="fg-issues-title">以下问题不阻断保存，建议修正（点击定位节点）：</div>
          <div
            v-for="(it, i) in issues"
            :key="i"
            class="fg-issue"
            :class="{ 'fg-issue--clickable': !!it.state }"
            @click="it.state && locate(it.state)"
          >
            {{ it.message }}
          </div>
        </div>
      </el-popover>
      <el-tag v-else-if="!errors.length && loaded" size="small" type="success" data-testid="fg-lint-ok">图检查通过</el-tag>
    </div>

    <div ref="containerRef" class="fg-canvas" data-testid="fg-canvas" />

    <el-alert
      v-if="errors.length"
      type="error"
      show-icon
      :closable="false"
      class="fg-errors"
      data-testid="fg-errors"
      :title="errors.map((e) => e.message).join('；')"
    />
    <div class="fg-legend">
      <span><i class="fg-dot fg-dot--start" />open 起始态</span>
      <span><i class="fg-dot fg-dot--terminal" />closed / rejected 终态</span>
      <span><i class="fg-dot fg-dot--normal" />其他状态</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * FlowGraphDesigner 流程状态图画布（S2 B2-2——02 号附录 A.2 壳层）。
 *
 * 画布层/适配层分离：本文件 + nodes/stateNode.ts 是唯一触碰 LogicFlow 的地方；邻接表 ↔
 * graphData 全走 mapper.ts 纯函数，lint/layout 同为纯函数（vitest 直测）。
 * 数据经 props/expose 进出，不直连工单 Pinia store（2026-10-20 回灌——phase10 playbook
 * 设计器可复用画布层只换适配器）。
 *
 * 命令式接口（对齐 FormDesigner 惯例）：调用方打开对话框后 `load(states, transitions)`，
 * 保存时 `serialize()` 取 {ok, states, transitions} 或 errors；lint 告警只在角标展示不阻断
 * （拍板点 2——2026-10-24 所有者确认）。
 * 节点坐标不入库（A.2 设计决策）：localStorage 按 type_code 存本地视图偏好，缺省 autoLayout。
 *
 * 2026-10-24 B2-1 spike 结论：LogicFlow 2.2.5 维持（vue-flow 1.48 对照——包体约 1/3 且 Vue
 * 原生，但连线需自写 Handle/标签编辑/校验回调，而状态图编辑所需的锚点连线/双击改名/网格对齐/
 * 键盘删除/JSON 序列化 LogicFlow 开箱即有，映射器两者同为浅层；内网管理台取开箱能力与中文生态）。
 */
import { nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import { ElAlert, ElBadge, ElButton, ElMessage, ElPopover, ElTag } from 'element-plus'
import LogicFlow from '@logicflow/core'
import '@logicflow/core/lib/style/index.css'
import stateNode from './nodes/stateNode'
import { autoLayout } from './layout'
import { lintGraph } from './lint'
import { fromGraph, nextStateName, positionsOf, toGraph } from './mapper'
import {
  STATE_EDGE_TYPE, STATE_NODE_TYPE,
  type Adjacency, type FromGraphResult, type GraphError, type LintIssue, type Positions, type RawGraphData,
} from './types'

const props = defineProps<{
  /** 布局偏好的 localStorage 键维度（按类型分开记坐标） */
  typeCode: string
}>()
const emit = defineEmits<{ change: [] }>()

const containerRef = ref<HTMLDivElement>()
const lf = shallowRef<LogicFlow>()
const issues = ref<LintIssue[]>([])
const errors = ref<GraphError[]>([])
const loaded = ref(false)
let resizeObserver: ResizeObserver | undefined

// ─── 布局偏好（本地视图，非数据）───
const layoutKey = () => `zz.flowgraph.layout.${props.typeCode}`
function readPositions(): Positions {
  try {
    const raw = localStorage.getItem(layoutKey())
    return raw ? (JSON.parse(raw) as Positions) : {}
  } catch {
    return {}
  }
}
function savePositions(g: RawGraphData) {
  try {
    localStorage.setItem(layoutKey(), JSON.stringify(positionsOf(g)))
  } catch {
    // 配额/隐私模式：布局是偏好不是数据，静默即可
  }
}

// ─── 画布实例 ───
function ensureLf(): LogicFlow {
  if (lf.value) return lf.value
  const el = containerRef.value
  if (!el) throw new Error('FlowGraphDesigner 容器未挂载')
  const inst = new LogicFlow({
    container: el,
    grid: { size: 10, visible: true, type: 'dot' },
    keyboard: { enabled: true },
    snapline: true,
    textEdit: true,
    adjustEdge: true,
    allowRotate: false,
    allowResize: false,
    edgeType: STATE_EDGE_TYPE,
    history: true,
    stopScrollGraph: true,
    style: {
      polyline: { stroke: '#8c8c8c', strokeWidth: 1.5 },
      arrow: { offset: 8, verticalLength: 4 },
      anchor: { r: 4, stroke: '#409eff', fill: '#fff', hover: { r: 6 } },
      snapline: { stroke: '#409eff', strokeWidth: 1 },
    },
  })
  inst.register(stateNode)
  inst.on('text:update', recompute)
  inst.on('node:add', recompute)
  inst.on('node:delete', recompute)
  inst.on('edge:add', recompute)
  inst.on('edge:delete', recompute)
  inst.on('node:drop', () => savePositions(graphData()))
  inst.on('connection:not-allowed', ({ msg }) => ElMessage.warning(msg ?? '不允许的连线'))
  resizeObserver = new ResizeObserver(() => inst.resize())
  resizeObserver.observe(el)
  lf.value = inst
  return inst
}

function graphData(): RawGraphData {
  return ensureLf().getGraphData() as RawGraphData
}

function markInvalid(r: FromGraphResult) {
  const bad = new Set(r.ok ? [] : r.errors.map((e) => e.nodeId).filter(Boolean))
  const inst = ensureLf()
  for (const n of graphData().nodes) {
    const model = inst.getNodeModelById(n.id)
    if (!model) continue
    const want = bad.has(n.id)
    if (!!model.properties?.invalid !== want) model.setProperties({ invalid: want })
  }
}

function recompute() {
  const r = fromGraph(graphData())
  errors.value = r.ok ? [] : r.errors
  issues.value = r.ok ? lintGraph(r.states, r.transitions) : []
  markInvalid(r)
  emit('change')
}

// ─── 对外命令 ───
/** 加载邻接表到画布（前置条件：validateTypeGraph 已通过——悬空端点 toGraph 会 throw，由调用方先拦） */
async function load(states: string[], transitions: Adjacency) {
  await nextTick()
  const inst = ensureLf()
  inst.resize()
  inst.render(toGraph(states, transitions, readPositions()))
  loaded.value = true
  recompute()
}

/** 画布 → 邻接表（同时落一次布局偏好） */
function serialize(): FromGraphResult {
  const g = graphData()
  savePositions(g)
  return fromGraph(g)
}

function currentIssues(): LintIssue[] {
  return issues.value
}

function addState() {
  const inst = ensureLf()
  const g = graphData()
  const name = nextStateName(g.nodes.map((n) => (typeof n.text === 'string' ? n.text : n.text?.value ?? '')))
  // 落在现有节点最右侧一列的下方，避免叠在已有节点上
  const maxX = g.nodes.reduce((m, n) => Math.max(m, n.x ?? 0), 0)
  const node = inst.addNode({ type: STATE_NODE_TYPE, x: maxX > 0 ? maxX + 210 : 120, y: 70, text: name })
  inst.selectElementById(node.id)
  inst.editText(node.id)
}

function deleteSelected() {
  const inst = ensureLf()
  const { nodes, edges } = inst.getSelectElements()
  if (!nodes.length && !edges.length) {
    ElMessage.info('先点选节点或连线')
    return
  }
  for (const e of edges) inst.deleteEdge(e.id)
  for (const n of nodes) inst.deleteNode(n.id)
}

function relayout() {
  const r = fromGraph(graphData())
  if (!r.ok) {
    ElMessage.warning('请先修正图中的错误再自动布局')
    return
  }
  const inst = ensureLf()
  const pos = autoLayout(r.states, r.transitions)
  for (const n of graphData().nodes) {
    const name = typeof n.text === 'string' ? n.text : n.text?.value
    const p = name ? pos[name.trim()] : undefined
    if (p) inst.getNodeModelById(n.id)?.moveTo(p.x, p.y, true)
  }
  savePositions(graphData())
  fitView()
}

function fitView() {
  const inst = ensureLf()
  inst.resetZoom()
  inst.translateCenter()
}

function locate(state: string) {
  const inst = ensureLf()
  const n = graphData().nodes.find((x) => (typeof x.text === 'string' ? x.text : x.text?.value ?? '').trim() === state)
  if (!n) return
  inst.clearSelectElements()
  inst.selectElementById(n.id)
  inst.focusOn(n.id)
}

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  lf.value?.destroy()
  lf.value = undefined
})

defineExpose<{
  load: typeof load
  serialize: typeof serialize
  issues: typeof currentIssues
  locate: typeof locate
}>({ load, serialize, issues: currentIssues, locate })
</script>

<style scoped>
.fg-designer { display: flex; flex-direction: column; gap: 8px; }
.fg-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.fg-hint { font-size: 12px; color: var(--el-text-color-secondary); margin-left: 4px; }
.fg-spacer { flex: 1; }
.fg-badge { margin-right: 6px; }
.fg-canvas {
  height: 440px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-bg-color);
  overflow: hidden;
}
.fg-errors { margin: 0; }
.fg-legend { display: flex; gap: 16px; font-size: 12px; color: var(--el-text-color-secondary); }
.fg-dot { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 4px; vertical-align: -1px; border: 1.5px solid; }
.fg-dot--start { background: #f0f9eb; border-color: #67c23a; }
.fg-dot--terminal { background: #f4f4f5; border-color: #909399; }
.fg-dot--normal { background: #ecf5ff; border-color: #409eff; }
.fg-issues { font-size: 13px; }
.fg-issues-title { color: var(--el-text-color-secondary); margin-bottom: 6px; font-size: 12px; }
.fg-issue { padding: 4px 6px; border-radius: 4px; line-height: 1.5; }
.fg-issue--clickable { cursor: pointer; }
.fg-issue--clickable:hover { background: var(--el-fill-color-light); color: var(--el-color-primary); }
</style>
