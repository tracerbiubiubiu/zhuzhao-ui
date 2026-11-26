import { reactive, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { deferred, httpError, preparePage, renderPage, setupPage, settle } from '@/test/sfcHarness'
import type { RemediationContextDto, RemediationEvidenceSource, RemediationOutcomeDto } from '@/api/risk/remediation'
import type { InstanceAction } from '@/api/ticket/instanceActions'
import source from './RemediationDialog.vue?raw'

preparePage(source)
const ticketId = '9007199254740993'
const contextBody = (): RemediationContextDto => ({
  ticket_id: ticketId, ticket_revision: '41', definition_version: '7', status: 'in_progress',
  items: [
    { link_id: '301', risk_id: '9007199254740995', risk_revision: '11', link_revision: '21', proposal_version: '0', remediation_state: 'open', title: '合成资产 A' },
    { link_id: '302', risk_id: '102', risk_revision: '12', link_revision: '22', proposal_version: '3', remediation_state: 'pending_verify', title: '合成资产 B' },
    { link_id: '303', risk_id: '103', risk_revision: '13', link_revision: '23', proposal_version: '4', remediation_state: 'rejected', title: '合成资产 C' },
    { link_id: '304', risk_id: '104', risk_revision: '14', link_revision: '24', proposal_version: '5', remediation_state: 'resolved', title: '合成资产 D' },
  ],
})
const outcome = (over: Partial<RemediationOutcomeDto> = {}): RemediationOutcomeDto => ({
  operation_id: 'synthetic-op-k', ticket_id: ticketId, ticket_revision: '42',
  items: [{ link_id: '301', risk_id: '9007199254740995', link_revision: '22', risk_revision: '12', proposal_version: '1', resolution_version: '0', result: 'pending_confirmation' }],
  terminal_allowed: false, ...over,
})

type DraftItem = { link_id: string; remediation_state: string; title: string }
type Page = {
  context: Ref<RemediationContextDto | null>
  contextLoading: Ref<boolean>
  contextError: Ref<string>
  selected: Ref<string[]>
  finishDrafts: Ref<Record<string, { measures: string; evidence: string[] }>>
  reviewDrafts: Ref<Record<string, { decision: '' | 'approve' | 'reject'; note: string }>>
  attempt: Ref<{ kind: 'finish' | 'review' | 'handoff'; input: Record<string, unknown>; signature: string } | null>
  result: Ref<RemediationOutcomeDto | null>
  busy: Ref<boolean>
  error: Ref<string>
  uncertain: Ref<boolean>
  savedOperation: Ref<string>
  rejected: Ref<boolean>
  verificationNote: Ref<string>
  sessionInvalid: Ref<boolean>
  usableEvidence: Ref<RemediationEvidenceSource[]>
  selectedItems: Ref<DraftItem[]>
  mixedSelection: Ref<boolean>
  inputChanged: Ref<boolean>
  canSubmitFinish: Ref<boolean>
  canSubmitReview: Ref<boolean>
  canSubmitHandoff: Ref<boolean>
  successorUserId: Ref<string>
  handoffReason: Ref<string>
  handoffPendingItems: Ref<DraftItem[]>
  canInspect: Ref<boolean>
  canRetry: Ref<boolean>
  finished: Ref<boolean>
  dismissLocked: Ref<boolean>
  items: Ref<DraftItem[]>
  loadContext(): Promise<void>
  toggleSelect(item: DraftItem): void
  canToggle(item: DraftItem): boolean
  submitFinish(): Promise<void>
  submitReview(): Promise<void>
  submitHandoff(): Promise<void>
  inspect(): Promise<void>
  retry(): Promise<void>
  startNext(): Promise<void>
  close(): void
  stateText: Record<string, string>
  resultText: Record<string, string>
}

type Api = {
  getRemediationContextApi: ReturnType<typeof vi.fn>
  finishRemediationApi: ReturnType<typeof vi.fn>
  reviewRemediationApi: ReturnType<typeof vi.fn>
  handoffRemediationApi: ReturnType<typeof vi.fn>
  getRemediationOperationApi: ReturnType<typeof vi.fn>
}

type FixtureProps = Partial<{ modelValue: boolean; canRead: boolean; canFinish: boolean; canReview: boolean; canHandoff: boolean }>

const stubbedComponents = ['ElAlert', 'ElButton', 'ElCheckbox', 'ElCheckboxGroup', 'ElDialog', 'ElEmpty', 'ElInput', 'ElRadio', 'ElRadioGroup', 'ElTag']

function fixture(configure?: (api: Api) => void, propOverrides: FixtureProps = {}) {
  const props = reactive({
    modelValue: true, ticketId, canRead: true, canFinish: true, canReview: true, canHandoff: false, ...propOverrides,
    customDataPatch: undefined as Record<string, unknown> | undefined,
    comment: undefined as string | undefined,
    ticketActions: undefined as InstanceAction[] | undefined,
    refreshContext: undefined as (() => Promise<void>) | undefined,
    currentActorId: '501' as string | undefined,
    attachments: [
      { ref: 'ticket/2026/att-1.bin', file_name: '合成证据.bin', version: '9007199254740997' },
      { ref: 'ticket/2026/att-2.log', file_name: '无版本.log', version: '' },
    ] as RemediationEvidenceSource[],
  })
  const api: Api = {
    getRemediationContextApi: vi.fn().mockResolvedValue(contextBody()),
    finishRemediationApi: vi.fn().mockResolvedValue(outcome()),
    reviewRemediationApi: vi.fn().mockResolvedValue(outcome()),
    handoffRemediationApi: vi.fn().mockResolvedValue(outcome()),
    getRemediationOperationApi: vi.fn(),
  }
  configure?.(api)
  let generation = 1
  let operationNumber = 0
  const newCommandId = vi.fn(() => ++operationNumber === 1 ? 'synthetic-op-k' : `synthetic-op-k-${operationNumber}`)
  const { page } = setupPage<Page>(source, {
    '@/views/ticket/detail/TransitionActionDialog.vue': {},
    // UserPicker 内部走 people 搜索请求，测试以空替身注入。
    '@/components/UserPicker/index.vue': { default: { name: 'UserPicker' } },
    'element-plus': Object.fromEntries(stubbedComponents.map(name => [name, { name }])),
    '@/api/risk/remediation': api,
    '@/api/risk/remediationCommands': { newRemediationCommandId: newCommandId },
    '@/common/auth/tokenStorage': { getSessionGeneration: () => generation },
  }, props)
  return { props, api, page, newCommandId, changeSession: () => generation++ }
}

const flatten = (input: unknown): any[] => {
  if (Array.isArray(input)) return input.flatMap(flatten)
  if (!input || typeof input !== 'object') return []
  const node = input as any
  const out = [node]
  const children = node.children
  if (Array.isArray(children)) out.push(...children.flatMap(flatten))
  else if (children && typeof children === 'object') {
    // 组件 vnode 的具名插槽：逐个调用展开真实内容
    for (const slot of Object.values(children)) {
      if (typeof slot === 'function') out.push(...flatten((slot as () => unknown)()))
    }
  }
  return out
}
const textOf = (tree: unknown) => flatten(tree).map(node => typeof (node as any).children === 'string' ? (node as any).children : '').join(' ')
const findId = (tree: unknown, testId: string) => flatten(tree).find(node => (node as any).props?.['data-testid'] === testId)
/** el-alert 文案走 title prop（无插槽内容），单独断言 */
const hasAlert = (tree: unknown, text: string) => flatten(tree).some(node =>
  typeof (node as any).props?.title === 'string' && (node as any).props.title.includes(text))

/** 渲染真实模板并展开弹窗默认/页脚插槽（DispatchDialog.test.ts 同法） */
function renderDialog(page: Page, props: Record<string, unknown>) {
  const tree = renderPage(source, page, props)
  const slots = tree.children as any
  return { tree, body: slots?.default?.() ?? [], footer: slots?.footer?.() ?? [] }
}

async function readyFinish(page: Page) {
  await settle()
  page.toggleSelect(page.items.value[0]!)
  page.finishDrafts.value['301']!.measures = '已换用合成安全配置并回归通过'
  page.finishDrafts.value['301']!.evidence = ['ticket/2026/att-1.bin']
  await settle()
  return page.canSubmitFinish.value
}

/** 构造一个提交已发出但响应未归位（丢响应/在途）的在办弹窗 */
async function lostAttempt() {
  const pending = deferred<RemediationOutcomeDto>()
  const context = fixture(api => { api.finishRemediationApi.mockImplementationOnce(() => pending.promise) })
  expect(await readyFinish(context.page)).toBe(true)
  const first = context.page.submitFinish()
  await settle()
  expect(context.page.busy.value).toBe(true)
  expect(context.page.attempt.value?.input.operation_id).toBe('synthetic-op-k')
  return { ...context, first, pending }
}

describe('逐资产整改弹窗（加载与只读）', () => {
  it('打开即按工单号加载上下文，五态与大 ID 原样展示', async () => {
    const { api, page, props } = fixture()
    await settle()
    expect(api.getRemediationContextApi).toHaveBeenCalledTimes(1)
    expect(api.getRemediationContextApi).toHaveBeenCalledWith(ticketId)
    expect(page.items.value.map(item => item.remediation_state)).toEqual(['open', 'pending_verify', 'rejected', 'resolved'])
    expect(page.stateText.resolved).toBe('已生效')
    const { body } = renderDialog(page, props)
    expect(findId(body, 'remediation-items')).toBeDefined()
    const text = textOf(findId(body, 'remediation-items'))
    expect(text).toContain('合成资产 A')
    expect(text).toContain('9007199254740995')
    expect(text).toContain('风险版本 11 / 关联版本 21 / 提案版本 0')
    expect(textOf(body)).toContain('票修订 41，定义版本 7')
  })

  it('上下文 403/404 保持安全语义，不冒充空上下文', async () => {
    const denied = fixture(api => api.getRemediationContextApi.mockRejectedValueOnce(httpError(403)))
    await settle()
    expect(denied.page.contextError.value).toBe('无权查看，请联系管理员')
    expect(denied.page.context.value).toBeNull()
    expect(denied.page.items.value).toEqual([])
    const missing = fixture(api => api.getRemediationContextApi.mockRejectedValueOnce(httpError(404)))
    await settle()
    expect(missing.page.contextError.value).toContain('没有逐资产办理上下文')
    expect(missing.page.items.value).toEqual([])
  })

  it('无读取资格不发起加载；无写权时整表只读且提交全部拒绝', async () => {
    const unreadable = fixture(undefined, { canRead: false })
    await settle()
    expect(unreadable.api.getRemediationContextApi).not.toHaveBeenCalled()
    expect(unreadable.page.items.value).toEqual([])
    const readonly = fixture(undefined, { canFinish: false, canReview: false })
    await settle()
    expect(readonly.page.items.value.every(item => !readonly.page.canToggle(item))).toBe(true)
    readonly.page.toggleSelect(readonly.page.items.value[0]!)
    expect(readonly.page.selected.value).toEqual([])
    expect(readonly.page.canSubmitFinish.value).toBe(false)
    expect(readonly.page.canSubmitReview.value).toBe(false)
    await readonly.page.submitFinish()
    await readonly.page.submitReview()
    expect(readonly.api.finishRemediationApi).not.toHaveBeenCalled()
    expect(readonly.api.reviewRemediationApi).not.toHaveBeenCalled()
    const { body } = renderDialog(readonly.page, readonly.props)
    expect(hasAlert(body, '仅可查看')).toBe(true)
  })

  it('无带版本附件时给出提示且证据不可选', async () => {
    const { api, page, props } = fixture()
    await settle()
    props.attachments = [{ ref: 'ticket/att-2.log', file_name: '无版本.log', version: '' }]
    page.toggleSelect(page.items.value[0]!)
    page.finishDrafts.value['301']!.measures = '合成措施'
    await settle()
    expect(page.usableEvidence.value).toEqual([])
    expect(page.canSubmitFinish.value).toBe(false)
    const { body } = renderDialog(page, props)
    expect(hasAlert(body, '没有可引用的附件或公开记录')).toBe(true)
    expect(api.finishRemediationApi).not.toHaveBeenCalled()
  })
})

describe('选择纪律与办理提交', () => {
  it('现势 owner 可用已发布复测打回动作恢复旧提案，双权限仍可选择整改办理', async () => {
    const restored = contextBody()
    Object.assign(restored.items[0]!, {
      remediation_state: 'pending_acceptance', pending_acceptance_recoverable: true,
      proposal_version: '9007199254740997', is_risk_owner: true,
    })
    const { api, page, props } = fixture(api => api.getRemediationContextApi.mockResolvedValue(restored))
    props.ticketActions = [{ id: 'review-reject', to: 'in_progress', title: '打回重办', fields: [], commentRequired: false, expectedRevision: '41', definitionVersion: '7' }]
    await settle()
    page.toggleSelect(page.items.value[0]!)
    expect(page.reviewDrafts.value['301']).toBeDefined()
    expect(page.finishDrafts.value['301']).toBeDefined()
    expect(page.mixedSelection.value).toBe(false)
    page.reviewDrafts.value['301']!.decision = 'approve'
    page.reviewDrafts.value['301']!.note = '旧提案需重新办理'
    expect(page.canSubmitReview.value).toBe(false)
    const approve = flatten(findId(renderDialog(page, props).body, 'remediation-decision')).find(node => node.props?.value === 'approve')
    expect(approve?.props?.disabled).toBe(true)
    await page.submitReview()
    expect(api.reviewRemediationApi).not.toHaveBeenCalled()
    page.reviewDrafts.value['301']!.decision = 'reject'
    expect(page.canSubmitReview.value).toBe(true)
    await page.submitReview()
    expect(api.reviewRemediationApi).toHaveBeenCalledWith({
      operation_id: 'synthetic-op-k', ticket_id: ticketId, expected_ticket_revision: '41', definition_version: '7',
      items: [{ link_id: '301', expected_link_revision: '21', expected_risk_revision: '11', expected_proposal_version: '9007199254740997', decision: 'reject', note: '旧提案需重新办理', evidence: [] }],
    })
    expect(api.finishRemediationApi).not.toHaveBeenCalled()
  })

  it.each([
    { is_risk_owner: false }, { is_risk_owner: undefined },
    { pending_acceptance_recoverable: false }, { pending_acceptance_recoverable: undefined },
    { proposal_version: '0' }, { proposal_version: '' }, { proposal_version: '9223372036854775808' },
  ])('复测恢复拒绝不满足资格的上下文 %j', async override => {
    const restored = contextBody()
    Object.assign(restored.items[0]!, {
      remediation_state: 'pending_acceptance', pending_acceptance_recoverable: true,
      proposal_version: '3', is_risk_owner: true, ...override,
    })
    const { api, page } = fixture(api => api.getRemediationContextApi.mockResolvedValue(restored), { canFinish: false })
    await settle()
    expect(page.canToggle(page.items.value[0]!)).toBe(false)
    page.toggleSelect(page.items.value[0]!)
    await page.submitReview()
    expect(api.reviewRemediationApi).not.toHaveBeenCalled()
  })

  it.each([undefined, []] as const)('复测恢复没有复测权或缺少已发布打回动作(%j)时不提交', async actions => {
    const restored = contextBody()
    Object.assign(restored.items[0]!, {
      remediation_state: 'pending_acceptance', pending_acceptance_recoverable: true, proposal_version: '3', is_risk_owner: true,
    })
    const denied = fixture(api => api.getRemediationContextApi.mockResolvedValue(restored), { canFinish: false, canReview: false })
    await settle()
    expect(denied.page.canToggle(denied.page.items.value[0]!)).toBe(false)
    const { api, page, props } = fixture(api => api.getRemediationContextApi.mockResolvedValue(restored), { canFinish: false })
    props.ticketActions = actions as InstanceAction[] | undefined
    await settle()
    page.toggleSelect(page.items.value[0]!)
    expect(page.reviewDrafts.value['301']).toBeDefined()
    Object.assign(page.reviewDrafts.value['301']!, { decision: 'reject', note: '重新办理' })
    await page.submitReview()
    expect(api.reviewRemediationApi).not.toHaveBeenCalled()
    expect(page.error.value).toContain('已发布办理动作')
  })

  it('当前办理入口可收回已失效的待接受项', async () => {
    const restored = contextBody()
    Object.assign(restored.items[0]!, {
      remediation_state: 'pending_acceptance', pending_acceptance_recoverable: true,
    })
    const { page } = fixture(api => api.getRemediationContextApi.mockResolvedValue(restored))
    await page.loadContext()
    expect(page.canToggle(page.items.value[0]!)).toBe(true)
  })

  it('只选未生效项：resolved 不可选；open/rejected 走办理草稿，pending_verify 走复测草稿', async () => {
    const { page } = fixture()
    await settle()
    const [open, verify, rejected, resolved] = page.items.value
    expect(page.canToggle(open!)).toBe(true)
    expect(page.canToggle(verify!)).toBe(true)
    expect(page.canToggle(rejected!)).toBe(true)
    expect(page.canToggle(resolved!)).toBe(false)
    page.toggleSelect(open!)
    expect(Object.keys(page.finishDrafts.value)).toEqual(['301'])
    page.toggleSelect(verify!)
    expect(Object.keys(page.reviewDrafts.value)).toEqual(['302'])
    expect(page.mixedSelection.value).toBe(true)
    expect(page.canSubmitFinish.value).toBe(false)
    expect(page.canSubmitReview.value).toBe(false)
    page.toggleSelect(verify!)
    expect(page.reviewDrafts.value['302']).toBeUndefined()
    expect(page.mixedSelection.value).toBe(false)
  })

  it('单独持有复测权时待办理项不可选，复测项可选', async () => {
    const { page, props } = fixture()
    await settle()
    props.canFinish = false
    expect(page.canToggle(page.items.value[0]!)).toBe(false)
    expect(page.canToggle(page.items.value[1]!)).toBe(true)
    expect(page.canToggle(page.items.value[2]!)).toBe(false)
  })

  it('措施与带版本证据齐备才允许办理提交，并按上下文快照精确构造原请求', async () => {
    const { api, page, props } = fixture()
    await settle()
    page.toggleSelect(page.items.value[0]!)
    expect(page.canSubmitFinish.value).toBe(false)
    page.finishDrafts.value['301']!.measures = '已换用合成安全配置并回归通过'
    expect(page.canSubmitFinish.value).toBe(false)
    page.finishDrafts.value['301']!.evidence = ['ticket/2026/att-1.bin', 'ticket/2026/att-2.log']
    expect(page.canSubmitFinish.value).toBe(false) // 无版本附件不在可选集合
    page.finishDrafts.value['301']!.evidence = ['ticket/2026/att-1.bin']
    expect(page.canSubmitFinish.value).toBe(true)
    await page.submitFinish()
    expect(api.finishRemediationApi).toHaveBeenCalledTimes(1)
    const input = api.finishRemediationApi.mock.calls[0]![0]
    expect(input).toEqual({
      operation_id: 'synthetic-op-k', ticket_id: ticketId, expected_ticket_revision: '41', definition_version: '7',
      items: [{
        link_id: '301', expected_link_revision: '21', expected_risk_revision: '11', resolution: 'fixed',
        measures: '已换用合成安全配置并回归通过', evidence: [{ kind: 'file', ref: 'ticket/2026/att-1.bin', version: '9007199254740997' }],
      }],
    })
    expect(Object.keys(input).sort()).toEqual(['definition_version', 'expected_ticket_revision', 'items', 'operation_id', 'ticket_id'])
    expect(page.uncertain.value).toBe(false)
    expect(page.result.value?.items[0]?.result).toBe('pending_confirmation')
    expect(page.savedOperation.value).toBe('synthetic-op-k')
    const { body } = renderDialog(page, props)
    const outcomeText = textOf(findId(body, 'remediation-outcome'))
    expect(outcomeText).toContain('已提交待复测')
  })

  it('公共输入原样透传：patch 与 comment 携带，空值省略', async () => {
    const { api, page, props } = fixture()
    await settle()
    props.customDataPatch = { synth_field: 5, nested: { key: '合成值' } }
    props.comment = '合成办理说明'
    page.toggleSelect(page.items.value[0]!)
    page.finishDrafts.value['301']!.measures = '合成措施'
    page.finishDrafts.value['301']!.evidence = ['ticket/2026/att-1.bin']
    await page.submitFinish()
    const input = api.finishRemediationApi.mock.calls[0]![0]
    expect(input.custom_data_patch).toEqual({ synth_field: 5, nested: { key: '合成值' } })
    expect(input.comment).toBe('合成办理说明')
  })

  it('复测 A 通过/B 打回：决定与说明齐备才可提交，证据恒空数组', async () => {
    const approve = fixture()
    await settle()
    approve.page.toggleSelect(approve.page.items.value[1]!)
    expect(approve.page.canSubmitReview.value).toBe(false)
    approve.page.reviewDrafts.value['302']!.decision = 'approve'
    expect(approve.page.canSubmitReview.value).toBe(false)
    approve.page.reviewDrafts.value['302']!.note = '合成复核通过'
    expect(approve.page.canSubmitReview.value).toBe(true)
    await approve.page.submitReview()
    expect(approve.api.reviewRemediationApi).toHaveBeenCalledTimes(1)
    expect(approve.api.reviewRemediationApi.mock.calls[0]![0]).toEqual({
      operation_id: 'synthetic-op-k', ticket_id: ticketId, expected_ticket_revision: '41', definition_version: '7',
      items: [{ link_id: '302', expected_link_revision: '22', expected_risk_revision: '12', expected_proposal_version: '3', decision: 'approve', note: '合成复核通过', evidence: [] }],
    })
    const reject = fixture()
    await settle()
    reject.page.toggleSelect(reject.page.items.value[1]!)
    reject.page.reviewDrafts.value['302']!.decision = 'reject'
    reject.page.reviewDrafts.value['302']!.note = '合成打回重办'
    await reject.page.submitReview()
    expect(reject.api.reviewRemediationApi.mock.calls[0]![0].items[0]).toMatchObject({ decision: 'reject', note: '合成打回重办', evidence: [] })
  })
})

describe('原K与原请求明确回执', () => {
  it.each(['finish', 'review'] as const)('%s 明确409后可显式刷新改写并提交新K，继续显示旧K', async kind => {
    const { api, page, props } = fixture(api => {
      api.finishRemediationApi.mockRejectedValueOnce(httpError(409, '部分项目冲突，未生效'))
      api.reviewRemediationApi.mockRejectedValueOnce(httpError(409, '版本冲突，未生效'))
    })
    await settle()
    const selectDraft = () => {
      page.toggleSelect(page.items.value[kind === 'finish' ? 0 : 1]!)
      if (kind === 'finish') Object.assign(page.finishDrafts.value['301']!, { measures: '修订后的措施', evidence: ['ticket/2026/att-1.bin'] })
      else Object.assign(page.reviewDrafts.value['302']!, { decision: 'reject', note: '修订后的打回说明' })
    }
    selectDraft()
    const post = kind === 'finish' ? api.finishRemediationApi : api.reviewRemediationApi
    const submit = kind === 'finish' ? page.submitFinish : page.submitReview
    await submit()
    const original = JSON.parse(JSON.stringify(post.mock.calls[0]![0]))
    expect(page.uncertain.value).toBe(false)
    expect(page.rejected.value).toBe(true)
    expect(page.dismissLocked.value).toBe(false)
    expect(page.canRetry.value).toBe(false)
    const refresh = findId(renderDialog(page, props).footer, 'remediation-rejected-refresh')
    expect(refresh?.props?.disabled).toBe(false)
    const fresh = contextBody()
    fresh.ticket_revision = '44'
    fresh.items[0]!.link_revision = '25'
    api.getRemediationContextApi.mockResolvedValueOnce(fresh)
    refresh.props.onClick()
    await settle()
    expect(post).toHaveBeenCalledTimes(1)
    expect(page.attempt.value).toBeNull()
    expect(findId(renderDialog(page, props).footer, `remediation-${kind}`)).toBeDefined()
    selectDraft()
    post.mockResolvedValueOnce(outcome({ operation_id: 'synthetic-op-k-2' }))
    await submit()
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[1]![0]).toMatchObject({ operation_id: 'synthetic-op-k-2', expected_ticket_revision: '44' })
    expect(post.mock.calls[0]![0]).toEqual(original)
    expect(textOf(renderDialog(page, props).body)).toContain('synthetic-op-k-2')
    expect(textOf(renderDialog(page, props).body).replaceAll('synthetic-op-k-2', '')).toContain('synthetic-op-k')
  })

  it('409 后等待真实父回调更新钉住的动作及自身上下文，再显式提交才生成新号', async () => {
    const { api, page, props, newCommandId } = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(409)))
    props.ticketActions = [{ id: 'verify', to: 'pending_verify', title: '送复测', expectedRevision: '41', definitionVersion: '7', fields: [], commentRequired: false }]
    await readyFinish(page)
    await page.submitFinish()
    const original = page.attempt.value
    const parent = deferred<void>()
    props.refreshContext = vi.fn(async () => {
      await parent.promise
      props.ticketActions = [{ ...props.ticketActions![0]!, expectedRevision: '44' }]
    })
    const fresh = contextBody()
    fresh.ticket_revision = '44'
    fresh.items[0]!.link_revision = '25'
    api.getRemediationContextApi.mockResolvedValueOnce(fresh)
    const refresh = page.startNext()
    expect(props.refreshContext).toHaveBeenCalledOnce()
    expect(page.attempt.value).toBe(original)
    expect(page.busy.value).toBe(true)
    expect(api.getRemediationContextApi).toHaveBeenCalledTimes(1)
    parent.resolve()
    await refresh
    expect(page.context.value?.ticket_revision).toBe('44')
    expect(page.attempt.value).toBeNull()
    expect(newCommandId).toHaveBeenCalledOnce()
    expect(api.finishRemediationApi).toHaveBeenCalledOnce()
    await readyFinish(page)
    api.finishRemediationApi.mockResolvedValueOnce(outcome({ operation_id: 'synthetic-op-k-2' }))
    await page.submitFinish()
    expect(api.finishRemediationApi).toHaveBeenLastCalledWith(expect.objectContaining({
      operation_id: 'synthetic-op-k-2', expected_ticket_revision: '44',
      items: [expect.objectContaining({ expected_link_revision: '25' })],
    }))
    expect(newCommandId).toHaveBeenCalledTimes(2)
  })

  it.each(['parent', 'context'] as const)('409 后 %s 刷新失败保留原请求、拒绝和核查资格', async failure => {
    const { api, page, props, newCommandId } = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(409)))
    await readyFinish(page)
    await page.submitFinish()
    const original = page.attempt.value
    props.refreshContext = failure === 'parent'
      ? vi.fn().mockRejectedValue(httpError(403))
      : vi.fn().mockResolvedValue(undefined)
    if (failure === 'context') api.getRemediationContextApi.mockRejectedValueOnce(new Error('资产上下文刷新失败'))
    await page.startNext()
    expect(page.attempt.value).toBe(original)
    expect(page.rejected.value).toBe(true)
    expect(page.context.value?.ticket_revision).toBe('41')
    expect(page.canInspect.value).toBe(true)
    expect(page.canSubmitFinish.value).toBe(false)
    expect(page.error.value).toContain('刷新失败')
    expect(newCommandId).toHaveBeenCalledOnce()
    expect(api.finishRemediationApi).toHaveBeenCalledOnce()
  })

  it.each(['read', 'ticket', 'actor', 'close', 'session'] as const)('父刷新期间 %s 变化阻止后续 GET 并保留原号', async change => {
    const { api, page, props, changeSession, newCommandId } = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(409)))
    await readyFinish(page)
    await page.submitFinish()
    const original = page.attempt.value
    const parent = deferred<void>()
    props.refreshContext = vi.fn(() => parent.promise)
    const refresh = page.startNext()
    if (change === 'read') props.canRead = false
    if (change === 'ticket') props.ticketId = '999'
    if (change === 'actor') props.currentActorId = '502'
    if (change === 'close') props.modelValue = false
    if (change === 'session') changeSession()
    parent.resolve()
    await refresh
    expect(page.attempt.value).toBe(original)
    expect(api.getRemediationContextApi).toHaveBeenCalledTimes(1)
    expect(api.finishRemediationApi).toHaveBeenCalledOnce()
    expect(newCommandId).toHaveBeenCalledOnce()
    await page.inspect()
    expect(api.getRemediationOperationApi).not.toHaveBeenCalled()
  })

  it.each(['ticket', 'actions'] as const)('刷新后的 %s 不匹配时保留原请求，不能进入新提交', async mismatch => {
    const { api, page, props } = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(409)))
    await readyFinish(page)
    await page.submitFinish()
    const original = page.attempt.value
    props.refreshContext = vi.fn().mockResolvedValue(undefined)
    const fresh = contextBody()
    fresh.ticket_revision = '44'
    if (mismatch === 'ticket') fresh.ticket_id = '999'
    else props.ticketActions = [{ id: 'verify', to: 'pending_verify', title: '送复测', expectedRevision: '41', definitionVersion: '7', fields: [], commentRequired: false }]
    api.getRemediationContextApi.mockResolvedValueOnce(fresh)
    await page.startNext()
    expect(page.attempt.value).toBe(original)
    expect(page.context.value?.ticket_revision).toBe('41')
    expect(page.rejected.value).toBe(true)
    expect(page.error.value).toContain('不匹配')
    expect(api.finishRemediationApi).toHaveBeenCalledOnce()
  })

  it.each(['read', 'ticket', 'actor', 'close', 'session'] as const)('自身上下文 GET 期间 %s 变化拒绝晚回包，保留原号', async change => {
    const { api, page, props, changeSession } = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(409)))
    await readyFinish(page)
    await page.submitFinish()
    const original = page.attempt.value
    const pending = deferred<RemediationContextDto>()
    props.refreshContext = vi.fn().mockResolvedValue(undefined)
    api.getRemediationContextApi.mockImplementationOnce(() => pending.promise)
    const refresh = page.startNext()
    await settle()
    expect(api.getRemediationContextApi).toHaveBeenCalledTimes(2)
    if (change === 'read') props.canRead = false
    if (change === 'ticket') props.ticketId = '999'
    if (change === 'actor') props.currentActorId = '502'
    if (change === 'close') props.modelValue = false
    if (change === 'session') changeSession()
    pending.resolve({ ...contextBody(), ticket_revision: '44' })
    await refresh
    expect(page.attempt.value).toBe(original)
    expect(page.context.value?.ticket_revision).toBe('41')
    expect(api.finishRemediationApi).toHaveBeenCalledOnce()
    await page.loadContext()
    await page.startNext()
    await page.inspect()
    expect(api.getRemediationContextApi).toHaveBeenCalledTimes(2)
    expect(api.getRemediationOperationApi).not.toHaveBeenCalled()
  })

  it.each([400, 403, 422])('明确 POST %s 拒绝后仍保留原号核查入口', async status => {
    const { api, page } = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(status)))
    await readyFinish(page)
    await page.submitFinish()
    expect(page.uncertain.value).toBe(false)
    expect(page.canRetry.value).toBe(false)
    expect(page.canInspect.value).toBe(true)
    api.getRemediationOperationApi.mockRejectedValueOnce(httpError(404))
    await page.inspect()
    expect(page.rejected.value).toBe(true)
    expect(page.uncertain.value).toBe(false)
    expect(page.attempt.value?.input.operation_id).toBe('synthetic-op-k')
  })

  it.each([500, 503])('POST %s 与随后核查409均保持未知原请求，刷新不解锁也不隐式重发', async status => {
    const { api, page, props } = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(status)))
    await readyFinish(page)
    await page.submitFinish()
    const original = { ...page.attempt.value! }
    page.startNext()
    await page.loadContext()
    api.getRemediationOperationApi.mockRejectedValueOnce(httpError(409))
    await page.inspect()
    expect(page.uncertain.value).toBe(true)
    expect(page.attempt.value).toEqual(original)
    expect(findId(renderDialog(page, props).footer, 'remediation-rejected-refresh')).toBeUndefined()
    expect(api.finishRemediationApi).toHaveBeenCalledTimes(1)
    expect(page.canSubmitFinish.value).toBe(false)
  })

  it.each([400, 403, 409, 422])('未知写入原号续办遇 %s 仍不能证明首次未提交，继续保留原请求', async status => {
    const { api, page, props } = fixture(api => api.finishRemediationApi
      .mockRejectedValueOnce(new Error('响应丢失')).mockRejectedValueOnce(httpError(status)))
    await readyFinish(page)
    await page.submitFinish()
    const original = JSON.parse(JSON.stringify(page.attempt.value))
    api.getRemediationOperationApi.mockRejectedValueOnce(httpError(404))
    await page.inspect()
    await page.retry()
    expect(page.uncertain.value).toBe(true)
    page.startNext()
    await settle()
    expect(page.attempt.value).toEqual(original)
    expect(api.finishRemediationApi).toHaveBeenCalledTimes(2)
    expect(api.finishRemediationApi.mock.calls[1]![0]).toEqual(api.finishRemediationApi.mock.calls[0]![0])
    expect(findId(renderDialog(page, props).footer, 'remediation-rejected-refresh')).toBeUndefined()
    expect(page.canSubmitFinish.value).toBe(false)
  })

  it('丢响应保留原K；输入漂移仅警示；续办只重发原请求', async () => {
    const { api, page, props, first, pending } = await lostAttempt()
    const original = { ...page.attempt.value! }
    props.ticketId = '999999'
    expect(page.inputChanged.value).toBe(true)
    expect(hasAlert(renderDialog(page, props).body, '仍在核查原操作与原请求')).toBe(true)
    props.ticketId = ticketId
    expect(page.inputChanged.value).toBe(false)
    pending.reject(new Error('响应丢失'))
    await first
    expect(page.uncertain.value).toBe(true)
    expect(page.attempt.value).toEqual(original)
    api.getRemediationOperationApi.mockRejectedValueOnce(httpError(404))
    await page.inspect()
    await page.retry()
    expect(api.finishRemediationApi).toHaveBeenCalledTimes(2)
    expect(api.finishRemediationApi.mock.calls[1]![0]).toEqual(api.finishRemediationApi.mock.calls[0]![0])
    expect(page.attempt.value!.input.operation_id).toBe('synthetic-op-k')
    expect(page.uncertain.value).toBe(false)
  })

  it.each([500, 503])('finish %s 保持待核查与原请求；只读核查按原号且 404 不代表未提交', async status => {
    const context = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(status)))
    await readyFinish(context.page)
    await context.page.submitFinish()
    const original = { ...context.page.attempt.value! }
    expect(context.page.uncertain.value).toBe(true)
    expect(context.page.error.value.length).toBeGreaterThan(0)
    context.api.getRemediationOperationApi.mockRejectedValueOnce(httpError(404))
    await context.page.inspect()
    expect(context.api.finishRemediationApi).toHaveBeenCalledTimes(1)
    expect(context.api.getRemediationOperationApi).toHaveBeenCalledTimes(1)
    expect(context.api.getRemediationOperationApi).toHaveBeenCalledWith('synthetic-op-k')
    expect(context.page.attempt.value).toEqual(original)
    expect(context.page.uncertain.value).toBe(true)
    expect(context.page.error.value).toContain('不代表未提交')
    context.api.getRemediationOperationApi.mockResolvedValueOnce({ ...outcome(), ticket_revision: '43' })
    await context.page.inspect()
    expect(context.page.result.value?.ticket_revision).toBe('43')
    expect(context.page.verificationNote.value).toContain('只读核查')
    expect(context.page.finished.value).toBe(true)
    expect(context.page.canRetry.value).toBe(false)
    expect(context.page.savedOperation.value).toBe('synthetic-op-k')
  })

  it.each([403, 404])('未知结果核查 %s 后仍可显式关闭或 Esc，重开原票保留 K 与未知尝试', async status => {
    const f = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(new Error('响应丢失')))
    await readyFinish(f.page)
    await f.page.submitFinish()
    const original = f.page.attempt.value
    expect(f.page.dismissLocked.value).toBe(false)
    f.api.getRemediationOperationApi.mockRejectedValueOnce(httpError(status))
    await f.page.inspect()
    const { tree, footer } = renderDialog(f.page, f.props)
    expect(tree.props?.['close-on-press-escape']).toBe(true)
    expect(tree.props?.['show-close']).toBe(true)
    expect(flatten(footer).find(node => textOf(node).includes('关闭并保留本次操作'))?.props?.disabled).toBe(false)
    f.props.modelValue = false
    f.props.canFinish = false
    f.props.canReview = false
    f.props.modelValue = true
    await settle()
    expect(f.page.attempt.value).toBe(original)
    expect(f.page.uncertain.value).toBe(true)
    expect(f.page.canInspect.value).toBe(true)
    expect(f.page.canRetry.value).toBe(false)
    expect(f.api.finishRemediationApi).toHaveBeenCalledOnce()
    f.api.getRemediationOperationApi.mockResolvedValueOnce(outcome())
    await f.page.inspect()
    expect(f.page.result.value?.operation_id).toBe('synthetic-op-k')
  })

  it('结果未知必须先显式 GET 404，再在原输入和当前写权均有效时才允许原 K 重发', async () => {
    const f = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(new Error('响应丢失')))
    await readyFinish(f.page)
    await f.page.submitFinish()
    expect(f.page.canRetry.value).toBe(false)
    await f.page.retry()
    expect(f.api.finishRemediationApi).toHaveBeenCalledOnce()
    f.api.getRemediationOperationApi.mockRejectedValueOnce(httpError(403))
    await f.page.inspect()
    expect(f.page.canRetry.value).toBe(false)
    f.api.getRemediationOperationApi.mockRejectedValueOnce(httpError(404))
    await f.page.inspect()
    expect(f.page.uncertain.value).toBe(true)
    expect(f.page.canRetry.value).toBe(true)
    f.props.comment = '变更后的输入'
    expect(f.page.canRetry.value).toBe(false)
    f.props.comment = undefined
    f.props.canFinish = false
    expect(f.page.canRetry.value).toBe(false)
    f.props.canFinish = true
    expect(f.page.canRetry.value).toBe(true)
    f.api.getRemediationOperationApi.mockRejectedValueOnce(httpError(403))
    await f.page.inspect()
    expect(f.page.canRetry.value).toBe(false)
    expect(f.page.uncertain.value).toBe(true)
    expect(f.page.rejected.value).toBe(false)
  })

  it('同 K 回执若属于另一工单仍保持未知且不显示结果', async () => {
    const f = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(new Error('响应丢失')))
    await readyFinish(f.page)
    await f.page.submitFinish()
    f.api.getRemediationOperationApi.mockResolvedValueOnce(outcome({ ticket_id: '999' }))
    await f.page.inspect()
    expect(f.page.result.value).toBeNull()
    expect(f.page.uncertain.value).toBe(true)
    expect(findId(renderDialog(f.page, f.props).body, 'remediation-outcome')).toBeUndefined()
  })

  it.each([403, 404])('上下文刷新 %s 撤销旧资产投影，保留已发原号并阻止继续请求', async status => {
    const f = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(409)))
    await readyFinish(f.page)
    await f.page.submitFinish()
    f.api.getRemediationContextApi.mockRejectedValueOnce(httpError(status))
    await f.page.startNext()
    expect(f.page.items.value).toEqual([])
    expect(f.page.canInspect.value).toBe(false)
    expect(textOf(renderDialog(f.page, f.props).body)).not.toContain('合成资产 A')
    expect(f.page.attempt.value?.input.operation_id).toBe('synthetic-op-k')
    await f.page.inspect()
    expect(f.api.getRemediationOperationApi).not.toHaveBeenCalled()
    expect(f.page.dismissLocked.value).toBe(false)
  })

  it('更换工单或身份隐藏旧上下文和回执，恢复原作用域仍保留 K', async () => {
    const f = fixture()
    await readyFinish(f.page)
    await f.page.submitFinish()
    f.props.currentActorId = '502'
    expect(f.page.items.value).toEqual([])
    expect(findId(renderDialog(f.page, f.props).body, 'remediation-outcome')).toBeUndefined()
    f.props.currentActorId = '501'
    f.props.ticketId = '999'
    expect(f.page.items.value).toEqual([])
    expect(findId(renderDialog(f.page, f.props).body, 'remediation-outcome')).toBeUndefined()
    f.props.ticketId = ticketId
    expect(f.page.result.value?.operation_id).toBe('synthetic-op-k')
    expect(findId(renderDialog(f.page, f.props).body, 'remediation-outcome')).toBeDefined()
  })

  it('已知回执随后核查拒读隐藏缓存，404 不能撤销已有回执并开放重发', async () => {
    const f = fixture()
    await readyFinish(f.page)
    await f.page.submitFinish()
    f.api.getRemediationOperationApi.mockRejectedValueOnce(httpError(403))
    await f.page.inspect()
    expect(f.page.items.value).toEqual([])
    expect(findId(renderDialog(f.page, f.props).body, 'remediation-outcome')).toBeUndefined()
    expect(flatten(renderDialog(f.page, f.props).body)
      .some(node => (node as { children?: unknown }).children === 'synthetic-op-k')).toBe(false)
    expect(f.page.attempt.value?.input.operation_id).toBe('synthetic-op-k')
    expect(f.page.canInspect.value).toBe(true)
    f.props.refreshContext = vi.fn().mockResolvedValue(undefined)
    await f.page.startNext()
    expect(f.props.refreshContext).not.toHaveBeenCalled()
    expect(f.page.attempt.value?.input.operation_id).toBe('synthetic-op-k')
    f.api.getRemediationOperationApi.mockRejectedValueOnce(httpError(404))
    await f.page.inspect()
    expect(f.page.canRetry.value).toBe(false)
    expect(f.page.result.value?.operation_id).toBe('synthetic-op-k')
    f.api.getRemediationOperationApi.mockResolvedValueOnce(outcome())
    await f.page.inspect()
    expect(findId(renderDialog(f.page, f.props).body, 'remediation-outcome')).toBeDefined()
    expect(f.api.finishRemediationApi).toHaveBeenCalledOnce()
  })

  it('核查回执异号不确认完成，维持待核查', async () => {
    const context = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(503)))
    await readyFinish(context.page)
    await context.page.submitFinish()
    context.api.getRemediationOperationApi.mockResolvedValueOnce(outcome({ operation_id: 'another-k' }))
    await context.page.inspect()
    expect(context.page.result.value).toBeNull()
    expect(context.page.uncertain.value).toBe(true)
    expect(context.api.finishRemediationApi).toHaveBeenCalledTimes(1)
  })

  it('写权撤销后续办禁用、只读核查可用；完成后显式开下一批才清原请求', async () => {
    const { api, page, props, first, pending } = await lostAttempt()
    pending.reject(new Error('响应丢失'))
    await first
    expect(page.uncertain.value).toBe(true)
    props.canFinish = false
    expect(page.canRetry.value).toBe(false)
    expect(page.canInspect.value).toBe(true)
    const { footer } = renderDialog(page, props)
    expect(findId(footer, 'remediation-resume')?.props?.disabled).toBe(true)
    expect(findId(footer, 'remediation-inspect')?.props?.disabled).toBe(false)
    api.getRemediationOperationApi.mockResolvedValueOnce(outcome())
    await page.inspect()
    expect(page.finished.value).toBe(true)
    api.getRemediationContextApi.mockResolvedValue(contextBody())
    await page.startNext()
    expect(page.attempt.value).toBeNull()
    expect(page.result.value).toBeNull()
    expect(page.savedOperation.value).toBe('synthetic-op-k')
    await settle()
    expect(api.getRemediationContextApi).toHaveBeenCalledTimes(2)
  })

  it('会话切换后的回包不污染弹窗，续办与核查一并拒绝', async () => {
    const { api, page, first, changeSession, pending } = await lostAttempt()
    changeSession()
    pending.resolve(outcome())
    await first
    expect(page.result.value).toBeNull()
    expect(page.busy.value).toBe(false)
    expect(page.sessionInvalid.value).toBe(true)
    expect(page.error.value).toContain('会话')
    await page.retry()
    await page.inspect()
    expect(api.finishRemediationApi).toHaveBeenCalledTimes(1)
    expect(api.getRemediationOperationApi).not.toHaveBeenCalled()
  })
})

