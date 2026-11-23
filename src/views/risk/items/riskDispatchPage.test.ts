import { reactive, ref, type VNode } from 'vue'
import { expect, it, vi } from 'vitest'
import { preparePage, renderPage, setupPage } from '@/test/sfcHarness'
import * as contracts from '@/api/risk/contracts'
import type { RiskViewDto } from '@/api/risk/contracts'
import * as riskReads from './riskReads'
import * as riskWrites from './riskWrites'
import source from './index.vue?raw'

preparePage(source)

const components = Object.fromEntries([
  'ElAlert', 'ElButton', 'ElCard', 'ElCheckbox', 'ElDatePicker', 'ElDescriptions', 'ElDescriptionsItem', 'ElDialog',
  'ElDrawer', 'ElEmpty', 'ElForm', 'ElFormItem', 'ElInput', 'ElOption', 'ElSelect', 'ElTag',
].map(name => [name, { name }]))
const ProTable = { name: 'ProTable' }
const DispatchDialog = { name: 'DispatchDialog' }
const riskRow = (): RiskViewDto => ({
  risk: { id: '9007199254740993', human_key: 'RISK-SYNTHETIC-01', revision: '9007199254740995' },
  title: '合成风险', status: 'assessed', closure_kind: null, level: 'high',
  owner_user_id: '9007199254740997', org_id: '91001', affected_org_id: '91002',
  deadline: '2026-12-01T08:00:00Z', init_deadline: '2026-12-01T08:00:00Z', treatment: 'mitigate',
  source_severity: null, asset_ref: { provider: 'synthetic', external_id: 'asset-01' }, dispatch_blockers: [],
})

function nodes(value: unknown): VNode[] {
  if (Array.isArray(value)) return value.flatMap(nodes)
  if (!value || typeof value !== 'object') return []
  const node = value as VNode
  const children = node.children
  if (Array.isArray(children)) return [node, ...nodes(children)]
  if (children && typeof children === 'object') {
    return [node, ...['default', 'search', 'toolbar'].flatMap(name => {
      const slot = (children as Record<string, unknown>)[name]
      if (typeof slot !== 'function') return []
      try { return nodes(slot()) } catch { return [] }
    })]
  }
  return [node]
}

function setup(buttonCodes = ['risk:manage']) {
  const codes = ref(buttonCodes)
  const routes = ref(['/risks'])
  const rows = [riskRow()]
  const reader = { list: vi.fn().mockResolvedValue({ items: rows, total: 1 }), detail: vi.fn(), operation: vi.fn() }
  const push = vi.fn()
  const props = reactive({ reader })
  const { page, lifecycle } = setupPage(source, {
    'element-plus': components,
    'vue-router': { useRouter: () => ({ push }) },
    '@/components/ProTable/index.vue': ProTable,
    './DispatchDialog.vue': DispatchDialog,
    '@/common/auth': { usePermission: () => ({
      hasPerm: (code: string) => codes.value.includes(code),
      hasRoute: (path: string) => routes.value.includes(path),
    }) },
    '@/api/risk/contracts': contracts,
    '@/api/risk': { riskHttpReader: reader, riskHttpWriter: {} },
    '@/api/risk/operationKey': { newRiskOperationId: () => 'synthetic-operation' },
    './riskReads': riskReads,
    './riskWrites': riskWrites,
  }, props)
  const render = () => renderPage(source, page, props)
  const all = () => nodes(render())
  const byTestId = (id: string) => all().find(node => node.props?.['data-testid'] === id)
  const dialog = () => all().find(node => node.type === DispatchDialog)
  const table = () => all().find(node => node.type === ProTable)!
  const checkbox = (row: RiskViewDto) => {
    const slot = (table().children as Record<string, (args: { row: RiskViewDto }) => VNode[]>).dispatchSelect
    return slot && nodes(slot({ row })).find(node => node.type === components.ElCheckbox)
  }
  const select = (row = rows[0]) => checkbox(row)!.props!['onUpdate:modelValue'](true)
  const setTarget = (org = '9223372036854775807', type = 'synthetic_remediation') => {
    byTestId('dispatch-target-org')!.props!['onUpdate:modelValue'](org)
    byTestId('dispatch-target-type')!.props!['onUpdate:modelValue'](type)
  }
  const load = () => page.fetchPage({ page: 1, page_size: 20 })
  return { page, codes, routes, rows, reader, push, lifecycle, all, byTestId, checkbox, select, setTarget, dialog, load }
}

it('成功列表可勾选精确风险版本，派单入口绑定目标与资产责任期限快照', async () => {
  const h = setup()
  await h.load()
  expect(h.checkbox(h.rows[0])).toBeDefined()
  h.select()
  h.setTarget(' 9223372036854775807 ', ' synthetic_remediation ')
  expect(h.byTestId('risk-dispatch-open')!.props!.disabled).toBe(false)
  h.byTestId('risk-dispatch-open')!.props!.onClick()
  expect(h.dialog()!.props).toMatchObject({
    modelValue: true, 'can-read': true, 'can-dispatch': true,
    'target-org-id': '9223372036854775807', 'target-type-code': 'synthetic_remediation',
    items: [{ risk_id: '9007199254740993', expected_revision: '9007199254740995' }],
    'item-details': [{ owner_user_id: '9007199254740997', deadline: '2026-12-01T08:00:00Z', asset_ref: { provider: 'synthetic', external_id: 'asset-01' } }],
  })
  h.rows[0].risk.revision = '9'
  h.rows[0].asset_ref!.external_id = 'changed-after-open'
  expect(h.dialog()!.props!.items).toEqual([{ risk_id: '9007199254740993', expected_revision: '9007199254740995' }])
  expect(h.dialog()!.props!['item-details'][0].asset_ref.external_id).toBe('asset-01')
})

