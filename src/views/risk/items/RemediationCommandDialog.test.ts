import { reactive, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { deferred, httpError, preparePage, renderPage, setupPage, settle } from '@/test/sfcHarness'
import * as commands from '@/api/risk/remediationCommands'
import type { InstanceAction } from '@/api/ticket/instanceActions'
import source from './RemediationCommandDialog.vue?raw'

vi.mock('@vea/request', () => ({ default: { post: vi.fn(), get: vi.fn() } }))

preparePage(source)
const key = 'd1f72e3f-5810-4f40-87d2-876873895c37'
const nextKey = '97640a8f-4cb9-4448-ae20-4a5dfb79c0e9'
const ticketId = '9007199254740993'
const current = (): commands.RemediationCommandContext => ({
  ticket_id: ticketId, ticket_revision: '41', definition_version: '7', status: 'assigned', writes_enabled: true,
  items: [
    { link_id: '301', risk_id: '9007199254740995', risk_revision: '11', link_revision: '21', remediation_state: 'open', title: '合成资产 A', is_risk_owner: true, can_manage_risk: false },
    { link_id: '302', risk_id: '102', risk_revision: '12', link_revision: '22', remediation_state: 'pending_acceptance', title: '合成资产 B', is_risk_owner: false, can_manage_risk: true, pending_acceptance_id: '901', pending_acceptance_revision: '3' },
  ],
})
const outcome = (over = {}): commands.RemediationCommandOutcome => ({
  operation_id: key, ticket_id: ticketId, ticket_revision: '42', items: [], terminal_allowed: false, ...over,
})
type Page = {
  assignedToUserId: Ref<string>; selectedLinkId: Ref<string>; reason: Ref<string>; validUntil: Ref<string>
  decision: Ref<'approve' | 'reject' | ''>; busy: Ref<boolean>; error: Ref<string>
  attempt: Ref<{ kind: string; input: Record<string, unknown> } | null>
  result: Ref<commands.RemediationCommandOutcome | null>; sessionInvalid: Ref<boolean>
  rejectedAttempts: Ref<{ attempt: { input: Record<string, unknown> }; message: string; result: commands.RemediationCommandOutcome | null; error: string }[]>
  canAssign: Ref<boolean>; canAcceptAssignment: Ref<boolean>; canRequestAcceptance: Ref<boolean>; canDecideAcceptance: Ref<boolean>; canInspect: Ref<boolean>
  canStartNext: Ref<boolean>
  submitAssign(): Promise<void>; submitAcceptAssignment(): Promise<void>; submitRequestAcceptance(): Promise<void>; submitDecideAcceptance(): Promise<void>
  inspect(): Promise<void>; startNext(): Promise<void>; close(): void
  inspectRejected(record: Page['rejectedAttempts']['value'][number]): Promise<void>
}
function fixture() {
  const inspectOperation = vi.fn<(operationId: string) => Promise<commands.RemediationCommandOutcome>>()
  const props = reactive({
    modelValue: true, current: current() as commands.RemediationCommandContext | null,
    permissions: { canAssign: true, canAcceptAssignment: true, canRequestAcceptance: true, canDecideAcceptance: true },
    assignedTo: '501', currentActorId: '501', inspectOperation, canRead: true,
    refreshContext: undefined as (() => Promise<void>) | undefined, ticketActions: undefined as InstanceAction[] | undefined,
    customDataPatch: undefined as Record<string, unknown> | undefined, comment: undefined as string | undefined,
  })
  const api = {
    ...commands, newRemediationCommandId: vi.fn(() => key),
    assignRemediationHandlerApi: vi.fn().mockResolvedValue(outcome()),
    acceptRemediationAssignmentApi: vi.fn().mockResolvedValue(outcome()),
    requestRemediationAcceptanceApi: vi.fn().mockResolvedValue(outcome({ acceptance_id: '902', acceptance_revision: '1', acceptance_status: 'pending' })),
    decideRemediationAcceptanceApi: vi.fn().mockResolvedValue(outcome({ acceptance_id: '901', acceptance_revision: '4', acceptance_status: 'approved' })),
  }
  let generation = 1
  const { page, lifecycle } = setupPage<Page>(source, {
    '@/views/ticket/detail/TransitionActionDialog.vue': {},
    'element-plus': Object.fromEntries(['ElAlert', 'ElButton', 'ElDialog', 'ElInput', 'ElOption', 'ElRadio', 'ElRadioGroup', 'ElSelect'].map(name => [name, { name }])),
    '@/api/risk/remediationCommands': api,
    '@/components/UserPicker/index.vue': { default: { name: 'UserPicker' } },
    '@/common/auth/tokenStorage': { getSessionGeneration: () => generation },
  }, props)
  return { page, props, api, lifecycle, changeSession: () => generation++ }
}
function requestDraft(page: Page) {
  page.selectedLinkId.value = '301'; page.reason.value = '合成风险已核实，申请限期接受'
  page.validUntil.value = new Date(Date.now() + 86400000).toISOString().slice(0, 16)
}
function decisionDraft(page: Page) {
  page.selectedLinkId.value = '302'; page.reason.value = '合成独立审批理由'; page.decision.value = 'approve'
}
function nodes(input: any): any[] {
  if (Array.isArray(input)) return input.flatMap(nodes)
  if (!input || typeof input !== 'object') return []
  const children = input.children
  return [input, ...(Array.isArray(children) ? children.flatMap(nodes) : children && typeof children === 'object'
    ? Object.values(children).flatMap(slot => typeof slot === 'function' ? nodes(slot()) : []) : [])]
}
const node = (tree: any, id: string) => nodes(tree).find(n => n.props?.['data-testid'] === id)
const visibleText = (tree: any) => nodes(tree).map(n => typeof n.children === 'string' ? n.children : '').join(' ')

describe('整改命令独立权限与请求', () => {
  it('允许风险责任人重新申请已失效的待接受项', async () => {
    const { page, api, props } = fixture()
    requestDraft(page)
    Object.assign(props.current!.items[0]!, {
      remediation_state: 'pending_acceptance', pending_acceptance_recoverable: true,
    })
    await page.submitRequestAcceptance()
    expect(api.requestRemediationAcceptanceApi).toHaveBeenCalledOnce()
  })

  it('管理分派保持大 ID、票修订和定义钉；同步双击只发送一次', async () => {
    const { page, api, props } = fixture()
    page.assignedToUserId.value = '9007199254740997'
    props.customDataPatch = { synthetic_field: ['synthetic-object'] }; props.comment = '合成分派说明'
    await Promise.all([page.submitAssign(), page.submitAssign()])
    expect(api.assignRemediationHandlerApi).toHaveBeenCalledExactlyOnceWith({
      operation_id: key, ticket_id: ticketId, expected_ticket_revision: '41', definition_version: '7',
      assigned_to_user_id: '9007199254740997', custom_data_patch: { synthetic_field: ['synthetic-object'] }, comment: '合成分派说明',
    })
    expect(page.result.value?.ticket_revision).toBe('42')
  })

  it('接单必须独立 L1 权限且当前办理人为本人，不能用分派权替代', async () => {
    const { page, api, props } = fixture()
    props.permissions.canAcceptAssignment = false
    await page.submitAcceptAssignment()
    expect(api.acceptRemediationAssignmentApi).not.toHaveBeenCalled()
    props.permissions.canAcceptAssignment = true; props.assignedTo = '502'
    await page.submitAcceptAssignment()
    expect(api.acceptRemediationAssignmentApi).not.toHaveBeenCalled()
    props.assignedTo = '501'
    await page.submitAcceptAssignment()
    expect(api.acceptRemediationAssignmentApi).toHaveBeenCalledExactlyOnceWith({ operation_id: key, ticket_id: ticketId, expected_ticket_revision: '41', definition_version: '7' })
  })

  it('申请须有独立权限、现势 owner 事实、理由与未来期限', async () => {
    const { page, api, props } = fixture(); requestDraft(page)
    props.current!.items[0]!.is_risk_owner = false
    await page.submitRequestAcceptance(); expect(api.requestRemediationAcceptanceApi).not.toHaveBeenCalled()
    props.current!.items[0]!.is_risk_owner = true; props.permissions.canRequestAcceptance = false
    await page.submitRequestAcceptance(); expect(api.requestRemediationAcceptanceApi).not.toHaveBeenCalled()
    props.permissions.canRequestAcceptance = true; page.validUntil.value = '2020-01-01T00:00'
    await page.submitRequestAcceptance(); expect(api.requestRemediationAcceptanceApi).not.toHaveBeenCalled()
    requestDraft(page)
    await page.submitRequestAcceptance()
    expect(api.requestRemediationAcceptanceApi).toHaveBeenCalledExactlyOnceWith({
      operation_id: key, ticket_id: ticketId, expected_ticket_revision: '41', definition_version: '7', risk_id: '9007199254740995',
      expected_risk_revision: '11', link_id: '301', expected_link_revision: '21', reason: '合成风险已核实，申请限期接受', valid_until: new Date(page.validUntil.value).toISOString(),
    })
  })

  it.each(['approve', 'reject'] as const)('审批 %s 须有 L1 + can_manage_risk + pending 原修订，不串申请字段', async decision => {
    const { page, api, props } = fixture(); decisionDraft(page); page.decision.value = decision
    props.permissions.canDecideAcceptance = false
    await page.submitDecideAcceptance(); expect(api.decideRemediationAcceptanceApi).not.toHaveBeenCalled()
    props.permissions.canDecideAcceptance = true; props.current!.items[1]!.can_manage_risk = false
    await page.submitDecideAcceptance(); expect(api.decideRemediationAcceptanceApi).not.toHaveBeenCalled()
    props.current!.items[1]!.can_manage_risk = true
    delete props.current!.items[1]!.pending_acceptance_revision
    await page.submitDecideAcceptance(); expect(api.decideRemediationAcceptanceApi).not.toHaveBeenCalled()
    props.current!.items[1]!.pending_acceptance_revision = '3'
    await page.submitDecideAcceptance()
    expect(api.decideRemediationAcceptanceApi).toHaveBeenCalledExactlyOnceWith({
      operation_id: key, ticket_id: ticketId, expected_ticket_revision: '41', definition_version: '7', acceptance_id: '901', expected_acceptance_revision: '3', expected_risk_revision: '12', decision, reason: '合成独立审批理由',
    })
  })

  it('已知现势 owner 不开放自己审批，服务端仍须拒绝历史申请人自批', () => {
    const { page, props } = fixture(); decisionDraft(page)
    props.current!.items[1]!.is_risk_owner = true
    expect(page.canDecideAcceptance.value).toBe(false)
  })

  it('缺失/非法上下文与 writes_enabled=false 均禁止写入', async () => {
    const { page, api, props } = fixture(); page.assignedToUserId.value = '503'
    props.current!.writes_enabled = false
    await page.submitAssign(); await page.submitAcceptAssignment()
    expect(api.assignRemediationHandlerApi).not.toHaveBeenCalled(); expect(api.acceptRemediationAssignmentApi).not.toHaveBeenCalled()
    props.current!.writes_enabled = true; props.current!.ticket_revision = 41 as unknown as string
    await page.submitAssign(); expect(api.assignRemediationHandlerApi).not.toHaveBeenCalled()
    props.current = null; await page.submitAcceptAssignment(); expect(api.acceptRemediationAssignmentApi).not.toHaveBeenCalled()
  })

  it.each([{ items: [null] }, { items: [undefined] }, { items: Array(1) }])('畸形关联项作为上下文失败呈现，不能在校验或选择时抛异常', async ({ items }) => {
    const { page, api, props } = fixture()
    props.current!.items = items as unknown as commands.RemediationCommandItem[]
    page.selectedLinkId.value = '301'
    expect(page.canRequestAcceptance.value).toBe(false)
    expect(page.canAcceptAssignment.value).toBe(false)
    await page.submitAcceptAssignment()
    expect(api.acceptRemediationAssignmentApi).not.toHaveBeenCalled()
    expect(() => renderPage(source, page, props)).not.toThrow()
  })
})

describe('原号只读恢复与异步隔离', () => {
  it('409 后等待父层刷新票、办理上下文和已发布动作，成功才释放原号且提交前不分配新号', async () => {
    const { page, api, props } = fixture()
    props.ticketActions = [{ id: 'claim', to: 'in_progress', title: '接单', expectedRevision: '41', definitionVersion: '7', fields: [], commentRequired: false }]
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(httpError(409, '合成修订冲突'))
    await page.submitAcceptAssignment()
    const original = JSON.stringify(page.attempt.value)
    const pending = deferred<void>()
    props.refreshContext = vi.fn(async () => {
      await pending.promise
      props.current = { ...current(), ticket_revision: '43' }
      props.ticketActions = [{ ...props.ticketActions![0]!, expectedRevision: '43' }]
    })
    const next = page.startNext()
    expect(props.refreshContext).toHaveBeenCalledOnce()
    expect(page.busy.value).toBe(true)
    expect(JSON.stringify(page.attempt.value)).toBe(original)
    await page.startNext()
    expect(props.refreshContext).toHaveBeenCalledOnce()
    pending.resolve(); await next
    expect(page.attempt.value).toBeNull()
    expect(JSON.stringify(page.rejectedAttempts.value[0]?.attempt)).toBe(original)
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(1)
    api.newRemediationCommandId.mockReturnValueOnce(nextKey)
    api.acceptRemediationAssignmentApi.mockResolvedValueOnce(outcome({ operation_id: nextKey, ticket_revision: '44' }))
    await page.submitAcceptAssignment()
    expect(api.acceptRemediationAssignmentApi).toHaveBeenLastCalledWith(expect.objectContaining({ operation_id: nextKey, expected_ticket_revision: '43' }))
  })

  it('父层刷新失败保留明确拒绝、原 K 与载荷并可继续只读核查', async () => {
    const { page, api, props } = fixture()
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(httpError(409, '合成冲突'))
    await page.submitAcceptAssignment()
    const original = JSON.stringify(page.attempt.value)
    props.refreshContext = vi.fn().mockRejectedValueOnce(new Error('合成已发布动作读取失败'))
    await page.startNext()
    expect(JSON.stringify(page.attempt.value)).toBe(original)
    expect(page.rejectedAttempts.value).toEqual([])
    expect(page.error.value).toContain('合成已发布动作读取失败')
    expect(page.canStartNext.value).toBe(true)
    expect(page.canInspect.value).toBe(true)
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(1)
    props.inspectOperation.mockResolvedValueOnce(outcome()); await page.inspect()
    expect(props.inspectOperation).toHaveBeenCalledExactlyOnceWith(key)
  })

  it.each(['actor', 'ticket', 'read', 'session', 'close'] as const)('父层刷新期间 %s 变化不得释放原尝试', async change => {
    const { page, api, props, changeSession } = fixture()
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(httpError(409))
    await page.submitAcceptAssignment()
    const original = JSON.stringify(page.attempt.value)
    const pending = deferred<void>()
    props.refreshContext = vi.fn(() => pending.promise)
    const next = page.startNext()
    if (change === 'actor') props.currentActorId = '502'
    if (change === 'ticket') props.current!.ticket_id = '999'
    if (change === 'read') props.canRead = false
    if (change === 'session') changeSession()
    if (change === 'close') props.modelValue = false
    pending.resolve(); await next
    expect(JSON.stringify(page.attempt.value)).toBe(original)
    expect(page.rejectedAttempts.value).toEqual([])
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(1)
  })

  it('成功回执也能显式等待父层新修订后再开始下一次', async () => {
    const { page, api, props } = fixture()
    await page.submitAcceptAssignment()
    props.refreshContext = vi.fn(async () => { props.current!.ticket_revision = '42' })
    expect(page.canStartNext.value).toBe(true)
    await page.startNext()
    expect(props.refreshContext).toHaveBeenCalledOnce()
    expect(page.attempt.value).toBeNull()
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(1)
  })

  it('关闭后同一用户丢写权限或已关票仍能只读重开原号，撤销读权限则不再请求', async () => {
    const { page, api, props } = fixture()
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(new Error('合成丢响应'))
    await page.submitAcceptAssignment()
    props.modelValue = false
    props.permissions.canAcceptAssignment = false
    props.current!.status = 'closed'; props.current!.writes_enabled = false
    props.modelValue = true
    expect(page.canInspect.value).toBe(true)
    props.inspectOperation.mockRejectedValueOnce(httpError(404))
    await page.inspect()
    expect(props.inspectOperation).toHaveBeenCalledExactlyOnceWith(key)
    props.canRead = false
    expect(page.canInspect.value).toBe(false)
    await page.inspect(); await page.submitAcceptAssignment()
    expect(props.inspectOperation).toHaveBeenCalledTimes(1)
    expect(api.acceptRemediationAssignmentApi).toHaveBeenCalledTimes(1)
  })

  it('此前拒绝的 K 在同一用户丢写权限且票已关闭后仍可核查，撤销读权限后禁查', async () => {
    const { page, api, props } = fixture()
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(httpError(409))
    await page.submitAcceptAssignment()
    props.refreshContext = vi.fn(async () => { props.current!.ticket_revision = '42' })
    await page.startNext()
    const previous = page.rejectedAttempts.value[0]!
    props.modelValue = false
    props.permissions.canAcceptAssignment = false
    props.current!.writes_enabled = false; props.current!.status = 'closed'
    props.modelValue = true
    props.inspectOperation.mockResolvedValueOnce(outcome())
    await page.inspectRejected(previous)
    expect(previous.result?.operation_id).toBe(key)
    expect(props.inspectOperation).toHaveBeenCalledExactlyOnceWith(key)
    props.canRead = false
    await page.inspectRejected(previous)
    expect(props.inspectOperation).toHaveBeenCalledTimes(1)
    expect(api.acceptRemediationAssignmentApi).toHaveBeenCalledTimes(1)
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(1)
  })

  it('成功回执的父层刷新失败也保留原尝试和已取得的结果', async () => {
    const { page, api, props } = fixture()
    await page.submitAcceptAssignment()
    const original = JSON.stringify(page.attempt.value)
    props.refreshContext = vi.fn().mockRejectedValueOnce(new Error('合成上下文刷新失败'))
    await page.startNext()
    expect(JSON.stringify(page.attempt.value)).toBe(original)
    expect(page.result.value?.operation_id).toBe(key)
    expect(page.error.value).toContain('合成上下文刷新失败')
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(1)
  })

  it('撤销读权限后晚到的原号回执不得确认，恢复读取仍保留原 K', async () => {
    const { page, api, props } = fixture()
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(new Error('合成丢响应'))
    await page.submitAcceptAssignment()
    const pending = deferred<commands.RemediationCommandOutcome>()
    props.inspectOperation.mockReturnValueOnce(pending.promise)
    const inspecting = page.inspect()
    props.canRead = false
    pending.resolve(outcome()); await inspecting
    expect(page.result.value).toBeNull()
    expect(page.attempt.value?.input.operation_id).toBe(key)
    props.canRead = true
    props.inspectOperation.mockResolvedValueOnce(outcome())
    await page.inspect()
    expect(props.inspectOperation).toHaveBeenLastCalledWith(key)
    expect(page.result.value?.operation_id).toBe(key)
    expect(api.acceptRemediationAssignmentApi).toHaveBeenCalledTimes(1)
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(1)
  })

  it.each([400, 403, 409, 422])('POST %s 明确拒绝后保留原请求，并只在显式开始下一次时开放改写', async status => {
    const { page, api } = fixture(); requestDraft(page)
    api.requestRemediationAcceptanceApi.mockRejectedValueOnce(httpError(status, '合成业务拒绝'))
    await page.submitRequestAcceptance()
    expect(page.attempt.value?.input.operation_id).toBe(key)
    expect(page.result.value).toBeNull()
    expect(page.canStartNext.value).toBe(true)
    expect(page.canRequestAcceptance.value).toBe(false)
    await page.submitRequestAcceptance()
    expect(api.requestRemediationAcceptanceApi).toHaveBeenCalledTimes(1)
    page.startNext()
    expect(page.canRequestAcceptance.value).toBe(true)
    expect(page.rejectedAttempts.value[0]?.attempt.input.operation_id).toBe(key)
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(1)
  })

  it('明确409后显式提交采用新 K 和修改后的载荷，先前原 K 与请求仍可只读核查', async () => {
    const { page, api, props } = fixture(); requestDraft(page)
    api.requestRemediationAcceptanceApi.mockRejectedValueOnce(httpError(409, '合成修订冲突'))
    await page.submitRequestAcceptance()
    const original = JSON.stringify(page.attempt.value)
    const rejectedTree = renderPage(source, page, props)
    expect(node(rejectedTree, 'remediation-command-next').props.onClick).toBe(page.startNext)
    expect(node(rejectedTree, 'remediation-command-inspect').props.onClick).toBe(page.inspect)
    page.startNext()
    props.current!.ticket_revision = '43'; page.reason.value = '刷新后修改的合成理由'
    api.newRemediationCommandId.mockReturnValueOnce(nextKey)
    api.requestRemediationAcceptanceApi.mockResolvedValueOnce(outcome({ operation_id: nextKey, ticket_revision: '44' }))
    await page.submitRequestAcceptance()
    expect(api.requestRemediationAcceptanceApi).toHaveBeenLastCalledWith(expect.objectContaining({
      operation_id: nextKey, expected_ticket_revision: '43', reason: '刷新后修改的合成理由',
    }))
    expect(page.result.value?.operation_id).toBe(nextKey)
    const previous = page.rejectedAttempts.value[0]!
    expect(JSON.stringify(previous.attempt)).toBe(original)
    props.inspectOperation.mockRejectedValueOnce(httpError(404))
    await page.inspectRejected(previous)
    expect(props.inspectOperation).toHaveBeenCalledExactlyOnceWith(key)
    expect(previous.error).toContain('不代表未提交')
    expect(JSON.stringify(previous.attempt)).toBe(original)
    expect(page.result.value?.operation_id).toBe(nextKey)
    const tree = renderPage(source, page, props)
    expect(node(tree, `remediation-command-history-inspect-${key}`)).toBeDefined()
    expect(api.requestRemediationAcceptanceApi).toHaveBeenCalledTimes(2)
  })

  it.each([404, 500, 503])('POST %s 保留原 K 原载荷，GET 失败不换号、不自动重写', async status => {
    const { page, api, props } = fixture(); requestDraft(page)
    api.requestRemediationAcceptanceApi.mockRejectedValueOnce(httpError(status))
    await page.submitRequestAcceptance()
    const original = JSON.stringify(page.attempt.value)
    props.current!.ticket_revision = '99'; page.reason.value = '变更后的草稿'
    props.inspectOperation.mockRejectedValueOnce(httpError(404))
    await page.inspect(); await page.submitAssign(); await page.submitRequestAcceptance()
    expect(props.inspectOperation).toHaveBeenCalledExactlyOnceWith(key)
    expect(JSON.stringify(page.attempt.value)).toBe(original)
    expect(page.error.value).toContain('不代表未提交')
    expect(api.requestRemediationAcceptanceApi).toHaveBeenCalledTimes(1)
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(1)
    expect(page.result.value).toBeNull()
    props.inspectOperation.mockResolvedValueOnce(outcome({ acceptance_id: '902', acceptance_revision: '1', acceptance_status: 'pending' }))
    await page.inspect()
    expect(page.result.value?.acceptance_status).toBe('pending')
  })

  it.each([400, 403, 409, 422])('传输失败后 GET %s 不能将未知结果变为明确拒绝或开放新 K', async status => {
    const { page, api, props } = fixture(); requestDraft(page)
    api.requestRemediationAcceptanceApi.mockRejectedValueOnce(new Error('合成传输中断'))
    await page.submitRequestAcceptance()
    const original = JSON.stringify(page.attempt.value)
    props.current!.ticket_revision = '99'
    props.inspectOperation.mockRejectedValueOnce(httpError(status, '合成查询拒绝'))
    await page.inspect(); page.startNext(); await page.submitRequestAcceptance()
    expect(page.canStartNext.value).toBe(false)
    expect(page.canInspect.value).toBe(status !== 403)
    expect(JSON.stringify(page.attempt.value)).toBe(original)
    expect(page.rejectedAttempts.value).toEqual([])
    expect(page.result.value).toBeNull()
    expect(api.requestRemediationAcceptanceApi).toHaveBeenCalledTimes(1)
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(1)
  })

  it('原号核查在关窗期间收到拒读，重开仍隐藏历史并保留内部原请求', async () => {
    const { page, api, props } = fixture(); requestDraft(page)
    api.requestRemediationAcceptanceApi.mockRejectedValueOnce(new Error('合成响应丢失'))
    await page.submitRequestAcceptance()
    const original = JSON.stringify(page.attempt.value)
    let deny!: (reason: unknown) => void
    props.inspectOperation.mockReturnValueOnce(new Promise((_resolve, reject) => { deny = reject }))
    const read = page.inspect()
    props.modelValue = false
    deny(httpError(403))
    await read
    props.modelValue = true
    expect(page.canInspect.value).toBe(false)
    expect(JSON.stringify(page.attempt.value)).toBe(original)
  })

  it('此前拒绝操作的核查成功不清除新操作的未知状态，换身份后也不能查询旧操作', async () => {
    const { page, api, props } = fixture()
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(httpError(409, '合成接单冲突'))
    await page.submitAcceptAssignment(); page.startNext()
    api.newRemediationCommandId.mockReturnValueOnce(nextKey)
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(new Error('合成丢响应'))
    await page.submitAcceptAssignment()
    const previous = page.rejectedAttempts.value[0]!
    props.inspectOperation.mockResolvedValueOnce(outcome())
    await page.inspectRejected(previous)
    expect(previous.result?.operation_id).toBe(key)
    expect(page.attempt.value?.input.operation_id).toBe(nextKey)
    expect(page.result.value).toBeNull()
    expect(page.canStartNext.value).toBe(false)
    props.currentActorId = '502'; await settle()
    await page.inspectRejected(previous)
    expect(props.inspectOperation).toHaveBeenCalledTimes(1)
  })

  it('错票/异号回执绝不确认完成', async () => {
    const { page, api, props } = fixture()
    api.acceptRemediationAssignmentApi.mockResolvedValueOnce(outcome({ ticket_id: '999' }))
    await page.submitAcceptAssignment(); expect(page.result.value).toBeNull()
    props.inspectOperation.mockResolvedValueOnce(outcome({ operation_id: '97640a8f-4cb9-4448-ae20-4a5dfb79c0e9' }))
    await page.inspect(); expect(page.result.value).toBeNull(); expect(page.attempt.value?.input.operation_id).toBe(key)
  })

  it('关闭并重开保留 K，旧在途回包不确认，随后可以原号 GET', async () => {
    const { page, api, props } = fixture(); const pending = deferred<commands.RemediationCommandOutcome>()
    api.acceptRemediationAssignmentApi.mockReturnValueOnce(pending.promise)
    const first = page.submitAcceptAssignment()
    props.modelValue = false; await settle(); props.modelValue = true; await settle()
    pending.resolve(outcome()); await first
    expect(page.result.value).toBeNull(); expect(page.attempt.value?.input.operation_id).toBe(key)
    props.inspectOperation.mockResolvedValueOnce(outcome()); await page.inspect()
    expect(page.result.value?.ticket_id).toBe(ticketId)
  })

  it('切票后晚回包不能落到新票，切回可核查原号', async () => {
    const { page, api, props } = fixture(); const pending = deferred<commands.RemediationCommandOutcome>()
    api.acceptRemediationAssignmentApi.mockReturnValueOnce(pending.promise)
    const first = page.submitAcceptAssignment()
    props.current = { ...current(), ticket_id: '999' }; await settle()
    pending.resolve(outcome()); await first
    expect(page.result.value).toBeNull(); expect(page.canInspect.value).toBe(false)
    props.current = current(); await settle(); expect(page.canInspect.value).toBe(true)
  })

  it('会话切换/离开缓存页阻止晚回包，不能按新身份查询旧操作', async () => {
    const { page, api, props, lifecycle, changeSession } = fixture(); const pending = deferred<commands.RemediationCommandOutcome>()
    api.acceptRemediationAssignmentApi.mockReturnValueOnce(pending.promise)
    const first = page.submitAcceptAssignment(); lifecycle.deactivate(); changeSession()
    pending.resolve(outcome()); await first
    expect(page.result.value).toBeNull(); expect(page.sessionInvalid.value).toBe(true)
    lifecycle.activate(); await page.inspect(); expect(props.inspectOperation).not.toHaveBeenCalled()
  })

  it('成功后只允许刷新到新修订再显式开启下一次，不能拿旧修订换号', async () => {
    const { page, props } = fixture(); await page.submitAcceptAssignment()
    page.startNext(); expect(page.attempt.value).not.toBeNull()
    props.current!.ticket_revision = '42'; await settle(); page.startNext()
    expect(page.attempt.value).toBeNull(); expect(page.result.value).toBeNull()
  })

  it('失败前冻结 patch 嵌套对象；撤销写权限仍可按原号只读核查', async () => {
    const { page, api, props } = fixture()
    props.customDataPatch = { nested: { synthetic: 'original' } }
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(new Error('丢响应'))
    await page.submitAcceptAssignment()
    ;(props.customDataPatch.nested as Record<string, string>).synthetic = 'changed'
    props.permissions.canAcceptAssignment = false
    expect(page.attempt.value?.input.custom_data_patch).toEqual({ nested: { synthetic: 'original' } })
    props.inspectOperation.mockResolvedValueOnce(outcome()); await page.inspect()
    expect(page.result.value?.operation_id).toBe(key)
  })

  it.each([undefined, NaN, () => 'synthetic', new Date('2030-01-01')])('非法嵌套 patch 不得被 JSON 快照静默删改', async invalid => {
    const { page, api, props } = fixture()
    props.customDataPatch = { nested: { invalid } }
    await page.submitAcceptAssignment()
    expect(api.acceptRemediationAssignmentApi).not.toHaveBeenCalled()
    expect(page.attempt.value).toBeNull()
  })

  it('期限在按钮就绪后经过，点击时仍必须重新校验未来时间', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const { page, api } = fixture(); requestDraft(page)
    expect(page.canRequestAcceptance.value).toBe(true)
    vi.setSystemTime(new Date('2030-01-03T00:00:00Z'))
    await page.submitRequestAcceptance()
    expect(api.requestRemediationAcceptanceApi).not.toHaveBeenCalled()
    expect(page.attempt.value).toBeNull()
  })
})

