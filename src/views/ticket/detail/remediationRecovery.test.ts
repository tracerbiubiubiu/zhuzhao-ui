import { reactive, ref, unref, type MaybeRef } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import { deferred, preparePage, renderPage, setupPage, settle } from '@/test/sfcHarness'
import { normalizeTicketDefinition } from '@/api/ticket/instanceActions'
import { createTransitionSubmission } from './transitionSubmission'
import { useRenderedRichtext } from './useRenderedRichtext'
import source from './index.vue?raw'

vi.mock('@vea/request', () => ({ default: {} }))
preparePage(source)
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })

function fixture() {
  const props = reactive({ ticketId: '42' })
  const user = reactive({ profile: { id: '501' }, read: true, hasAny: () => false,
    hasPermission: (permission: string) => user.read && ['ticket:read', 'route:/risks'].includes(permission),
  })
  let session = 1
  const row = (revision = '41') => ({ id: '42', assigned_to: '501', type_code: 'synthetic', status: 'assigned',
    definition_resolution: 'exact', revision,
    definition_ref: { type_code: 'synthetic', definition_version: '7', definition_hash: 'synthetic-hash' },
  })
  const detail = (revision = '41') => ({ row: row(revision), definition: normalizeTicketDefinition(row(revision)) })
  const context = (revision = '41') => ({ ticket_id: '42', ticket_revision: revision, definition_version: '7',
    status: 'assigned', writes_enabled: true, allowed_actions: ['assign_handler'], items: [
      { link_id: '301', risk_id: '101', link_revision: '21', risk_revision: '11', proposal_version: '0',
        title: '合成资产', remediation_state: 'open', can_manage_risk: true, is_risk_owner: false },
    ],
  })
  const action = (revision = '41') => ({ id: 'claim', to: 'in_progress', title: '接单', fields: [], commentRequired: false,
    expectedRevision: revision, definitionVersion: '7',
  })
  const ticketApi = vi.fn().mockResolvedValue(row())
  const assignApi = vi.fn().mockResolvedValue(undefined)
  const deleteApi = vi.fn().mockResolvedValue(undefined)
  const confirm = vi.fn()
  const queries: Record<string, any> = {}
  const { page, lifecycle } = setupPage(source, {
    '@/api/ticket': { STATUS_LABEL: {}, getTicketApi: ticketApi, assignTicketApi: assignApi, deleteTicketApi: deleteApi },
    '@/api/ticket/instanceActions': { normalizeTicketDefinition, getInstanceActionsApi: vi.fn(), transitionInstanceApi: vi.fn() },
    '@/api/ticket/operationKey': { newTicketOperationKey: vi.fn() },
    '@/api/risk/remediation': { getRemediationContextApi: vi.fn(), getRemediationOperationApi: vi.fn() },
    '@/api/system/dict': { getDictItemsByCodeApi: vi.fn() },
    '@/common/auth/tokenStorage': { getSessionGeneration: () => session },
    'element-plus': { ElMessage: { success: vi.fn() }, ElMessageBox: { confirm } },
    'vue-router': { useRouter: () => ({}) },
    '@/store/modules/user': { useUserStoreWithOut: () => user },
    '@/components/UserNameText/index.vue': {}, '@/components/UserPicker/index.vue': {}, '@/components/TicketAttachments.vue': {},
    './TransitionActionDialog.vue': {},
    '@/views/risk/items/RemediationDialog.vue': { name: 'RemediationDialog' },
    '@/views/risk/items/RemediationCommandDialog.vue': { name: 'RemediationCommandDialog' },
    './transitionSubmission': { createTransitionSubmission }, './useRenderedRichtext': { useRenderedRichtext },
    './relationSession': { createRelationSession: () => ({ state: {}, reset() {} }) },
    '@tanstack/vue-query': {
      useQuery: (options: { queryKey: MaybeRef<readonly unknown[]> }) => {
        const name = String(unref(options.queryKey)[1])
        const query = { data: ref(name === 'detail' ? detail() : name === 'risk-workflow' ? context()
          : name === 'transitions' ? { actions: [action()], fields: [] } : undefined),
        isSuccess: ref(true), isError: ref(false), error: ref(null), isLoading: ref(false), isFetching: ref(false),
        refetch: vi.fn(), options }
        query.refetch.mockImplementation(async () => ({ data: query.data.value, isSuccess: true, error: null }))
        queries[name] = query
        return query
      },
      useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    },
  }, props)
  return { page, lifecycle, props, user, queries, detail, context, action, ticketApi, assignApi, deleteApi, confirm, changeSession: () => session++ }
}
function nodes(input: any): any[] {
  if (Array.isArray(input)) return input.flatMap(nodes)
  if (!input || typeof input !== 'object') return []
  return [input, ...(Array.isArray(input.children) ? input.children.flatMap(nodes)
    : input.children && typeof input.children === 'object'
      ? Object.values(input.children).flatMap(slot => typeof slot === 'function' ? nodes(slot()) : []) : [])]
}
function render(f: ReturnType<typeof fixture>) { return nodes(renderPage(source, f.page, f.props)) }
const button = (f: ReturnType<typeof fixture>) => render(f).find(n => n.props?.['data-testid'] === 'open-risk-workflow-commands')
const child = (f: ReturnType<typeof fixture>, name: string) => render(f).find(n => n.type?.name === name)

