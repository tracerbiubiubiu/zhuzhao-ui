import { ref, type Ref, type VNode } from 'vue'
import { expect, it, vi } from 'vitest'
import { findNode, httpError, renderPage, setupPage } from '@/test/sfcHarness'
import { resolveViewComponent } from '@/store/modules/permissionRoutes'
import * as contracts from '@/api/risk/contracts'
import * as riskReads from './riskReads'
import * as riskWrites from './riskWrites'
import type { RiskReader, RiskReceiptDto, RiskState, RiskViewDto, RiskWriter } from '@/api/risk/contracts'
import source from './index.vue?raw'

const row: RiskViewDto = {
  risk: { id: '9007199254740993', human_key: 'RISK-20261122-0001', revision: '1' },
  title: '合成漏洞',
  status: 'new',
  closure_kind: null,
  level: null,
  owner_user_id: null,
  org_id: '91001',
  affected_org_id: '91002',
  deadline: null,
  init_deadline: null,
  treatment: null,
  source_severity: null,
  asset_ref: null,
  dispatch_blockers: ['owner_unconfirmed'],
}
const remediatingRow: RiskViewDto = {
  ...row,
  risk: { ...row.risk, id: '9007199254740995', human_key: 'RISK-20261122-0002', revision: '5' },
  status: 'remediating',
  level: 'high',
  owner_user_id: '92002',
  dispatch_blockers: [],
}
// 候选详情实势：RiskDetailView.view 包裹列表行（risk_item.go）。
const detail = {
  view: row,
  description: '合成详情',
  system_ref: '',
  evidence_refs: null,
  attributes: {},
  source_summary: null,
}
// 候选写回执实势：receipt_ref 为 RiskReceipt 对象；查回时 replayed 恒 true。
const receiptOf = (operationId: string, command: RiskReceiptDto['command'], status: RiskState): RiskReceiptDto => ({
  operation_id: operationId,
  command,
  status,
  risk_id: row.risk.id,
  revision: '1',
  created_at: '2026-11-22T08:00:00Z',
  replayed: true,
})
const components = Object.fromEntries([
  'ElAlert', 'ElButton', 'ElCard', 'ElCheckbox', 'ElDatePicker', 'ElDescriptions', 'ElDescriptionsItem', 'ElDialog',
  'ElDrawer', 'ElEmpty', 'ElForm', 'ElFormItem', 'ElInput', 'ElOption', 'ElSelect', 'ElTag',
].map(name => [name, { name }]))
const ProTable = { name: 'ProTable' }

function findNodes(node: unknown, predicate: (node: VNode) => boolean, out: VNode[] = []): VNode[] {
  if (Array.isArray(node)) {
    for (const item of node) findNodes(item, predicate, out)
    return out
  }
  if (!node || typeof node !== 'object') return out
  const vnode = node as VNode
  if (predicate(vnode)) out.push(vnode)
  const children = vnode.children
  if (Array.isArray(children)) for (const child of children) findNodes(child, predicate, out)
  else if (children && typeof children === 'object' && typeof (children as { default?: unknown }).default === 'function') {
    try {
      findNodes((children as { default: () => unknown }).default(), predicate, out)
    } catch {
      /* 带行参的插槽（如 actions 的 { row }）不能无参调用，跳过 */
    }
  }
  return out
}

function nodeText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(nodeText).join('')
  if (typeof node === 'object') {
    const children = (node as VNode).children
    if (typeof children === 'function') {
      try {
        return nodeText((children as () => unknown)())
      } catch {
        return ''
      }
    }
    if (children && typeof children === 'object' && typeof (children as { default?: unknown }).default === 'function') {
      try {
        return nodeText((children as { default: () => unknown }).default())
      } catch {
        return ''
      }
    }
    return nodeText(children)
  }
  return ''
}

function slotChildren(node: VNode, name: string): VNode[] {
  const slot = (node.children as Record<string, (() => VNode[]) | undefined>)?.[name]
  return typeof slot === 'function' ? slot() : []
}

