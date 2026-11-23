import { reactive, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { deferred, httpError, preparePage, renderPage, setupPage, settle } from '@/test/sfcHarness'
import * as apiError from '@/utils/apiError'
import type { RiskViewDto } from '@/api/risk/contracts'
import source from './DispatchDialog.vue?raw'

preparePage(source)
const planA = () => ({
  plan_id: 'b2de26c7-2544-4716-8703-d4500ac57f33', plan_hash: 'synthetic-plan-hash', expires_at: '2099-01-01T00:00:00Z',
  groups: [
    { group_key: 'group-u', owner_user_id: '71', items: [
      { risk_id: '9007199254740993', revision: '7', human_key: 'R-A', title: '合成资产 A' },
      { risk_id: '102', revision: '8', human_key: 'R-B', title: '合成资产 B' },
    ] },
    { group_key: 'group-v', owner_user_id: '72', items: [{ risk_id: '103', revision: '9', human_key: 'R-C', title: '合成资产 C' }] },
  ], blocked: [],
})
const complete = () => ({ operation_id: 'stable-original', plan_id: planA().plan_id, status: 'completed', groups: [] })
type Page = {
  plan: Ref<ReturnType<typeof planA> | null>
  result: Ref<any>
  confirmed: Ref<boolean>
  busy: Ref<boolean>
  error: Ref<string>
  attempt: Ref<{ operation_id: string; plan_id: string; plan_hash: string } | null>
  uncertain: Ref<boolean>
  canConfirm: Ref<boolean>
  dismissLocked: Ref<boolean>
  inputChanged: Ref<boolean>
  projectedTickets: Ref<number>
  previewGroups: Ref<any[]>
  resultGroups: Ref<any[]>
  statusElement: Ref<{ focus(): void } | null>
  previewButton: Ref<{ $el: { focus(): void } } | null>
  preview(): Promise<void>
  submit(): Promise<void>
  retry(): Promise<void>
  inspect(): Promise<void>
  startNext(): void
  savedOperation: Ref<string>
  verificationNote: Ref<string>
  displayDetails: Ref<any[]>
  close(): void
  focusPreview(event: { preventDefault(): void }): void
  reasonText(reason: string): string
}

function fixture() {
  const props = reactive({ modelValue: true, canDispatch: true, canRead: true, canReadTickets: true, itemDetails: [] as RiskViewDto[], targetOrgId: '9007199254740995', targetTypeCode: 'synthetic_remediation',
    items: [{ risk_id: '9007199254740993', expected_revision: '7' }, { risk_id: '102', expected_revision: '8' }, { risk_id: '103', expected_revision: '9' }] })
  const api = { getDispatchOperation: vi.fn(), planDispatch: vi.fn().mockResolvedValue(planA()), applyDispatch: vi.fn().mockImplementation(async input => ({ ...complete(), ...input })) }
  let generation = 1
  const { page, lifecycle } = setupPage<Page>(source, {
    'element-plus': Object.fromEntries(['ElAlert', 'ElButton', 'ElCheckbox', 'ElDialog', 'ElEmpty', 'ElTag'].map(name => [name, { name }])),
    '@/components/ProTable/index.vue': { name: 'ProTable' }, '@/components/UserNameText/index.vue': { name: 'UserNameText' },
    '@/api/risk/dispatch': api, '@/utils/apiError': apiError,
    '@/common/auth/tokenStorage': { getSessionGeneration: () => generation },
  }, props)
  return { props, api, page, lifecycle, changeSession: () => generation++ }
}

describe('风险派单独立弹窗', () => {
  it('先预览三资产两组两票，确认勾选前不写入；大 ID 与 revision 原样传递', async () => {
    const { props, api, page } = fixture()
    await page.submit()
    expect(api.applyDispatch).not.toHaveBeenCalled()
    await page.preview()
    expect(api.planDispatch).toHaveBeenCalledWith({ items: props.items, target_org_id: '9007199254740995', target_type_code: 'synthetic_remediation' })
    expect(page.projectedTickets.value).toBe(2)
    expect(page.previewGroups.value.map(g => g.items.length)).toEqual([2, 1])
    await page.submit()
    expect(api.applyDispatch).not.toHaveBeenCalled()
    page.confirmed.value = true
    expect(page.canConfirm.value).toBe(true)
    await page.submit()
    expect(api.applyDispatch).toHaveBeenCalledWith({ operation_id: expect.any(String), plan_id: planA().plan_id, plan_hash: 'synthetic-plan-hash' })
    expect(Object.keys(api.applyDispatch.mock.calls[0][0]).sort()).toEqual(['operation_id', 'plan_hash', 'plan_id'])
  })

  it('重复点击在首个 await 前锁住；未知结果与 5xx 不自动重做，原号原 plan 原输入核查', async () => {
    const { api, page, props } = fixture()
    const pending = deferred()
    api.applyDispatch.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(httpError(503, '服务暂不可用'))
    await page.preview()
    page.confirmed.value = true
    const first = page.submit()
    await page.submit()
    expect(api.applyDispatch).toHaveBeenCalledTimes(1)
    expect(page.dismissLocked.value).toBe(true)
    const original = { ...page.attempt.value! }
    pending.reject(new Error('响应丢失'))
    await first
    expect(page.uncertain.value).toBe(true)
    props.items[0].expected_revision = '99'
    props.targetOrgId = '99'
    await settle()
    expect(page.inputChanged.value).toBe(true)
    await page.preview()
    await page.submit()
    expect(api.planDispatch).toHaveBeenCalledTimes(1)
    expect(api.applyDispatch).toHaveBeenCalledTimes(1)
    await page.retry()
    expect(api.applyDispatch.mock.calls.map(c => c[0])).toEqual([original, original])
    expect(page.attempt.value).toEqual(original)
    expect(page.plan.value?.plan_id).toBe(planA().plan_id)
    expect(page.error.value).toContain('原操作')
  })

  it('partial/pending 保留已完成组与失败原因，后续只用原号续查且清除旧授权引用', async () => {
    const { api, page } = fixture()
    api.applyDispatch.mockImplementationOnce(async input => ({ ...input, status: 'partial', groups: [
      { group_key: 'group-u', status: 'completed', ticket: { id: '201', ref: 'T-201' }, items: [{ risk_id: '9007199254740993', result: 'created' }] },
      { group_key: 'group-v', status: 'failed', items: [{ risk_id: '103', result: 'denied', reason: 'dispatch_forbidden' }] },
    ] }))
    await page.preview()
    page.confirmed.value = true
    await page.submit()
    expect(page.resultGroups.value.map(g => g.status)).toEqual(['completed', 'failed'])
    expect(page.dismissLocked.value).toBe(false)
    expect(page.resultGroups.value[1].items[0].reason).toBe('dispatch_forbidden')
    expect(page.reasonText('dispatch_forbidden')).toContain('权限')
    const replay = deferred()
    api.applyDispatch.mockReturnValueOnce(replay.promise)
    const retry = page.retry()
    expect(page.resultGroups.value[0].ticket).toBeUndefined()
    replay.resolve({ ...api.applyDispatch.mock.calls[0][0], status: 'completed', groups: [
      { group_key: 'group-u', status: 'completed', items: [{ risk_id: '9007199254740993', result: 'already_linked' }] },
    ] })
    await retry
    expect(api.applyDispatch.mock.calls[1][0]).toEqual(api.applyDispatch.mock.calls[0][0])
    expect(page.resultGroups.value[0].ticket).toBeUndefined()
    expect(page.resultGroups.value[0].items[0].ticket).toBeUndefined()
    await page.retry()
    expect(api.applyDispatch).toHaveBeenCalledTimes(2)
  })

  it('没有可派分组时展示阻断原因并禁止确认；预览错误可显式重试', async () => {
    const { api, page } = fixture()
    api.planDispatch.mockRejectedValueOnce(httpError(409, '请刷新风险版本'))
    await page.preview()
    expect(page.error.value).toContain('刷新')
    api.planDispatch.mockResolvedValueOnce({ ...planA(), groups: [], blocked: [{ risk_id: '103', reason: 'missing_personal_owner' }] })
    await page.preview()
    expect(page.plan.value?.blocked).toHaveLength(1)
    expect(page.reasonText('missing_personal_owner')).toContain('负责人')
    page.confirmed.value = true
    expect(page.canConfirm.value).toBe(false)
    await page.submit()
    expect(api.applyDispatch).not.toHaveBeenCalled()
  })

  it('预览后的输入变更立即失效；关闭重开的旧预览不能覆盖新 plan', async () => {
    const { api, page, props } = fixture()
    const old = deferred()
    api.planDispatch.mockReturnValueOnce(old.promise)
    const first = page.preview()
    props.modelValue = false
    props.modelValue = true
    props.targetTypeCode = 'synthetic_other'
    await page.preview()
    expect(api.planDispatch).toHaveBeenCalledTimes(2)
    expect(page.plan.value?.plan_id).toBe(planA().plan_id)
    const current = page.plan.value
    old.resolve({ ...planA(), plan_id: 'old-plan' })
    await first
    expect(page.plan.value).toBe(current)
    props.items[0].expected_revision = '10'
    expect(page.plan.value).toBeNull()
    expect(page.confirmed.value).toBe(false)
  })

  it('强制关闭重开也保留未知原号，403 核查失败不能改号或抹掉原请求', async () => {
    const { api, page, props } = fixture()
    api.applyDispatch.mockRejectedValueOnce(httpError(503)).mockRejectedValueOnce(httpError(403, '当前派单权限已撤销'))
    await page.preview()
    page.confirmed.value = true
    await page.submit()
    const original = { ...page.attempt.value! }
    props.modelValue = false
    props.modelValue = true
    await page.retry()
    expect(page.attempt.value).toEqual(original)
    expect(page.uncertain.value).toBe(true)
    expect(page.error.value).toContain('当前派单权限已撤销')
    expect(api.planDispatch).toHaveBeenCalledTimes(1)
  })

  it('提交时复核 props 权限；会话切换后的成功/失败不污染当前弹窗', async () => {
    const { api, page, props, changeSession } = fixture()
    await page.preview()
    page.confirmed.value = true
    props.canDispatch = false
    await page.submit()
    expect(api.applyDispatch).not.toHaveBeenCalled()
    props.canDispatch = true
    const pending = deferred()
    api.applyDispatch.mockReturnValueOnce(pending.promise)
    const first = page.submit()
    changeSession()
    pending.resolve({ ...complete(), ...api.applyDispatch.mock.calls[0][0] })
    await first
    expect(page.result.value).toBeNull()
    expect(page.busy.value).toBe(false)
    expect(page.error.value).toContain('会话')
    await page.retry()
    expect(api.applyDispatch).toHaveBeenCalledTimes(1)
  })

  it('partial 后切换会话再重开会撤销原票引用、允许关闭，保留原号且禁止新会话重投', async () => {
    const { api, page, props, changeSession } = fixture()
    api.applyDispatch.mockImplementationOnce(async input => ({ ...input, status: 'partial', groups: [{ group_key: 'group-u', status: 'completed', ticket: { id: '201', ref: 'T-201' }, items: [{ risk_id: '102', result: 'already_linked', ticket: { id: '305', ref: 'T-305' } }] }] }))
    await page.preview()
    page.confirmed.value = true
    await page.submit()
    const original = { ...page.attempt.value! }
    changeSession()
    props.modelValue = false
    props.modelValue = true
    expect(page.resultGroups.value).toEqual([])
    expect(page.previewGroups.value).toEqual([])
    expect(page.error.value).toContain('会话')
    expect(page.dismissLocked.value).toBe(false)
    expect(page.attempt.value).toEqual(original)
    await page.retry()
    await page.preview()
    expect(api.applyDispatch).toHaveBeenCalledTimes(1)
    expect(api.planDispatch).toHaveBeenCalledTimes(1)
  })

  it('原生状态焦点与 EP 打开焦点可用；模板只从本次回包产生原票引用', async () => {
    const { page, api, props } = fixture()
    const focus = vi.fn(), preventDefault = vi.fn()
    page.previewButton.value = { $el: { focus } }
    page.focusPreview({ preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
    page.statusElement.value = { focus }
    api.applyDispatch.mockImplementationOnce(async input => ({ ...input, status: 'completed', groups: [{
      group_key: 'group-u', status: 'completed', ticket: { id: '201', ref: 'T-201' },
      items: [{ risk_id: '102', result: 'already_linked', ticket: { id: '305', ref: 'T-305' } }],
    }] }))
    await page.preview()
    page.confirmed.value = true
    await page.submit()
    expect(focus.mock.calls.length).toBeGreaterThan(1)
    const tree = renderPage(source, page, props)
    expect(tree.props?.['close-on-click-modal']).toBe(false)
    expect(tree.props?.['close-on-press-escape']).toBe(true)
    // 执行真实模板的 ProTable 引用插槽，不能把预览票或组票猜成逐项原票。
    const body = (tree.children as any).default()
    const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...(Array.isArray(node) ? node.flatMap(nodes) : Array.isArray(node.children) ? node.children.flatMap(nodes) : [])]
    const resultTable = nodes(body).find(n => n.props?.['row-key'] === 'group_key' && n.children?.ticket && n.props?.['data-testid'] === 'dispatch-results')
    expect(resultTable).toBeDefined()
    const ticketSlot = resultTable.children.ticket({ row: page.resultGroups.value[0] })
    expect(nodes(ticketSlot).some(n => n.props?.['data-testid'] === 'authorized-ticket')).toBe(true)
    expect(nodes(resultTable.children.ticket({ row: { group_key: 'hidden' } })).some(n => n.props?.['data-testid'] === 'authorized-ticket')).toBe(false)
    const itemSlot = resultTable.children.items({ row: page.resultGroups.value[0] })
    const itemButton = nodes(itemSlot).find(n => n.props?.['data-testid'] === 'authorized-item-ticket')
    expect(itemButton).toBeDefined()
    expect(nodes(resultTable.children.items({ row: { items: [{ risk_id: '103', result: 'already_linked' }], ticket: { id: '201', ref: 'T-201' } } })).some(n => n.props?.['data-testid'] === 'authorized-item-ticket')).toBe(false)
  })

  it('按钮已算可确认后预览到期，点击时仍拒绝写入并提示重新预览', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2098-12-31T23:59:59Z'))
    const { api, page } = fixture()
    await page.preview()
    page.confirmed.value = true
    expect(page.canConfirm.value).toBe(true)
    vi.setSystemTime(new Date('2099-01-01T00:00:01Z'))
    await page.submit()
    expect(api.applyDispatch).not.toHaveBeenCalled()
    expect(page.error.value).toContain('过期')
  })

  it('错配回执不能终结原操作；pending 响应也只按原号恢复', async () => {
    const { api, page } = fixture()
    api.applyDispatch.mockResolvedValueOnce(complete()).mockImplementationOnce(async input => ({ ...input, status: 'pending', groups: [] }))
    await page.preview()
    page.confirmed.value = true
    await page.submit()
    const original = { ...page.attempt.value! }
    expect(page.result.value).toBeNull()
    expect(page.uncertain.value).toBe(true)
    await page.retry()
    expect(page.result.value.status).toBe('pending')
    expect(page.dismissLocked.value).toBe(false)
    expect(api.applyDispatch.mock.calls.map(c => c[0])).toEqual([original, original])
  })

  it('未知期间继续展示原分组与目标，旧预览票引用不可再激活', async () => {
    const { api, page, props } = fixture()
    api.planDispatch.mockResolvedValueOnce({ ...planA(), groups: [{ ...planA().groups[0], ticket: { id: '201', ref: 'T-201' } }] })
    api.applyDispatch.mockRejectedValueOnce(httpError(503))
    await page.preview()
    page.confirmed.value = true
    await page.submit()
    props.targetOrgId = '99'
    const tree = renderPage(source, page, props)
    const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...(Array.isArray(node) ? node.flatMap(nodes) : Array.isArray(node.children) ? node.children.flatMap(nodes) : [])]
    const body = nodes((tree.children as any).default())
    const table = body.find(n => n.props?.['data-testid'] === 'dispatch-preview')
    expect(table).toBeDefined()
    expect(nodes(table.children.ticket({ row: page.plan.value!.groups[0] })).some(n => n.props?.['data-testid'] === 'authorized-ticket')).toBe(false)
    const status = body.find(n => n.props?.role === 'status')
    const text = nodes(status).map(n => typeof n.children === 'string' ? n.children : '').join(' ')
    expect(text).toContain('9007199254740995')
    expect(text).not.toContain('目标组织 99，')
  })
})