describe('真实模板装配', () => {
  it('撤销读权限隐藏当前上下文、草稿与已打开的办理表单', async () => {
    const { page, props } = fixture()
    requestDraft(page)
    page.assignedToUserId.value = '9007199254740997'
    props.ticketActions = [{ id: 'claim', to: 'in_progress', title: '合成接单动作', expectedRevision: '41', definitionVersion: '7', fields: [], commentRequired: true }]
    await page.submitAcceptAssignment()
    const before = renderPage(source, page, props)
    expect(visibleText(before)).toContain(ticketId)
    expect(node(before, 'remediation-command-picker').props.modelValue).toBe('9007199254740997')
    expect(nodes(before).some(n => n.props?.action?.id === 'claim')).toBe(true)

    props.canRead = false
    const hidden = renderPage(source, page, props)
    expect(visibleText(hidden)).not.toContain(ticketId)
    expect(node(hidden, 'remediation-command-picker')).toBeUndefined()
    expect(nodes(hidden).some(n => n.props?.modelValue === '合成风险已核实，申请限期接受')).toBe(false)
    expect(nodes(hidden).some(n => n.props?.label?.includes('合成资产'))).toBe(false)
    expect(nodes(hidden).some(n => n.props?.action?.id === 'claim')).toBe(false)
  })

  it('撤销读权限隐藏已缓存回执和拒绝历史，恢复读取仍使用原 K', async () => {
    const { page, api, props } = fixture()
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(httpError(409, '合成拒绝详情'))
    await page.submitAcceptAssignment(); await page.startNext()
    const previous = page.rejectedAttempts.value[0]!
    props.inspectOperation.mockResolvedValueOnce(outcome())
    await page.inspectRejected(previous)
    api.newRemediationCommandId.mockReturnValueOnce(nextKey)
    api.acceptRemediationAssignmentApi.mockResolvedValueOnce(outcome({ operation_id: nextKey, acceptance_status: 'approved', acceptance_id: '903', acceptance_revision: '2' }))
    await page.submitAcceptAssignment()
    page.error.value = '合成回执核查详情'
    const original = JSON.stringify(page.attempt.value)
    const before = visibleText(renderPage(source, page, props))
    expect(before).toContain('已批准')
    expect(before).toContain('合成拒绝详情')
    expect(before).toContain('已取得此前操作的回执')

    props.canRead = false
    const hidden = renderPage(source, page, props)
    expect(visibleText(hidden)).not.toContain(ticketId)
    expect(visibleText(hidden)).not.toContain(key)
    expect(visibleText(hidden)).not.toContain(nextKey)
    expect(visibleText(hidden)).not.toContain('已批准')
    expect(visibleText(hidden)).not.toContain('合成拒绝详情')
    expect(visibleText(hidden)).not.toContain('合成回执核查详情')
    expect(visibleText(hidden)).not.toContain('已取得此前操作的回执')
    expect(node(hidden, `remediation-command-history-inspect-${key}`)).toBeUndefined()
    expect(node(hidden, 'remediation-command-next')).toBeUndefined()
    expect(JSON.stringify(page.attempt.value)).toBe(original)

    props.canRead = true
    expect(visibleText(renderPage(source, page, props))).toContain(nextKey)
    expect(page.result.value?.operation_id).toBe(nextKey)
    expect(previous.attempt.input.operation_id).toBe(key)
    expect(api.newRemediationCommandId).toHaveBeenCalledTimes(2)
  })

  it.each(['actor', 'ticket'] as const)('%s 变化隐藏旧操作与历史，返回原作用域后可继续原号核查', async change => {
    const { page, api, props } = fixture()
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(httpError(409, '合成旧作用域拒绝详情'))
    await page.submitAcceptAssignment(); await page.startNext()
    const previous = page.rejectedAttempts.value[0]!
    props.inspectOperation.mockResolvedValueOnce(outcome())
    await page.inspectRejected(previous)
    if (change === 'actor') props.currentActorId = '502'
    else props.current = { ...current(), ticket_id: '999' }
    const hiddenHistory = renderPage(source, page, props)
    expect(node(hiddenHistory, `remediation-command-history-inspect-${key}`)).toBeUndefined()
    expect(visibleText(hiddenHistory)).not.toContain('合成旧作用域拒绝详情')

    props.currentActorId = '501'; props.current = current()
    api.newRemediationCommandId.mockReturnValueOnce(nextKey)
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(new Error('合成旧作用域丢响应'))
    await page.submitAcceptAssignment()
    if (change === 'actor') props.currentActorId = '502'
    else props.current = { ...current(), ticket_id: '999' }
    const hiddenAttempt = renderPage(source, page, props)
    expect(visibleText(hiddenAttempt)).not.toContain(nextKey)
    expect(visibleText(hiddenAttempt)).not.toContain('合成旧作用域丢响应')
    expect(node(hiddenAttempt, 'remediation-command-inspect')).toBeUndefined()

    props.currentActorId = '501'; props.current = current()
    expect(page.attempt.value?.input.operation_id).toBe(nextKey)
    expect(node(renderPage(source, page, props), 'remediation-command-inspect').props.disabled).toBe(false)
    props.inspectOperation.mockResolvedValueOnce(outcome({ operation_id: nextKey }))
    await page.inspect()
    expect(props.inspectOperation).toHaveBeenLastCalledWith(nextKey)
    expect(page.result.value?.operation_id).toBe(nextKey)
  })

  it('动作弹窗遮罩不可关闭、选择器使用票上下文、按钮具名并连接处理器', () => {
    const { page, props } = fixture()
    const tree = renderPage(source, page, props)
    expect(tree.props?.['close-on-click-modal']).toBe(false)
    expect(node(tree, 'remediation-command-picker').props.context).toEqual({ purpose: 'assign', ticketId })
    expect(node(tree, 'remediation-command-assign').props.onClick).toBe(page.submitAssign)
    expect(node(tree, 'remediation-command-claim').props.onClick).toBe(page.submitAcceptAssignment)
    expect(node(tree, 'remediation-command-request').props.disabled).toBe(true)
    expect(node(tree, 'remediation-command-decision').props.disabled).toBe(true)
    expect(nodes(tree).some(n => n.props?.role === 'status')).toBe(true)
  })

  it('未知结果仅显示原号核查，禁止换号/重发入口', async () => {
    const { page, api, props } = fixture()
    api.acceptRemediationAssignmentApi.mockRejectedValueOnce(new Error('丢响应')); await page.submitAcceptAssignment()
    const tree = renderPage(source, page, props)
    expect(node(tree, 'remediation-command-inspect').props.onClick).toBe(page.inspect)
    expect(node(tree, 'remediation-command-claim')).toBeUndefined()
    expect(node(tree, 'remediation-command-next')).toBeUndefined()
  })
})