function networkError() {
  return Object.assign(new Error('合成断网'), { code: 'ECONNABORTED' })
}

interface Harness {
  reader: { list: ReturnType<typeof vi.fn>, detail: ReturnType<typeof vi.fn>, operation: ReturnType<typeof vi.fn> }
  writer: { create: ReturnType<typeof vi.fn>, assess: ReturnType<typeof vi.fn>, assign: ReturnType<typeof vi.fn> }
  codes: Ref<string[]>
  routes: Ref<string[]>
  page: Record<string, unknown> & {
    table: { value?: { refresh: ReturnType<typeof vi.fn> } }
    draft: Ref
    filters: Ref
    fetchPage: (params: { page: number, page_size: number }) => Promise<unknown>
    openRegistration: () => void
    closeRegistration: () => void
    submitRegistration: () => Promise<void>
    verifyCreate: () => Promise<void>
    openAssess: (row: RiskViewDto) => void
    closeAssess: () => void
    submitAssess: () => Promise<void>
    verifyAssess: () => Promise<void>
    openAssign: (row: RiskViewDto) => void
    closeAssign: () => void
    submitAssign: () => Promise<void>
    verifyAssign: () => Promise<void>
    openDetail: (id: string) => Promise<void>
    assessTarget: Ref
    assessForm: { level: string, note: string, treatment: string, deadline: Date | null }
    assignForm: { owner: string, reason: string }
    createSession: Ref
    assessSession: Ref
    verifyNote: Ref
    verifying: Ref
    list: Ref
    detail: Ref
  }
  lifecycle: { mount: () => void }
  render: () => VNode
  cardBody: () => VNode[]
  table: () => VNode | undefined
  slots: () => Record<string, (args: { row: RiskViewDto }) => VNode[]>
  dialogs: () => VNode[]
}

function setup(buttonCodes: string[], options: { reader?: RiskReader, writer?: RiskWriter, list?: RiskViewDto[] } = {}) {
  const codes = ref(buttonCodes)
  const routes = ref(['/risks'])
  let opSeq = 0
  const reader = options.reader ?? {
    list: vi.fn().mockResolvedValue({ items: options.list ?? [row], total: (options.list ?? [row]).length }),
    detail: vi.fn().mockResolvedValue(detail),
    operation: vi.fn(),
  }
  const writer = options.writer ?? {
    create: vi.fn().mockResolvedValue({ risk: row.risk, status: 'new', receipt_ref: receiptOf('op-01', 'create', 'new') }),
    assess: vi.fn().mockResolvedValue({
      risk: row.risk, status: 'assessed', level: 'high', deadline: null, receipt_ref: receiptOf('op-01', 'assess', 'assessed'),
    }),
    assign: vi.fn().mockResolvedValue({ risk: row.risk, receipt_ref: receiptOf('op-01', 'assign', 'remediating') }),
  }
  const props: { reader?: RiskReader, writer?: RiskWriter } = options
  const { page, lifecycle } = setupPage(source, {
    'element-plus': components,
    'vue-router': { useRouter: () => ({ push: vi.fn() }) },
    '@/components/ProTable/index.vue': ProTable,
    './DispatchDialog.vue': { name: 'DispatchDialog' },
    '@/common/auth': {
      usePermission: () => ({
        hasPerm: (code: string) => codes.value.includes(code),
        hasRoute: (path: string) => routes.value.includes(path),
      }),
    },
    '@/api/risk/contracts': contracts,
    '@/api/risk': { riskHttpReader: reader, riskHttpWriter: writer },
    '@/api/risk/operationKey': { newRiskOperationId: () => `op-${String(++opSeq).padStart(2, '0')}` },
    './riskReads': riskReads,
    './riskWrites': riskWrites,
  }, props)
  const render = () => renderPage(source, page, props)
  const cardBody = (): VNode[] => findNode(render(), node => node.type === components.ElCard)!.children.default()
  const table = () => cardBody().find(node => node.type === ProTable)
  const slots = () => table()?.children as unknown as Record<string, (args: { row: RiskViewDto }) => VNode[]>
  const dialogs = () => findNodes(render(), node => node.type === components.ElDialog)
  const dialogByTitle = (title: string) => dialogs().find(node => node.props?.title === title)
  const harness = {
    reader, writer, codes, routes, page, lifecycle, render, cardBody, table, slots, dialogs, dialogByTitle,
  } as unknown as Harness & { dialogByTitle: (title: string) => VNode | undefined }
  return harness
}