describe('派单原号只读核查与续办分离', () => {
  async function unknownAttempt() {
    const context = fixture()
    context.api.applyDispatch.mockRejectedValueOnce(httpError(503))
    await context.page.preview()
    context.page.confirmed.value = true
    await context.page.submit()
    return context
  }

  it('角色失去写权仍可按原号 GET 核查，核查成功保留原号且不能 POST 续办', async () => {
    const { page, props, api } = await unknownAttempt()
    const original = { ...page.attempt.value! }
    props.canDispatch = false
    api.getDispatchOperation.mockResolvedValueOnce({ ...original, status: 'completed', groups: [] })
    await page.inspect()
    await page.retry()
    expect(api.getDispatchOperation).toHaveBeenCalledExactlyOnceWith(original.operation_id)
    expect(api.applyDispatch).toHaveBeenCalledTimes(1)
    expect(page.result.value.status).toBe('completed')
    expect(page.verificationNote.value).toContain('只读核查成功')
    expect(page.attempt.value).toEqual(original)
    expect(page.savedOperation.value).toBe(original.operation_id)
    props.modelValue = false
    props.modelValue = true
    expect(page.attempt.value).toEqual(original)
    expect(page.savedOperation.value).toBe(original.operation_id)
  })

  it.each([404, 403, 503])('GET %s 保持待核查与原三元组，绝不回退 POST', async status => {
    const { page, api } = await unknownAttempt()
    const original = { ...page.attempt.value! }
    api.getDispatchOperation.mockRejectedValueOnce(httpError(status))
    await page.inspect()
    expect(api.applyDispatch).toHaveBeenCalledTimes(1)
    expect(api.planDispatch).toHaveBeenCalledTimes(1)
    expect(page.attempt.value).toEqual(original)
    expect(page.uncertain.value).toBe(true)
    expect(page.error.value).toContain(status === 404 ? '仍未知' : '核查')
  })

  it('核查仅接收已提交组，pending/partial 不续建；续办必须另点原号 POST', async () => {
    const { page, api } = await unknownAttempt()
    const original = { ...page.attempt.value! }
    api.getDispatchOperation.mockResolvedValueOnce({ ...original, status: 'partial', groups: [
      { group_key: 'group-u', status: 'completed', items: [{ risk_id: '102', result: 'created' }] },
    ] })
    await page.inspect()
    expect(page.resultGroups.value).toHaveLength(1)
    expect(page.verificationNote.value).toContain('只返回已提交组')
    expect(api.applyDispatch).toHaveBeenCalledTimes(1)
    expect(page.attempt.value).toEqual(original)
    await page.retry()
    expect(api.applyDispatch).toHaveBeenCalledTimes(2)
    expect(api.applyDispatch.mock.calls[1][0]).toEqual(original)
  })

  it('无读取资格、切换会话与核查重入都不能读取或重投', async () => {
    const { page, api, props, changeSession } = await unknownAttempt()
    props.canRead = false
    await page.inspect()
    expect(api.getDispatchOperation).not.toHaveBeenCalled()
    props.canRead = true
    const pending = deferred()
    api.getDispatchOperation.mockReturnValueOnce(pending.promise)
    const first = page.inspect()
    await page.inspect()
    await page.retry()
    expect(api.getDispatchOperation).toHaveBeenCalledTimes(1)
    expect(api.applyDispatch).toHaveBeenCalledTimes(1)
    changeSession()
    pending.resolve({ ...page.attempt.value, status: 'completed', groups: [] })
    await first
    expect(page.result.value).toBeNull()
    await page.inspect()
    expect(api.getDispatchOperation).toHaveBeenCalledTimes(1)
  })

  it('核查串号或串 plan 不确认完成；旧引用在核查前撤销', async () => {
    const { page, api } = fixture()
    api.applyDispatch.mockImplementationOnce(async input => ({ ...input, status: 'partial', groups: [
      { group_key: 'g', status: 'completed', ticket: { id: '201', ref: 'T-201' }, items: [] },
    ] }))
    await page.preview()
    page.confirmed.value = true
    await page.submit()
    const original = { ...page.attempt.value! }
    const pending = deferred()
    api.getDispatchOperation.mockReturnValueOnce(pending.promise)
    const reading = page.inspect()
    expect(page.resultGroups.value[0].ticket).toBeUndefined()
    pending.resolve({ ...original, plan_id: 'other-plan', status: 'completed', groups: [] })
    await reading
    expect(page.result.value.status).toBe('partial')
    expect(page.uncertain.value).toBe(true)
    expect(api.applyDispatch).toHaveBeenCalledTimes(1)
  })

  it('完成后显式开始下一次才清除当前三元组，仍显示已保存原号', async () => {
    const { page, api } = await unknownAttempt()
    const original = { ...page.attempt.value! }
    page.startNext()
    expect(page.attempt.value).toEqual(original)
    api.getDispatchOperation.mockResolvedValueOnce({ ...original, status: 'completed', groups: [] })
    await page.inspect()
    page.startNext()
    expect(page.attempt.value).toBeNull()
    expect(page.savedOperation.value).toBe(original.operation_id)
    expect(page.plan.value).toBeNull()
  })

  it('模板核查与续办各自绑定不同处理器，失去写权仍保留核查按钮', async () => {
    const { page, api, props } = await unknownAttempt()
    props.canDispatch = false
    const tree = renderPage(source, page, props)
    const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...(Array.isArray(node) ? node.flatMap(nodes) : Array.isArray(node.children) ? node.children.flatMap(nodes) : [])]
    const footer = nodes((tree.children as any).footer())
    const query = footer.find(n => n.props?.['data-testid'] === 'dispatch-inspect')
    const resume = footer.find(n => n.props?.['data-testid'] === 'dispatch-resume')
    expect(query?.props?.disabled).toBe(false)
    expect(resume?.props?.disabled).toBe(true)
    api.getDispatchOperation.mockResolvedValueOnce({ ...page.attempt.value, status: 'pending', groups: [] })
    await query.props.onClick()
    expect(api.getDispatchOperation).toHaveBeenCalledTimes(1)
    expect(api.applyDispatch).toHaveBeenCalledTimes(1)
  })
})