it('两个真实父层回调等待票、上下文和新版已发布动作，动作失败明确拒绝', async () => {
  const f = fixture(), pending = deferred()
  f.queries.detail.refetch.mockImplementationOnce(async () => {
    await pending.promise
    f.queries.detail.data.value = f.detail('42')
    return { data: f.queries.detail.data.value, isSuccess: true }
  })
  f.queries['risk-workflow'].refetch.mockImplementationOnce(async () => {
    f.queries['risk-workflow'].data.value = f.context('42')
    return { data: f.queries['risk-workflow'].data.value, isSuccess: true }
  })
  f.queries.transitions.refetch.mockImplementationOnce(async () => {
    f.queries.transitions.data.value = { actions: [f.action('42')], fields: [] }
    return { data: f.queries.transitions.data.value, isSuccess: true }
  })
  const refresh = child(f, 'RemediationCommandDialog')?.props?.['refresh-context']
  expect(refresh).toBeTypeOf('function')
  expect(child(f, 'RemediationDialog')?.props?.['refresh-context']).toBe(refresh)
  const task = refresh()
  expect(f.queries['risk-workflow'].refetch).not.toHaveBeenCalled()
  pending.resolve(undefined)
  await task
  expect(f.page.riskCommandContext.value.ticket_revision).toBe('42')
  expect(child(f, 'RemediationDialog').props['ticket-actions'][0].expectedRevision).toBe('42')
  for (const name of ['detail', 'risk-workflow', 'transitions']) {
    expect(f.queries[name].refetch).toHaveBeenCalledWith({ throwOnError: true })
  }
  f.queries.transitions.refetch.mockRejectedValueOnce(new Error('合成动作读取失败'))
  await expect(refresh()).rejects.toThrow('合成动作读取失败')
})

it.each(['detail', 'risk-workflow', 'transitions'])('刷新 %s 返回错误而非抛出时也不能当作恢复成功', async name => {
  const f = fixture()
  f.queries[name].refetch.mockResolvedValueOnce({ data: f.queries[name].data.value, isSuccess: false, error: new Error('合成读取失败') })
  await expect(f.page.refreshRiskWorkflowContext()).rejects.toThrow('合成读取失败')
})

it.each(['read', 'actor', 'ticket', 'session', 'inactive'])('刷新等待期间 %s 变化后不得继续新读取', async changed => {
  const f = fixture(), pending = deferred()
  f.queries.detail.refetch.mockReturnValueOnce(pending.promise)
  const task = f.page.refreshRiskWorkflowContext()
  if (changed === 'read') f.user.read = false
  if (changed === 'actor') f.user.profile.id = '502'
  if (changed === 'ticket') f.props.ticketId = '43'
  if (changed === 'session') f.changeSession()
  if (changed === 'inactive') f.lifecycle.deactivate()
  pending.resolve({ data: f.detail(), isSuccess: true })
  await expect(task).rejects.toThrow()
  expect(f.queries['risk-workflow'].refetch).not.toHaveBeenCalled()
  expect(f.queries.transitions.refetch).not.toHaveBeenCalled()
})