/** 渲染对话框默认插槽 + footer 插槽的全部文本（含按钮文案）。 */
function dialogText(node: VNode | undefined): string {
  if (!node) return ''
  return nodeText(node) + nodeText(slotChildren(node, 'footer'))
}

function footerButtons(node: VNode | undefined): VNode[] {
  return node ? findNodes(slotChildren(node, 'footer'), child => child.type === components.ElButton) : []
}

const registrationDraft = {
  title: '合成漏洞', description: '', org_id: '91001', affected_org_id: '', owner_user_id: '',
}

it('菜单组件路径可由现有解析器识别', () => {
  expect(resolveViewComponent('risk/items/index')).toBeTypeOf('function')
})

it('默认走真实请求端口：未注入替身时读取由 @/api/risk 默认适配器承担', async () => {
  const harness = setup([])
  const refresh = vi.fn()
  harness.page.table.value = { refresh }
  harness.lifecycle.mount()
  await expect(harness.page.fetchPage({ page: 1, page_size: 20 })).resolves.toEqual({ list: [row], total: 1 })
  expect(harness.reader.list).toHaveBeenCalledWith({ page: 1, page_size: 20 }, expect.any(AbortSignal))
  expect(harness.page.list.value).toEqual({ kind: 'ready' })
})

it('页面读入口按菜单路由 route:/risks 判定，非按钮码 risk:read', async () => {
  // 页面行（route:/risks）不授 button:risk:read：仅按钮码存在而路由缺失时表格不可见、呈现无权提示
  const noRoute = setup([])
  noRoute.routes.value = []
  expect(noRoute.table()).toBeUndefined()
  const alerts = findNodes(noRoute.render(), node => node.type === components.ElAlert)
  expect(alerts.map(node => node.props?.title)).toContain('无权查看')
  const granted = setup([])
  expect(granted.table()).toBeDefined()
  await granted.page.openDetail(row.risk.id)
  expect(granted.reader.detail).toHaveBeenCalledTimes(1)
})

it('只读态只呈现读面，写按钮与对话框不出现', () => {
  const readonly = setup([])
  expect(readonly.table()).toBeDefined()
  const actions = findNodes(readonly.slots()!.actions({ row }), node => node.type === 'button')
  expect(actions.map(node => node.props!['aria-label'])).toEqual(['查看 RISK-20261122-0001 详情'])
  expect(readonly.dialogs()).toEqual([])

  const managed = setup(['risk:manage'])
  const managedActions = findNodes(managed.slots()!.actions({ row }), node => node.type === 'button')
  expect(managedActions.map(node => node.props!['aria-label'])).toEqual([
    '查看 RISK-20261122-0001 详情', '核实 RISK-20261122-0001', '指定 RISK-20261122-0001 责任人',
  ])
})

it('核实动作按现势状态开放：仅 new|assessed 行出现核实按钮', () => {
  const harness = setup(['risk:manage'], { list: [row, remediatingRow] })
  const forRow = (item: RiskViewDto) => findNodes(harness.slots()!.actions({ row: item }), node => node.type === 'button')
    .map(node => node.props!['aria-label'])
  expect(forRow(remediatingRow)).toEqual(['查看 RISK-20261122-0002 详情', '指定 RISK-20261122-0002 责任人'])
  harness.page.openAssess(remediatingRow)
  expect(harness.page.assessTarget.value).toBeNull()
  harness.page.openAssess(row)
  expect(harness.page.assessTarget.value).toMatchObject({ id: row.risk.id, revision: '1' })
})