it('预览请求发出时绑定真实原始资产/负责人/期限，外部晚改动不能改写快照', async () => {
  const { page, props, api } = fixture()
  const detail: RiskViewDto = {
    risk: { id: '9007199254740993', human_key: 'R-A', revision: '7' }, title: '合成风险',
    status: 'assessed', closure_kind: null, level: 'high', owner_user_id: '71', org_id: '11',
    affected_org_id: null, deadline: '2026-12-01T00:00:00Z', init_deadline: null, treatment: 'mitigate',
    source_severity: null, asset_ref: { provider: 'synthetic', external_id: 'asset-A' }, dispatch_blockers: [],
  }
  props.itemDetails = [detail]
  const pending = deferred()
  api.planDispatch.mockReturnValueOnce(pending.promise)
  const preview = page.preview()
  props.itemDetails = []
  detail.asset_ref!.external_id = 'later-asset'
  detail.owner_user_id = '99'
  detail.deadline = '2027-01-01T00:00:00Z'
  pending.resolve(planA())
  await preview
  expect(page.displayDetails.value).toMatchObject([{
    risk: { id: '9007199254740993', revision: '7' }, owner_user_id: '71',
    deadline: '2026-12-01T00:00:00Z', asset_ref: { provider: 'synthetic', external_id: 'asset-A' },
  }])
})