it('未选择或组织非法不能打开新派单，未出现在当前读面及旧版本不能勾选', async () => {
  const h = setup()
  await h.load()
  h.setTarget()
  expect(h.byTestId('risk-dispatch-open')!.props!.disabled).toBe(true)
  h.select({ ...riskRow(), risk: { id: '8', revision: '1', human_key: 'SYNTHETIC-HIDDEN' } })
  h.select({ ...riskRow(), risk: { ...riskRow().risk, revision: '1' } })
  expect(h.byTestId('risk-dispatch-open')!.props!.disabled).toBe(true)
  h.select()
  for (const org of ['0', '01', '9223372036854775808', 'not-an-id']) {
    h.setTarget(org)
    expect(h.byTestId('risk-dispatch-open')!.props!.disabled).toBe(true)
    h.byTestId('risk-dispatch-open')!.props!.onClick()
    expect(h.dialog()!.props!.modelValue).toBe(false)
  }
})

it('重读与筛选撤销列表选择，已打开的派单快照不随刷新改绑', async () => {
  const h = setup()
  await h.load()
  h.select()
  h.setTarget()
  h.byTestId('risk-dispatch-open')!.props!.onClick()
  h.reader.list.mockResolvedValueOnce({ items: [{ ...riskRow(), risk: { ...riskRow().risk, revision: '7' } }], total: 1 })
  await h.load()
  expect(h.byTestId('risk-dispatch-open')!.props!.disabled).toBe(true)
  expect(h.dialog()!.props!.items).toEqual([{ risk_id: '9007199254740993', expected_revision: '9007199254740995' }])
  h.select({ ...riskRow(), risk: { ...riskRow().risk, revision: '7' } })
  expect(h.byTestId('risk-dispatch-open')!.props!.disabled).toBe(false)
  h.page.filters.value.q = '新的筛选'
  expect(h.byTestId('risk-dispatch-open')!.props!.disabled).toBe(true)
})

it('写权撤销后保留已挂载派单会话和原号只读入口，离页与撤读停止派单读写', async () => {
  const h = setup()
  await h.load()
  h.select()
  h.setTarget()
  h.byTestId('risk-dispatch-open')!.props!.onClick()
  h.dialog()!.props!.onOperation({ operation_id: 'synthetic-original-operation', plan_id: 'synthetic-plan', plan_hash: 'synthetic-hash' })
  h.codes.value = []
  expect(h.byTestId('risk-dispatch-open')).toBeUndefined()
  expect(h.dialog()!.props).toMatchObject({ modelValue: true, 'can-read': true, 'can-dispatch': false })
  h.dialog()!.props!['onUpdate:modelValue'](false)
  h.byTestId('risk-dispatch-progress')!.props!.onClick()
  expect(h.dialog()!.props!.modelValue).toBe(true)
  h.lifecycle.deactivate()
  expect(h.dialog()!.props).toMatchObject({ 'can-read': false, 'can-dispatch': false })
  h.lifecycle.activate()
  expect(h.dialog()!.props!['can-read']).toBe(true)
  h.routes.value = []
  expect(h.dialog()!.props).toMatchObject({ 'can-read': false, 'can-dispatch': false })
  expect(h.byTestId('risk-dispatch-progress')).toBeUndefined()
})

it('仅带授权工单引用且现有 ticket:read 权限的票可按原精确 ID 打开', () => {
  const h = setup(['risk:manage'])
  const ticket = { id: '9007199254740999', ref: 'T-SYNTHETIC' }
  expect(h.dialog()!.props!['can-read-tickets']).toBe(false)
  h.dialog()!.props!.onOpenTicket(ticket)
  expect(h.push).not.toHaveBeenCalled()
  h.codes.value.push('ticket:read')
  expect(h.dialog()!.props!['can-read-tickets']).toBe(true)
  h.dialog()!.props!.onOpenTicket(undefined)
  h.dialog()!.props!.onOpenTicket({ id: '9007199254740999' })
  h.dialog()!.props!.onOpenTicket({ id: '0', ref: 'T-SYNTHETIC' })
  expect(h.push).not.toHaveBeenCalled()
  h.dialog()!.props!.onOpenTicket(ticket)
  expect(h.push).toHaveBeenCalledExactlyOnceWith('/tickets/9007199254740999')
  h.lifecycle.deactivate()
  expect(h.dialog()!.props!['can-read-tickets']).toBe(false)
  h.dialog()!.props!.onOpenTicket(ticket)
  expect(h.push).toHaveBeenCalledTimes(1)
})

it('派单回执刷新风险列表，读者不获得新派单入口', () => {
  const h = setup([])
  const refresh = vi.fn()
  h.page.table.value = { refresh }
  expect(h.byTestId('risk-dispatch-open')).toBeUndefined()
  expect(h.byTestId('dispatch-target-org')).toBeUndefined()
  expect(h.dialog()!.props).toMatchObject({ 'can-read': true, 'can-dispatch': false, modelValue: false })
  h.dialog()!.props!.onResult({ operation_id: 'synthetic-operation', plan_id: 'synthetic-plan', status: 'completed', groups: [] })
  expect(refresh).toHaveBeenCalledExactlyOnceWith()
})

it.each([null, undefined])('合法空阻断标记 %s 的列表风险仍可选择并交给派单预览', async blockers => {
  const h = setup()
  h.reader.list.mockResolvedValueOnce({ items: [{ ...riskRow(), dispatch_blockers: blockers }], total: 1 })
  await h.load()
  expect(() => h.select()).not.toThrow()
  h.setTarget()
  h.byTestId('risk-dispatch-open')!.props!.onClick()
  expect(h.dialog()!.props!['item-details'][0].dispatch_blockers).toEqual([])
})