it('责任待确认按现势标记渲染，已确认责任显示 ID', () => {
  const harness = setup([], { list: [row, remediatingRow] })
  const tagsOf = (item: RiskViewDto) => findNodes(harness.slots()!.owner({ row: item }), node => node.type === components.ElTag).map(nodeText)
  expect(tagsOf(row)).toEqual(['责任待确认'])
  expect(tagsOf(remediatingRow)).toEqual([])
})

it('登记提交携带原号与 expected_revision "0"，成功后关闭并刷新', async () => {
  const harness = setup(['risk:manage'])
  const refresh = vi.fn()
  harness.page.table.value = { refresh }
  harness.page.openRegistration()
  await harness.page.submitRegistration()
  expect(harness.writer.create).not.toHaveBeenCalled()

  harness.page.draft.value = {
    title: '合成漏洞', description: '说明', org_id: '91001', affected_org_id: '91002', owner_user_id: '92002',
  }
  await harness.page.submitRegistration()
  expect(harness.writer.create).toHaveBeenCalledTimes(1)
  expect(harness.writer.create.mock.calls[0][0]).toEqual({
    operation_id: 'op-01',
    title: '合成漏洞',
    description: '说明',
    org_id: '91001',
    affected_org_id: '91002',
    owner_user_id: '92002',
    expected_revision: '0',
    attributes: {},
  })
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('响应未知保留原号：关闭重开回填，重投使用同一操作号与同一输入', async () => {
  const harness = setup(['risk:manage'])
  harness.writer.create.mockRejectedValueOnce(networkError())
  const submitted = {
    title: '合成漏洞', description: '说明', org_id: '91001', affected_org_id: '91002', owner_user_id: '92002',
  }
  harness.page.draft.value = submitted
  await harness.page.submitRegistration()
  expect(harness.page.createSession.value).toMatchObject({ phase: 'unknown', operationId: 'op-01' })

  harness.page.closeRegistration()
  expect(harness.page.draft.value).toEqual(submitted)
  harness.page.openRegistration()
  expect(harness.page.draft.value).toEqual(submitted)
  await harness.page.submitRegistration()
  expect(harness.writer.create).toHaveBeenCalledTimes(2)
  expect(harness.writer.create.mock.calls[1][0]).toEqual(harness.writer.create.mock.calls[0][0])
  expect(harness.writer.create.mock.calls[1][0].operation_id).toBe('op-01')
})

it('待处理界面渲染后发生网络错误时，切换到同号只读核查', async () => {
  const harness = setup(['risk:manage'])
  let rejectWrite: (reason: unknown) => void = () => undefined
  harness.writer.create.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectWrite = reject }))
  harness.page.draft.value = registrationDraft
  const pending = harness.page.submitRegistration()
  const inFlight = harness.dialogByTitle('登记风险')
  expect(dialogText(inFlight)).toContain('提交中')
  const fields = findNodes(inFlight!, node => node.type === components.ElInput)
  expect(fields.length).toBeGreaterThan(0)
  expect(fields.every(node => node.props?.disabled === true)).toBe(true)
  harness.page.draft.value = { ...registrationDraft, title: '另一份草稿' }
  rejectWrite(networkError())
  await pending
  const dialog = harness.dialogByTitle('登记风险')
  expect(dialogText(dialog)).toContain('op-01')
  expect(dialogText(dialog)).toContain('只读核查')
  expect(dialogText(dialog)).not.toContain('提交中')
  expect(harness.page.draft.value).toEqual(registrationDraft)
})

it('5xx 提交同属未知：未知态显示原号并提供只读核查', async () => {
  const harness = setup(['risk:manage'])
  harness.writer.create.mockRejectedValueOnce(httpError(503, '依赖不可用'))
  harness.page.draft.value = registrationDraft
  await harness.page.submitRegistration()
  expect(harness.page.createSession.value).toMatchObject({ phase: 'unknown', operationId: 'op-01' })

  const dialog = harness.dialogByTitle('登记风险')!
  expect(dialogText(dialog)).toContain('op-01')
  const verify = footerButtons(dialog).find(node => nodeText(node).includes('只读核查'))
  expect(verify).toBeDefined()
  expect(nodeText(dialog)).toContain('待核查')
  // 未知态输入锁定：原号重投与放弃可用，但无重做新号入口
  const labels = footerButtons(dialog).map(node => nodeText(node))
  expect(labels).toContain('放弃此次提交')
  expect(labels.join()).toContain('原号重投')
})