it('无读取资格会使旧预览失效，恢复读取资格不能复活旧票引用', async () => {
  const { page, props, api } = fixture()
  const pending = deferred()
  api.planDispatch.mockReturnValueOnce(pending.promise)
  const preview = page.preview()
  props.canRead = false
  pending.resolve({ ...planA(), groups: [{ ...planA().groups[0], ticket: { id: '201', ref: 'T-201' } }] })
  await preview
  props.canRead = true
  expect(page.plan.value).toBeNull()
  expect(page.previewGroups.value).toEqual([])
})

it('已有操作失去读取资格时卸下缓存预览与结果表、阻断项和原目标', async () => {
  const { page, props, api } = fixture()
  api.applyDispatch.mockRejectedValueOnce(httpError(503))
  await page.preview()
  page.confirmed.value = true
  await page.submit()
  props.canRead = false
  const tree = renderPage(source, page, props)
  const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...(Array.isArray(node) ? node.flatMap(nodes) : Array.isArray(node.children) ? node.children.flatMap(nodes) : [])]
  const body = nodes((tree.children as any).default())
  expect(body.some(n => ['dispatch-preview', 'dispatch-results'].includes(n.props?.['data-testid']))).toBe(false)
  expect(body.map(n => typeof n.children === 'string' ? n.children : '').join(' ')).not.toContain('目标组织 9007199254740995')
})