it('失去写资格或工单关闭后同一用户仍能重开保留操作，读权撤销及换人禁止重开', async () => {
  const f = fixture()
  child(f, 'RemediationCommandDialog').props.onOperation({ operation_id: 'synthetic-K', ticket_id: '42', kind: 'assign' })
  f.page.riskCommandsVisible.value = false
  f.queries.detail.data.value.row.status = 'closed'
  f.queries['risk-workflow'].data.value = { ...f.context(), status: 'closed', writes_enabled: false, allowed_actions: [] }
  expect(Object.values(f.page.riskCommandPermissions.value).some(Boolean)).toBe(false)
  expect(button(f)).toBeTruthy()
  button(f).props.onClick()
  expect(f.page.riskCommandsVisible.value).toBe(true)
  expect(child(f, 'RemediationCommandDialog').props['can-read']).toBe(true)
  f.user.read = false
  expect(button(f)).toBeUndefined()
  expect(child(f, 'RemediationCommandDialog').props['can-read']).toBe(false)
  f.user.read = true; f.user.profile.id = '502'
  expect(button(f)).toBeUndefined()
  f.user.profile.id = '501'
  expect(button(f)).toBeTruthy()
})

it('父页读取失败不会卸载携带原号的子窗，失败重试仍保留父层恢复入口', async () => {
  const f = fixture()
  child(f, 'RemediationCommandDialog').props.onOperation({ operation_id: 'synthetic-K', ticket_id: '42', kind: 'assign' })
  f.queries.detail.isSuccess.value = false
  f.queries.detail.isError.value = true
  expect(child(f, 'RemediationCommandDialog')).toBeTruthy()
  expect(child(f, 'RemediationDialog')).toBeTruthy()
  expect(child(f, 'RemediationCommandDialog').props['can-read']).toBe(false)
  f.queries.detail.isSuccess.value = true
  f.queries.detail.isError.value = false
  f.queries['risk-workflow'].data.value = { ...f.context(), writes_enabled: false, allowed_actions: [] }
  await settle()
  expect(button(f)).toBeTruthy()
})


it.each(['read', 'actor', 'session'])('整改读取和刷新在 %s 变化后不继续请求', async changed => {
  const f = fixture()
  if (changed === 'read') f.user.read = false
  if (changed === 'actor') f.user.profile.id = '502'
  if (changed === 'session') f.changeSession()
  const options = f.queries['risk-workflow'].options
  expect(() => options.queryFn({ queryKey: unref(options.queryKey) })).toThrow()
  await expect(f.page.refreshRiskWorkflowContext()).rejects.toThrow()
  expect(f.queries.detail.refetch).not.toHaveBeenCalled()
  // 会话代次由调用时的同步守卫核对。
  if (changed !== 'session') expect(unref(options.enabled)).toBe(false)
})

it.each([403, 404])('上下文读取明确 %s 后保留子窗但关闭新的原号核查资格', status => {
  const f = fixture()
  f.queries['risk-workflow'].isError.value = true
  f.queries['risk-workflow'].error.value = { response: { status } }
  expect(child(f, 'RemediationCommandDialog').props['can-read']).toBe(false)
  expect(child(f, 'RemediationDialog').props['can-read']).toBe(false)
})


it('调用刷新回调前会话已失效时连首个工单读取也不发送', async () => {
  const f = fixture()
  // 先求值，覆盖 computed 没有收到会话代次响应式信号的情形。
  expect(f.page.canInspectRiskWorkflow.value).toBe(true)
  f.changeSession()
  await expect(f.page.refreshRiskWorkflowContext()).rejects.toThrow()
  expect(f.queries.detail.refetch).not.toHaveBeenCalled()
})