it('只读核查同号同命令：确认提交生效，销毁会话并刷新', async () => {
  const harness = setup(['risk:manage'])
  const refresh = vi.fn()
  harness.page.table.value = { refresh }
  harness.writer.create.mockRejectedValueOnce(networkError())
  harness.reader.operation.mockResolvedValue(receiptOf('op-01', 'create', 'new'))
  harness.page.draft.value = registrationDraft
  await harness.page.submitRegistration()
  await harness.page.verifyCreate()
  expect(harness.reader.operation).toHaveBeenCalledWith('op-01')
  expect(harness.page.createSession.value).toBeUndefined()
  expect(harness.page.verifyNote.value).toBe('')
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(harness.dialogByTitle('登记风险')?.props?.['model-value']).toBe(false)
  expect(harness.writer.create).toHaveBeenCalledTimes(1)
})

it('只读核查读回 404 或网络失败：保持待核查，原号不更换且不重做', async () => {
  const harness = setup(['risk:manage'])
  const refresh = vi.fn()
  harness.page.table.value = { refresh }
  harness.writer.create.mockRejectedValueOnce(networkError())
  harness.reader.operation.mockRejectedValueOnce(httpError(404))
  harness.page.draft.value = registrationDraft
  await harness.page.submitRegistration()
  await harness.page.verifyCreate()
  expect(harness.page.createSession.value).toMatchObject({ phase: 'unknown', operationId: 'op-01' })
  expect(harness.page.verifyNote.value).toContain('待核查')
  expect(refresh).not.toHaveBeenCalled()
  expect(harness.writer.create).toHaveBeenCalledTimes(1)

  harness.reader.operation.mockRejectedValueOnce(networkError())
  await harness.page.verifyCreate()
  expect(harness.page.createSession.value).toMatchObject({ phase: 'unknown', operationId: 'op-01' })
  expect(harness.page.verifyNote.value).toContain('核查请求失败')
  expect(harness.writer.create).toHaveBeenCalledTimes(1)
})

it('只读核查回执与本次命令不一致：保持待核查且不刷新', async () => {
  const harness = setup(['risk:manage'])
  const refresh = vi.fn()
  harness.page.table.value = { refresh }
  harness.writer.create.mockRejectedValueOnce(networkError())
  harness.reader.operation.mockResolvedValue(receiptOf('op-01', 'assign', 'remediating'))
  harness.page.draft.value = registrationDraft
  await harness.page.submitRegistration()
  await harness.page.verifyCreate()
  expect(harness.page.createSession.value).toMatchObject({ phase: 'unknown', operationId: 'op-01' })
  expect(harness.page.verifyNote.value).toContain('不一致')
  expect(refresh).not.toHaveBeenCalled()
  expect(harness.writer.create).toHaveBeenCalledTimes(1)
})

it('责任确认未知态只读核查：同号同命令确认后刷新', async () => {
  const harness = setup(['risk:manage'])
  const refresh = vi.fn()
  harness.page.table.value = { refresh }
  harness.writer.assign.mockRejectedValueOnce(networkError())
  harness.reader.operation.mockResolvedValue(receiptOf('op-01', 'assign', 'remediating'))
  harness.page.openAssign(row)
  harness.page.assignForm.owner = '92002'
  harness.page.assignForm.reason = '台账核实'
  await harness.page.submitAssign()
  expect(harness.page.assessSession.value).toBeFalsy()
  await harness.page.verifyAssign()
  expect(harness.reader.operation).toHaveBeenCalledWith('op-01')
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(harness.writer.assign).toHaveBeenCalledTimes(1)
  expect(harness.dialogByTitle('指定责任人')?.props?.['model-value']).toBe(false)
})