describe('模板契约（可集成性）', () => {
  it('对话框动作形态：禁点遮罩关闭，在办时页脚核查与续办各绑处理器', async () => {
    const { page, props } = fixture(api => api.finishRemediationApi.mockRejectedValueOnce(httpError(503)))
    await settle()
    await readyFinish(page)
    await page.submitFinish()
    const { tree, footer } = renderDialog(page, props)
    expect(tree.props?.['close-on-click-modal']).toBe(false)
    expect(textOf(footer)).toContain('关闭并保留本次操作')
    expect(findId(footer, 'remediation-inspect')?.props?.onClick).toBe(page.inspect)
    expect(findId(footer, 'remediation-resume')?.props?.onClick).toBe(page.retry)
    expect(findId(footer, 'remediation-finish')).toBeUndefined()
    expect(findId(footer, 'remediation-review')).toBeUndefined()
  })

  it('就绪态页脚提交按钮按资格禁用，状态区承担播报角色', async () => {
    const { page, props } = fixture()
    await settle()
    const { body, footer } = renderDialog(page, props)
    expect(findId(footer, 'remediation-finish')?.props?.disabled).toBe(true)
    expect(findId(footer, 'remediation-review')?.props?.disabled).toBe(true)
    expect(flatten(body).some(node => (node as any).props?.role === 'status')).toBe(true)
  })

  it('草稿区按记录渲染：办理证据只列带版本附件，复测草稿含 A/B 决定', async () => {
    const { page, props } = fixture()
    await settle()
    page.toggleSelect(page.items.value[0]!)
    page.toggleSelect(page.items.value[1]!)
    await settle()
    const { body } = renderDialog(page, props)
    const finishDraftText = textOf(findId(body, 'remediation-drafts'))
    expect(finishDraftText).toContain('合成证据.bin（版本 9007199254740997）')
    expect(finishDraftText).not.toContain('无版本.log')
    const reviewDraftText = textOf(findId(body, 'remediation-review-drafts'))
    expect(reviewDraftText).toContain('通过（A）')
    expect(reviewDraftText).toContain('打回（B）')
  })
})