it('服务端明确撤销上下文读取后禁止自动重查上下文', () => {
  const f = fixture()
  f.queries['risk-workflow'].error.value = { response: { status: 403 } }
  const options = f.queries['risk-workflow'].options
  expect(unref(options.enabled)).toBe(false)
  expect(() => options.queryFn({ queryKey: unref(options.queryKey) })).toThrow()
})


it('普通工单与已发布动作继续由实际路由授权，整改查询要求风险读取资格', async () => {
  const f = fixture()
  f.queries['risk-workflow'].data.value = undefined
  f.queries['risk-workflow'].error.value = { response: { status: 404 } }
  f.user.read = false
  const detail = f.queries.detail.options
  const actions = f.queries.transitions.options
  expect(unref(detail.enabled)).toBe(true)
  expect(unref(actions.enabled)).toBe(true)
  await detail.queryFn({ queryKey: unref(detail.queryKey) })
  await actions.queryFn({ queryKey: unref(actions.queryKey) })
  expect(f.ticketApi).toHaveBeenCalledOnce()
  expect(unref(f.queries['risk-workflow'].options.enabled)).toBe(false)
})

it.each([403, 404])('资产子窗上下文 GET %s 通知父页后清除旧特权投影与恢复入口', status => {
  const f = fixture()
  const notify = child(f, 'RemediationDialog').props.onReadDenied
  expect(notify).toBeTypeOf('function')
  notify({ ticket_id: '42', status })
  expect(child(f, 'RemediationDialog').props['can-read']).toBe(false)
  expect(child(f, 'RemediationCommandDialog').props.current).toBeNull()
  expect(button(f)).toBeUndefined()
  expect(f.page.riskWorkflowContext.value).toBeUndefined()
})

it('资产子窗在关闭与失去写权后仍可由同人同票当前读上下文重开', () => {
  const f = fixture()
  f.page.riskWorkflowVisible.value = false
  f.queries.detail.data.value.row.status = 'closed'
  f.queries['risk-workflow'].data.value = { ...f.context(), status: 'closed', writes_enabled: false, allowed_actions: [] }
  const assetButton = () => render(f).find(n => n.props?.['data-testid'] === 'open-risk-remediation')
  expect(assetButton()).toBeTruthy()
  assetButton().props.onClick()
  expect(f.page.riskWorkflowVisible.value).toBe(true)
  expect(child(f, 'RemediationDialog').props['can-read']).toBe(true)
  expect(child(f, 'RemediationDialog').props['can-finish']).toBe(false)
  expect(child(f, 'RemediationDialog').props['can-review']).toBe(false)
  f.user.read = false
  expect(assetButton()).toBeUndefined()
})


it.each([403, 404])('资产上下文拒读 %s 后不得回退为普通工单动作或重查旧动作', status => {
  const f = fixture()
  child(f, 'RemediationDialog').props.onReadDenied({ ticket_id: '42', status })
  expect(f.page.activeRiskWorkflow.value).toBe(true)
  expect(render(f).find(n => n.props?.['data-testid'] === 'btn-transition-in_progress')).toBeUndefined()
  expect(f.page.availableActions.value).toEqual([])
  const options = f.queries.transitions.options
  expect(unref(options.enabled)).toBe(false)
  expect(() => options.queryFn({ queryKey: unref(options.queryKey) })).toThrow()
})


it('风险读取失效后已打开的普通分派和确认回调不能发出写请求', async () => {
  const f = fixture()
  f.queries['risk-workflow'].data.value = undefined
  const confirmation = deferred()
  f.confirm.mockReturnValue(confirmation.promise)
  f.page.openAssign()
  expect(f.page.assignVisible.value).toBe(true)
  f.page.assignForm.userId = '502'
  const cancelAssignment = f.page.unassign()
  const deletion = f.page.onDelete()
  expect(f.confirm).toHaveBeenCalledTimes(2)
  f.queries['risk-workflow'].data.value = { ...f.context(), status: 'closed' }
  expect(f.page.activeRiskWorkflow.value).toBe(false)
  child(f, 'RemediationDialog').props.onReadDenied({ ticket_id: '42', status: 403 })
  await f.page.submitAssign()
  confirmation.resolve(undefined)
  await Promise.all([cancelAssignment, deletion])
  expect(f.assignApi).not.toHaveBeenCalled()
  expect(f.deleteApi).not.toHaveBeenCalled()
})