it('definitive 失败保留原号，改参后换新号提交', async () => {
  const harness = setup(['risk:manage'])
  harness.writer.create.mockRejectedValueOnce(httpError(400, '字段不合法'))
  harness.page.draft.value = registrationDraft
  await harness.page.submitRegistration()
  expect(harness.page.createSession.value).toMatchObject({ phase: 'draft', operationId: 'op-01' })

  await harness.page.submitRegistration()
  expect(harness.writer.create.mock.calls[1][0].operation_id).toBe('op-01')

  harness.page.draft.value = { ...registrationDraft, title: '改名漏洞' }
  await harness.page.submitRegistration()
  expect(harness.writer.create.mock.calls[2][0]).toMatchObject({ operation_id: 'op-02', title: '改名漏洞' })
})

it('在途期间重复提交不产生第二次请求', async () => {
  const harness = setup(['risk:manage'])
  let release!: (value: unknown) => void
  harness.writer.create.mockImplementation(() => new Promise(resolve => { release = resolve }))
  harness.page.draft.value = registrationDraft
  const first = harness.page.submitRegistration()
  await harness.page.submitRegistration()
  expect(harness.writer.create).toHaveBeenCalledTimes(1)
  release({ risk: row.risk, status: 'new', receipt_ref: receiptOf('op-01', 'create', 'new') })
  await first
  expect(harness.page.createSession.value).toBeUndefined()
})

it('核实按行修订提交，成功后刷新并回读详情', async () => {
  const harness = setup(['risk:manage'])
  const refresh = vi.fn()
  harness.page.table.value = { refresh }
  await harness.page.openDetail(row.risk.id)
  expect(harness.reader.detail).toHaveBeenCalledTimes(1)
  harness.page.openAssess(row)
  harness.page.assessForm.level = 'high'
  harness.page.assessForm.note = ' 资产台账核实 '
  harness.page.assessForm.treatment = 'mitigate'
  harness.page.assessForm.deadline = new Date('2026-11-22T17:00:00Z')
  await harness.page.submitAssess()
  expect(harness.writer.assess).toHaveBeenCalledTimes(1)
  expect(harness.writer.assess.mock.calls[0][0]).toEqual({
    operation_id: 'op-01',
    id: row.risk.id,
    expected_revision: '1',
    level: 'high',
    assessment_note: '资产台账核实',
    treatment: 'mitigate',
    deadline: '2026-11-22T17:00:00.000Z',
  })
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(harness.reader.detail).toHaveBeenCalledTimes(2)
})

it('核实与责任确认的未决操作从新修订行重开时仍用原请求体重投', async () => {
  const harness = setup(['risk:manage'])
  const latest = { ...row, risk: { ...row.risk, revision: '2' } }
  harness.writer.assess.mockRejectedValueOnce(networkError())
  harness.page.openAssess(row)
  harness.page.assessForm.level = 'high'
  harness.page.assessForm.note = '首次核实'
  await harness.page.submitAssess()
  harness.page.closeAssess()
  harness.page.openAssess(latest)
  await harness.page.submitAssess()
  expect(harness.writer.assess).toHaveBeenCalledTimes(2)
  expect(harness.writer.assess.mock.calls[1]).toEqual(harness.writer.assess.mock.calls[0])
  expect(harness.writer.assess.mock.calls[1]?.[0].expected_revision).toBe('1')

  harness.writer.assign.mockRejectedValueOnce(networkError())
  harness.page.openAssign(row)
  harness.page.assignForm.owner = '92002'
  harness.page.assignForm.reason = '首次确认'
  await harness.page.submitAssign()
  harness.page.closeAssign()
  harness.page.openAssign(latest)
  await harness.page.submitAssign()
  expect(harness.writer.assign).toHaveBeenCalledTimes(2)
  expect(harness.writer.assign.mock.calls[1]).toEqual(harness.writer.assign.mock.calls[0])
  expect(harness.writer.assign.mock.calls[1]?.[0].expected_revision).toBe('1')
})