it('当前无工单读取权限时不呈现预览票、组票和逐项票的可打开按钮', async () => {
  const { page, api, props } = fixture()
  props.canReadTickets = false
  api.planDispatch.mockResolvedValueOnce({ ...planA(), groups: [{ ...planA().groups[0], ticket: { id: '201', ref: 'T-201' } }] })
  await page.preview()
  const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...(Array.isArray(node) ? node.flatMap(nodes) : Array.isArray(node.children) ? node.children.flatMap(nodes) : [])]
  let body = nodes((renderPage(source, page, props).children as any).default())
  const preview = body.find(n => n.props?.['data-testid'] === 'dispatch-preview')
  expect(nodes(preview.children.ticket({ row: page.plan.value!.groups[0] })).some(n => n.props?.['data-testid'] === 'authorized-ticket')).toBe(false)
  api.applyDispatch.mockImplementationOnce(async input => ({ ...input, status: 'completed', groups: [{
    group_key: 'group-u', status: 'completed', ticket: { id: '201', ref: 'T-201' },
    items: [{ risk_id: '102', result: 'linked', ticket: { id: '305', ref: 'T-305' } }],
  }] }))
  page.confirmed.value = true
  await page.submit()
  body = nodes((renderPage(source, page, props).children as any).default())
  const result = body.find(n => n.props?.['data-testid'] === 'dispatch-results')
  expect(nodes(result.children.ticket({ row: page.resultGroups.value[0] })).some(n => n.props?.['data-testid'] === 'authorized-ticket')).toBe(false)
  expect(nodes(result.children.items({ row: page.resultGroups.value[0] })).some(n => n.props?.['data-testid'] === 'authorized-item-ticket')).toBe(false)
})