it('原工单展示冻结版本的任务回执并从详情刷新', async () => {
  const f = fixture()
  f.queries.detail.data.value = f.detail('52')
  f.queries.detail.data.value.row.task_runs = [
    {
      operation_id: 'sample-operation-report', task_id: 'b3_report_task',
      action: 'ticket.evidence.report.generate', ticket_revision: '9007199254740993',
      definition_hash: 'synthetic-hash', node: 'assigned', status: 'succeeded',
      created_at: '2026-11-26T03:20:00Z', completed_at: '2026-11-26T03:21:00Z',
      result: { report_profile: 'evidence_summary_v1', submitted_field_count: 0, has_comment: false },
    },
    {
      operation_id: 'sample-operation-update', task_id: 'b3_update_task',
      action: 'activelist.document.update', ticket_revision: '50',
      definition_hash: 'synthetic-hash', node: 'in_progress', status: 'succeeded',
      created_at: '2026-11-26T03:22:00Z', completed_at: '2026-11-26T03:23:00Z',
      result: { document_revision: '9007199254740995', noop: true },
    },
  ]

  const card = render(f).find(n => n.props?.['data-testid'] === 'ticket-task-results')
  expect(card).toBeDefined()
  const contents = nodes(card)
  const text = contents.map(n => typeof n.children === 'string' ? n.children : '').join(' ')
  expect(text).toContain('工单证据摘要')
  expect(text).toContain('已提交证据字段 0 项')
  expect(text).toContain('未附说明')
  expect(text).toContain('清单数据版本 9007199254740995')
  expect(text).toContain('数据已是目标值')
  expect(text).toContain('9007199254740993')
  expect(text).toContain('b3_report_task')
  expect(contents.some(n => n.type === 'a' || n.props?.to || n.props?.href)).toBe(false)
  const refresh = contents.find(n => n.props?.['data-testid'] === 'ticket-task-results-refresh')
  await refresh.props.onClick()
  expect(f.queries.detail.refetch).toHaveBeenCalledOnce()
  expect(f.queries['risk-workflow'].refetch).not.toHaveBeenCalled()
})

it('任务失败显示友好原因，旧票和失去当前读权时隐藏任务结果', () => {
  const f = fixture()
  const resultNodes = () => render(f).find(n => n.props?.['data-testid'] === 'ticket-task-results')
  expect(resultNodes()).toBeUndefined()
  f.queries.detail.data.value.row.task_runs = [
    {
      operation_id: 'revoked-operation', task_id: 'b3_revoked_task',
      action: 'ticket.evidence.report.generate', ticket_revision: '41',
      definition_hash: 'synthetic-hash', node: 'assigned', status: 'held',
      reason: 'ticket_authorization_revoked', created_at: '2026-11-26T03:20:00Z',
    },
    {
      operation_id: 'future-operation', task_id: 'b3_future_task',
      action: 'activelist.document.update', ticket_revision: '42',
      definition_hash: 'synthetic-hash', node: 'assigned', status: 'failed_no_effect',
      reason: 'unexpected-internal-description', created_at: '2026-11-26T03:20:00Z',
    },
  ]
  const card = resultNodes()
  expect(card).toBeDefined()
  const text = nodes(card).map(n => typeof n.children === 'string' ? n.children : '').join(' ')
  expect(text).toContain('暂缓执行')
  expect(text).toContain('原操作人已无此工单任务的执行权限')
  expect(text).toContain('执行失败')
  expect(text).toContain('原因暂不可用')
  expect(text).not.toContain('unexpected-internal-description')
  f.user.read = false
  expect(resultNodes()).toBeUndefined()
})