it('核实 409 冲突标记会话并回读列表提示比较', async () => {
  const harness = setup(['risk:manage'])
  const refresh = vi.fn()
  harness.page.table.value = { refresh }
  harness.writer.assess.mockRejectedValueOnce(httpError(409, '修订已被他人更新'))
  harness.page.openAssess(row)
  harness.page.assessForm.level = 'high'
  harness.page.assessForm.note = '台账核实'
  await harness.page.submitAssess()
  expect(harness.page.assessSession.value).toMatchObject({ phase: 'draft', conflict: true })
  expect(refresh).toHaveBeenCalledTimes(1)
  const hint = findNodes(harness.render(), node => node.type === 'p'
    && String((node.props as Record<string, unknown>)?.class ?? '').includes('risk-conflict-hint'))
  expect(hint).toHaveLength(1)
  expect(nodeText(hint[0])).toContain('列表已刷新')
})

it('责任确认校验责任人 ID 后按原号提交', async () => {
  const harness = setup(['risk:manage'])
  harness.page.openAssign(row)
  harness.page.assignForm.owner = 'abc'
  harness.page.assignForm.reason = '台账核实'
  await harness.page.submitAssign()
  expect(harness.writer.assign).not.toHaveBeenCalled()

  harness.page.assignForm.owner = ' 92002 '
  await harness.page.submitAssign()
  expect(harness.writer.assign).toHaveBeenCalledTimes(1)
  expect(harness.writer.assign.mock.calls[0][0]).toEqual({
    operation_id: 'op-01', id: row.risk.id, expected_revision: '1', owner_user_id: '92002', reason: '台账核实',
  })
})

it('撤销页面路由后隐藏表格及详情，写权限也无法单独打开登记', async () => {
  const harness = setup(['risk:manage'])
  await harness.page.openDetail(row.risk.id)
  harness.routes.value = []
  await harness.page.openDetail(row.risk.id)
  harness.page.openRegistration()
  expect(harness.reader.detail).toHaveBeenCalledTimes(1)
  expect(harness.table()).toBeUndefined()
  expect(findNode(harness.render(), node => node.type === components.ElDrawer)?.props!['model-value']).toBe(false)
  expect(harness.dialogs()).toEqual([])
})

it('表格详情用原生键盘按钮，抽屉按当前目标打开和关闭', async () => {
  const harness = setup([])
  const button = harness.slots()!.actions({ row }).find(node => node.type === 'button')!
  expect(button.props).toMatchObject({ type: 'button', 'aria-label': '查看 RISK-20261122-0001 详情' })
  await button.props!.onClick()
  expect(harness.reader.detail.mock.calls[0][0]).toBe('9007199254740993')

  const drawer = findNode(harness.render(), node => node.type === components.ElDrawer)
  expect(drawer.props).toMatchObject({ 'model-value': true, direction: 'rtl', 'close-on-press-escape': true })
  drawer.props['onUpdate:modelValue'](false)
  expect(findNode(harness.render(), node => node.type === components.ElDrawer)?.props!['model-value']).toBe(false)
})

it('详情抽屉呈现 view 包裹的候选 RiskView 字段与责任待确认', async () => {
  const harness = setup([])
  await harness.page.openDetail(row.risk.id)
  const drawer = findNode(harness.render(), node => node.type === components.ElDrawer)!
  const descriptions = findNodes(drawer, node => node.type === components.ElDescriptionsItem)
  const labeled = new Map(descriptions.map(node => [nodeText((node.props as Record<string, unknown>)?.label), nodeText(node)]))
  expect(labeled.get('状态')).toContain('待评估')
  expect(labeled.get('整改级别')).toContain('未评估')
  expect(labeled.get('责任')).toContain('责任待确认')
  expect(labeled.get('整改期限')).toBe('—')
  expect(labeled.get('说明')).toContain('合成详情')
})