describe('复测交接（remediation-handoff）', () => {
  const handoffOutcome = (over: Partial<RemediationOutcomeDto> = {}): RemediationOutcomeDto => ({
    operation_id: 'synthetic-op-k', ticket_id: ticketId, ticket_revision: '42', successor_user_id: '502', status: 'pending_verify',
    items: [
      { link_id: '301', risk_id: '9007199254740995', link_revision: '22', risk_revision: '12', proposal_version: '0', resolution_version: '0', result: 'applied' },
      { link_id: '302', risk_id: '102', link_revision: '23', risk_revision: '13', proposal_version: '3', resolution_version: '0', result: 'applied' },
      { link_id: '303', risk_id: '103', link_revision: '24', risk_revision: '14', proposal_version: '4', resolution_version: '0', result: 'applied' },
      { link_id: '304', risk_id: '104', link_revision: '24', risk_revision: '14', proposal_version: '5', resolution_version: '9', result: 'preserved' },
    ],
    terminal_allowed: false, ...over,
  })

  async function readyHandoff(page: Page, successor = '502', reason = '合成轮换交接理由') {
    await settle()
    page.successorUserId.value = successor
    page.handoffReason.value = reason
    await settle()
    return page.canSubmitHandoff.value
  }

  it('就绪后整组未决项一次交接：七字段、resolved 不入列、提案钉 0 保留、回执按交接文案展示', async () => {
    const { api, page, props } = fixture(api => api.handoffRemediationApi.mockResolvedValueOnce(handoffOutcome()), { canHandoff: true })
    await settle()
    expect(page.handoffPendingItems.value.map(item => item.link_id)).toEqual(['301', '302', '303'])
    expect(page.canSubmitHandoff.value).toBe(false)
    expect(await readyHandoff(page)).toBe(true)
    await page.submitHandoff()
    expect(api.handoffRemediationApi).toHaveBeenCalledTimes(1)
    const input = api.handoffRemediationApi.mock.calls[0]![0]
    expect(input).toEqual({
      operation_id: 'synthetic-op-k', ticket_id: ticketId, expected_ticket_revision: '41', definition_version: '7',
      successor_user_id: '502', reason: '合成轮换交接理由',
      items: [
        { link_id: '301', expected_link_revision: '21', expected_risk_revision: '11', expected_proposal_version: '0' },
        { link_id: '302', expected_link_revision: '22', expected_risk_revision: '12', expected_proposal_version: '3' },
        { link_id: '303', expected_link_revision: '23', expected_risk_revision: '13', expected_proposal_version: '4' },
      ],
    })
    expect(Object.keys(input).sort()).toEqual(['definition_version', 'expected_ticket_revision', 'items', 'operation_id', 'reason', 'successor_user_id', 'ticket_id'])
    expect(page.uncertain.value).toBe(false)
    expect(page.savedOperation.value).toBe('synthetic-op-k')
    const { body } = renderDialog(page, props)
    const outcomeText = textOf(findId(body, 'remediation-outcome'))
    expect(outcomeText).toContain('已交接')
    expect(outcomeText).toContain('已生效资产保持不变')
    expect(textOf(body)).toContain('复测继任人：502')
  })

  it('无 handoff 权不渲染入口也不提交', async () => {
    const { api, page, props } = fixture(undefined, { canHandoff: false })
    await settle()
    expect(page.canSubmitHandoff.value).toBe(false)
    await readyHandoff(page)
    expect(page.canSubmitHandoff.value).toBe(false)
    await page.submitHandoff()
    expect(api.handoffRemediationApi).not.toHaveBeenCalled()
    expect(findId(renderDialog(page, props).body, 'remediation-handoff-form')).toBeUndefined()
    expect(findId(renderDialog(page, props).footer, 'remediation-handoff')).toBeUndefined()
  })

  it('存在不可管理未决项、继任人或理由缺失、理由超字节或含 NUL 时拒绝提交', async () => {
    const noManage = contextBody()
    noManage.items[0]!.can_manage_risk = false
    const blocked = fixture(api => api.getRemediationContextApi.mockResolvedValue(noManage), { canHandoff: true })
    await settle()
    await readyHandoff(blocked.page)
    expect(blocked.page.canSubmitHandoff.value).toBe(false)
    await blocked.page.submitHandoff()
    expect(blocked.api.handoffRemediationApi).not.toHaveBeenCalled()

    const empty = fixture(undefined, { canHandoff: true })
    await settle()
    expect(empty.page.canSubmitHandoff.value).toBe(false)
    empty.page.successorUserId.value = '502'
    expect(empty.page.canSubmitHandoff.value).toBe(false)
    empty.page.handoffReason.value = '合成理由'
    expect(empty.page.canSubmitHandoff.value).toBe(true)
    empty.page.handoffReason.value = '交'.repeat(667)
    expect(empty.page.canSubmitHandoff.value).toBe(false)
    empty.page.handoffReason.value = '理由\u0000合成'
    expect(empty.page.canSubmitHandoff.value).toBe(false)
    await empty.page.submitHandoff()
    expect(empty.api.handoffRemediationApi).not.toHaveBeenCalled()
  })

  it('明确409后按既有交互：保留原号核查入口，刷新后新号重提', async () => {
    const { api, page, props } = fixture(api => api.handoffRemediationApi.mockRejectedValueOnce(httpError(409, '交接冲突，未生效')), { canHandoff: true })
    expect(await readyHandoff(page)).toBe(true)
    await page.submitHandoff()
    const original = JSON.parse(JSON.stringify(api.handoffRemediationApi.mock.calls[0]![0]))
    expect(page.uncertain.value).toBe(false)
    expect(page.rejected.value).toBe(true)
    expect(page.canRetry.value).toBe(false)
    expect(page.canInspect.value).toBe(true)
    const refresh = findId(renderDialog(page, props).footer, 'remediation-rejected-refresh')
    expect(refresh?.props?.disabled).toBe(false)
    const fresh = contextBody()
    fresh.ticket_revision = '44'
    fresh.items[0]!.link_revision = '25'
    api.getRemediationContextApi.mockResolvedValueOnce(fresh)
    refresh.props.onClick()
    await settle()
    expect(api.handoffRemediationApi).toHaveBeenCalledTimes(1)
    expect(page.attempt.value).toBeNull()
    expect(await readyHandoff(page)).toBe(true)
    api.handoffRemediationApi.mockResolvedValueOnce(handoffOutcome({ operation_id: 'synthetic-op-k-2' }))
    await page.submitHandoff()
    expect(api.handoffRemediationApi).toHaveBeenCalledTimes(2)
    expect(api.handoffRemediationApi.mock.calls[1]![0]).toMatchObject({ operation_id: 'synthetic-op-k-2', expected_ticket_revision: '44' })
    expect(api.handoffRemediationApi.mock.calls[1]![0].items[0]).toMatchObject({ expected_link_revision: '25' })
    expect(api.handoffRemediationApi.mock.calls[0]![0]).toEqual(original)
  })

  it.each([500, 503])('handoff %s 保持待核查；GET 404 后原号原参续办', async status => {
    const { api, page } = fixture(api => api.handoffRemediationApi.mockRejectedValueOnce(httpError(status)), { canHandoff: true })
    expect(await readyHandoff(page)).toBe(true)
    await page.submitHandoff()
    const original = JSON.parse(JSON.stringify(page.attempt.value))
    expect(page.uncertain.value).toBe(true)
    expect(page.canRetry.value).toBe(false)
    api.getRemediationOperationApi.mockRejectedValueOnce(httpError(404))
    await page.inspect()
    expect(page.canRetry.value).toBe(true)
    await page.retry()
    expect(api.handoffRemediationApi).toHaveBeenCalledTimes(2)
    expect(api.handoffRemediationApi.mock.calls[1]![0]).toEqual(api.handoffRemediationApi.mock.calls[0]![0])
    expect(page.attempt.value).toEqual(original)
  })
})
