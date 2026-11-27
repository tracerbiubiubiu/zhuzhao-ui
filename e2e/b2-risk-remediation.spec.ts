/**
 * B2 第 8 项：逐资产整改/复测跨角色浏览器验证（独立候选，2026-11-23）。
 *
 * 覆盖范围（全部打本轮独占候选的真实 UI + Core，不用 stub、不接共享开发栈）：
 * 1) P（当前办理人）在工单详情提交初次证据 → 工单进入待复测；
 * 2) U（现势风险责任人）逐项复测：A 通过、B 打回，正常项不被连带改写；
 * 3) P 只重提被打回的那一项，已通过资产零再写（版本、详情、历史深比较）；
 * 4) U 通过重提证据收尾，逐资产落 resolved，并做只读收尾核对；
 * 5) 无关成员 X 全程只读、服务端拒绝写且不留回执、不改变现势；
 * 6) 丢响应场景（需另一张工单）：默认关闭重开同票后只按原操作号 GET 核查，绝不换号/盲重发；
 * 7) 已有数据复测上下文：只处理待复测项，已生效资产不再写；
 * 8) 键盘路径：Tab 到达资产与证据复选框，Space 选择并键入措施；复测单选聚焦后 Space 选择，Enter 提交。
 *
 * 入口为 `pnpm test:e2e:b2`。独占服务和三个独立工单的准备方式见 docs/guides/testing.md。
 *
 * 证据要求（每次运行应保留）：
 *   - 附件 b2-remediation-<场景>.json：逐阶段操作号、逐资产状态/版本、票状态、回执与现势一致性、
 *     被拒绝探针、每页写请求计数（不含凭据）；
 *   - 若失败于“待复测上下文/权限前置”，需连同主会话夹具说明（工单状态、处理人、责任人、允许动作）一并交回。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { assertB2Config } from './b2-browser-env'
import {
  assertOutcome,
  assetFacts,
  browserMutation,
  chooseDecisionByKeyboard,
  clickInspect,
  closeRemediationDialog,
  denialFinishBody,
  denialReviewBody,
  ensureEvidenceSource,
  expectAssetToggleable,
  expectCommitted,
  expectDeniedWrite,
  expectDialogOperation,
  expectOutcomeRows,
  expectResultMap,
  fillFinishDraft,
  fillReviewDraft,
  finishFirstAssetByKeyboard,
  isOperationId,
  itemRow,
  loadRemediationFixture,
  observeBusinessWrites,
  observeRemediationWrites,
  openRemediationDialog,
  openWorkflowPage,
  readContext,
  readOutcome,
  readWorkflow,
  remediationPaths,
  reloadWorkflowPage,
  reviewDraft,
  selectAssetByClick,
  withRemediationSessions,
  workflowFacts,
  type Envelope,
  type RemediationContext,
  type RemediationItemResult,
  type RemediationState,
  type Workflow,
} from './b2-risk-remediation-fixture'

test.use({ actionTimeout: 10_000, navigationTimeout: 20_000 })

const FINISH_KEYS = ['comment', 'definition_version', 'expected_ticket_revision', 'items', 'operation_id', 'ticket_id']
const REVIEW_KEYS = ['custom_data_patch', 'definition_version', 'expected_ticket_revision', 'items', 'operation_id', 'ticket_id']

async function confirmPublishedFields(page: Page, kind: 'finish' | 'review') {
  const field = kind === 'finish' ? page.getByLabel('办理说明', { exact: true })
    : page.getByLabel('Synthetic review mark', { exact: true })
  await field.fill(kind === 'finish' ? 'Synthetic browser evidence submission' : 'Synthetic browser retest')
  const action = page.getByRole('dialog').filter({ has: field })
  await action.getByRole('button', { name: /^确认/ }).click()
}

async function submitWithPublishedFields(button: Locator, kind: 'finish' | 'review') {
  await button.click()
  await confirmPublishedFields(button.page(), kind)
}
const REVIEW_ITEM_KEYS = [
  'decision', 'evidence', 'expected_link_revision', 'expected_proposal_version',
  'expected_risk_revision', 'link_id', 'note',
]

test.beforeEach(({}, testInfo) => {
  assertB2Config(testInfo)
})

function statesOf(workflow: Workflow): Record<string, RemediationState> {
  return Object.fromEntries(workflow.context.items.map(item => [item.link_id, item.remediation_state]))
}

function submittedItems(body: Record<string, unknown>): Array<Record<string, unknown>> {
  assert.ok(Array.isArray(body.items), '提交体必须携带逐资产项')
  return body.items as Array<Record<string, unknown>>
}

function expectedResults(items: Array<{ link_id: string }>, result: RemediationItemResult): Record<string, RemediationItemResult> {
  return Object.fromEntries(items.map(item => [item.link_id, result]))
}

function bodyKeys(body: Record<string, unknown>): string[] {
  return Object.keys(body).sort()
}

async function expectAssetsLocked(dialog: Locator, context: RemediationContext): Promise<void> {
  for (const item of context.items) await expectAssetToggleable(itemRow(dialog, item.link_id), false)
  await expect(dialog.getByTestId('remediation-finish')).toBeDisabled()
  await expect(dialog.getByTestId('remediation-review')).toBeDisabled()
}

async function attachPhases(testInfo: TestInfo, name: string, facts: object): Promise<void> {
  const path = testInfo.outputPath(name)
  await writeFile(path, JSON.stringify(facts, null, 2), { mode: 0o600 })
  await testInfo.attach(name, { path, contentType: 'application/json' })
}

test('B2 第8项 P 提交初次证据、U 通过A打回B、P 只重提B、U 正常收尾', async ({ browser }, testInfo) => {
  test.setTimeout(300_000)
  const fixture = loadRemediationFixture()
  const ticketId = fixture.ticketId
  const phases: Array<Record<string, unknown>> = []
  try {
    await withRemediationSessions(browser, fixture, async ({ P, U, X }) => {
      const base = await test.step('前置读回：工单状态/处理人/责任人/带版本附件', async () => {
        const browserContext = await openWorkflowPage(P, ticketId)
        const workflow = await readWorkflow(P.client, ticketId)
        assert.equal(workflow.context.status, 'in_progress', '主链路工单须在 in_progress 才可办理')
        assert.equal(browserContext.status, workflow.context.status, '浏览器上下文与独立读回状态一致')
        assert.equal(workflow.ticket.status, 'in_progress', '工单详情状态须为 in_progress')
        assert.equal(workflow.ticket.assigned_to, P.userId, 'P 必须是本单当前处理人（canFinish 前置）')
        assert.ok(workflow.context.items.length >= 2, '本轮需要一张至少两个关联资产的工单')
        assert.deepEqual(workflow.context.items.map(item => item.remediation_state),
          workflow.context.items.map(() => 'open'), '初次办理前逐资产状态须为待办理')
        assert.ok(workflow.context.allowed_actions?.includes('finish') ?? false, 'P 的上下文须允许办理动作')
        const ownerContext = await readContext(U.client, ticketId)
        assert.equal(ownerContext.ticket_revision, workflow.context.ticket_revision, '复测人读到同一票修订')
        assert.ok(ownerContext.items.every(item => item.is_risk_owner === true), 'U 须是全部资产现势责任人')
        const readerContext = await readContext(X.client, ticketId)
        assert.ok(readerContext.items.every(item => item.is_risk_owner !== true), 'X 不得是本单风险责任人')
        assert.notEqual(U.userId, P.userId, '办理人与复测人必须是不同用户')
        assert.notEqual(X.userId, P.userId, '无关成员不能是办理人')
        assert.notEqual(X.userId, U.userId, '无关成员不能是复测责任人')
        const source = await ensureEvidenceSource(P, ticketId)
        const baseline = source.uploaded ? await readWorkflow(P.client, ticketId) : workflow
        const attached = baseline.attachments.find(row => row.object_key === source.ref)
        assert.equal(attached?.evidence_version, source.version, '整改证据引用的附件须带同版本证据号')
        return { workflow: baseline, source }
      })
      phases.push({
        phase: 'baseline',
        ticket: { status: base.workflow.ticket.status, revision: base.workflow.context.ticket_revision },
        items: base.workflow.context.items.map(item => ({
          link: item.link_id, risk: item.risk_id, state: item.remediation_state, riskRevision: item.risk_revision,
          linkRevision: item.link_revision, proposal: item.proposal_version,
        })),
        evidence: { fileName: base.source.fileName, version: base.source.version, uploaded: base.source.uploaded },
        roles: { P: P.userId, U: U.userId, X: X.userId },
      })

      const xWrites = observeBusinessWrites(X.page)
      const xRemediationWrites = observeRemediationWrites(X.page)
      await test.step('无关成员只读 + 服务端拒绝其提交，现势零变化', async () => {
        await openWorkflowPage(X, ticketId)
        const xDialog = await openRemediationDialog(X.page, base.workflow.context.items.length)
        await expect(xDialog.getByText('当前无办理或复测写权限，仅可查看。')).toBeVisible()
        await expect(xDialog.getByTestId('remediation-finish')).toBeDisabled()
        await expect(xDialog.getByTestId('remediation-review')).toBeDisabled()
        for (const item of base.workflow.context.items) {
          await expectAssetToggleable(itemRow(xDialog, item.link_id), false)
        }
        await closeRemediationDialog(xDialog)
        await expectDeniedWrite({
          label: '无关成员提交整改证据',
          path: remediationPaths.finish,
          body: denialFinishBody(base.workflow.context, randomUUID(), base.source),
          actor: X,
          reader: P,
          before: base.workflow,
          ticketId,
        })
        expect(xRemediationWrites, '无关成员页面不得发出整改写').toHaveLength(0)
        expect(xWrites, '无关成员页面不得发出任何风险/工单业务写').toHaveLength(0)
        phases.push({ phase: 'x-denied-finish', writes: xWrites.length })
      })

      const submitted = await test.step('P 以键盘+鼠标提交初次证据', async () => {
        const dialog = await openRemediationDialog(P.page, base.workflow.context.items.length)
        const writes = observeRemediationWrites(P.page)
        const [first, ...rest] = base.workflow.context.items
        const measures = new Map<string, string>()
        measures.set(first.link_id, `B2 第8项初次整改 ${randomUUID().slice(0, 8)} 资产一`)
        await finishFirstAssetByKeyboard({
          page: P.page, dialog, linkId: first.link_id, measures: measures.get(first.link_id) as string,
          fileName: base.source.fileName,
        })
        for (const item of rest) {
          measures.set(item.link_id, `B2 第8项初次整改 ${randomUUID().slice(0, 8)} 资产 ${item.link_id}`)
          await selectAssetByClick(itemRow(dialog, item.link_id))
          await fillFinishDraft(dialog, item.link_id, measures.get(item.link_id) as string, base.source.fileName)
        }
        await expect(dialog.getByTestId('remediation-finish')).toBeEnabled()
        const [response] = await Promise.all([
          P.page.waitForResponse(candidate => candidate.request().method() === 'POST'
            && new URL(candidate.url()).pathname === remediationPaths.finish, { timeout: 30_000 }),
          submitWithPublishedFields(dialog.getByTestId('remediation-finish'), 'finish'),
        ])
        const mutation = await browserMutation(response, ticketId, '提交整改办理')
        assert.deepEqual(bodyKeys(mutation.body), FINISH_KEYS, '办理提交体字段集合')
        assert.equal(mutation.body.ticket_id, ticketId)
        assert.equal(mutation.body.expected_ticket_revision, base.workflow.context.ticket_revision, '票修订 CAS')
        assert.equal(mutation.body.definition_version, base.workflow.context.definition_version, '定义版本钉')
        const inputs = submittedItems(mutation.body)
        assert.equal(inputs.length, base.workflow.context.items.length, '初次办理须覆盖全部资产')
        for (const item of base.workflow.context.items) {
          const input = inputs.find(entry => entry.link_id === item.link_id)
          assert.ok(input, `提交体缺少资产 ${item.link_id}`)
          assert.deepEqual(input, {
            link_id: item.link_id,
            expected_link_revision: item.link_revision,
            expected_risk_revision: item.risk_revision,
            resolution: 'fixed',
            measures: measures.get(item.link_id),
            evidence: [{ kind: 'file', ref: base.source.ref, version: base.source.version }],
          }, `资产 ${item.link_id} 初次办理输入`)
        }
        expectResultMap(mutation.outcome, expectedResults(base.workflow.context.items, 'pending_confirmation'))
        await expectDialogOperation(dialog, mutation.outcome.operation_id)
        await expectOutcomeRows(dialog, Object.fromEntries(
          base.workflow.context.items.map(item => [item.link_id, '已提交待复测']),
        ))
        await expect(dialog.getByTestId('remediation-finish')).toHaveCount(0)
        await expect(dialog.getByTestId('remediation-inspect')).toBeVisible()
        await expectAssetToggleable(itemRow(dialog, first.link_id), false)
        assert.deepEqual(writes.map(request => new URL(request.url()).pathname), [remediationPaths.finish],
          '初次办理只允许一次写请求')

        const after = await readWorkflow(P.client, ticketId)
        assert.equal(after.context.status, 'pending_verify', '提交证据后工单进入待复测')
        assert.equal(after.ticket.status, after.context.status, '工单详情状态与逐资产办理上下文一致')
        expectCommitted({
          label: '初次办理', actor: P.userId, operationId: mutation.outcome.operation_id,
          before: base.workflow, after, outcome: mutation.outcome,
          expectedStates: Object.fromEntries(base.workflow.context.items.map(item => [item.link_id, 'pending_verify'])),
        })
        assert.deepEqual(await readOutcome(P.client, ticketId, mutation.outcome.operation_id), mutation.outcome,
          '原操作号回执与提交响应一致')
        assert.deepEqual(after.attachments, base.workflow.attachments, '办理提交不改动附件集合')
        await closeRemediationDialog(dialog)
        phases.push({
          phase: 'p-finish', operation: mutation.outcome.operation_id, outcome: mutation.outcome,
          ticket: { status: after.ticket.status, revision: after.context.ticket_revision },
        })
        return { mutation, after, writes }
      })

      await test.step('U 在消息中心查看原工单的待复核通知', async () => {
        const [inbox] = await Promise.all([
          U.page.waitForResponse(response => response.request().method() === 'GET'
            && new URL(response.url()).pathname === '/api/v1/notifications/inbox'),
          U.page.goto('/#/messages'),
        ])
        expect(inbox.status()).toBe(200)
        type ReviewRow = { id: string; biz_id?: string; title: string; delivery_id?: string; read_at?: string }
        const { data } = await inbox.json() as Envelope<{ list: ReviewRow[] }>
        const notices = data.list.filter(row => row.biz_id === ticketId && row.title === '工单待复核')
        expect(notices).toHaveLength(1)
        const notice = notices[0]!
        expect(notice.read_at).toBeFalsy()
        const row = U.page.getByTestId(`msg-${notice.id}`)
        await expect(row.getByRole('button', { name: '工单待复核' })).toBeVisible()
        const expectedState = process.env.B2_REVIEW_DELIVERY_EXPECTED_STATE
        if (expectedState !== undefined) {
          const labels = new Map([
            ['accepted', '已受理'], ['delivered', '已送达'], ['failed', '发送失败'],
            ['unknown', '结果未知'], ['suppressed', '已抑制'],
          ])
          const label = labels.get(expectedState)
          assert.ok(label, 'B2_REVIEW_DELIVERY_EXPECTED_STATE 须为本轮 mock 固定的可观察状态')
          assert.ok(notice.delivery_id, '验外送状态时，通知必须包含原投递编号')
          const original = notice.delivery_id
          const readOriginal = async (trigger: () => Promise<void>) => {
            const [response] = await Promise.all([
              U.page.waitForResponse(candidate => {
                const url = new URL(candidate.url())
                return url.pathname === '/api/v1/notifications/delivery' && candidate.request().method() === 'GET'
                  && url.searchParams.get('delivery_id') === original
              }),
              trigger(),
            ])
            expect(response.status()).toBe(200)
            const { data } = await response.json() as Envelope<{ delivery_id: string; state: string }>
            expect(data.delivery_id).toBe(original)
            return data.state
          }
          const inspect = row.getByRole('button', { name: '查询投递状态' })
          const first = await readOriginal(() => inspect.press('Enter'))
          const drawer = U.page.getByRole('dialog', { name: '消息投递状态' })
          if (first !== expectedState) {
            await expect.poll(() => readOriginal(() => drawer.getByRole('button', { name: '查询原记录' }).click()), {
              intervals: [500, 1000, 1500],
              timeout: 20_000,
            }).toBe(expectedState)
          }
          await expect(drawer.getByText(label, { exact: true })).toBeVisible()
          await expect(drawer.getByText(original, { exact: true })).toBeVisible()
          await U.page.keyboard.press('Escape')
          await expect(drawer).toBeHidden()
          await expect(row.locator('.msg-dot--unread')).toBeVisible()
        }
        phases.push({ phase: 'u-review-notice', notificationId: notice.id, deliveryId: notice.delivery_id, expectedState })
      })

      await test.step('待复测态：无关成员复测写被拒绝且无回执', async () => {
        const readerContext = await readContext(X.client, ticketId)
        assert.ok(readerContext.items.every(item => item.remediation_state === 'pending_verify'))
        await expectDeniedWrite({
          label: '无关成员提交复测决定',
          path: remediationPaths.review,
          body: denialReviewBody(readerContext, randomUUID()),
          actor: X,
          reader: P,
          before: submitted.after,
          ticketId,
        })
        phases.push({ phase: 'x-denied-review' })
      })

      const reviewed = await test.step('U 逐项复测：A 通过、B 打回（键盘选决定 + Enter 提交）', async () => {
        await openWorkflowPage(U, ticketId)
        const dialog = await openRemediationDialog(U.page, base.workflow.context.items.length)
        const writes = observeRemediationWrites(U.page)
        // 未选资产时两个提交入口都应关闭；复测人不是本单处理人，办理入口始终不可用。
        await expect(dialog.getByTestId('remediation-review')).toBeDisabled()
        await expect(dialog.getByTestId('remediation-finish')).toBeDisabled()
        const [approvePrimary, rejectItem, ...approveRest] = submitted.after.context.items
        assert.ok(approvePrimary && rejectItem, '复测至少需要两个资产才能覆盖通过与打回')
        const decisions = new Map<string, { decision: 'approve' | 'reject'; note: string }>()
        for (const item of submitted.after.context.items) {
          await selectAssetByClick(itemRow(dialog, item.link_id))
        }
        decisions.set(approvePrimary.link_id, { decision: 'approve', note: `B2 复测通过 ${approvePrimary.link_id}` })
        decisions.set(rejectItem.link_id, { decision: 'reject', note: `B2 复测打回 ${rejectItem.link_id}，请补证` })
        for (const item of approveRest) {
          decisions.set(item.link_id, { decision: 'approve', note: `B2 复测通过 ${item.link_id}` })
        }
        await fillReviewDraft(dialog, approvePrimary.link_id, 'approve',
          (decisions.get(approvePrimary.link_id) as { note: string }).note)
        await chooseDecisionByKeyboard(dialog, rejectItem.link_id, 'reject')
        await reviewDraft(dialog, rejectItem.link_id).locator(`textarea[name="note-${rejectItem.link_id}"]`)
          .fill((decisions.get(rejectItem.link_id) as { note: string }).note)
        for (const item of approveRest) {
          await fillReviewDraft(dialog, item.link_id, 'approve', (decisions.get(item.link_id) as { note: string }).note)
        }
        await expect(dialog.getByTestId('remediation-review')).toBeEnabled()
        const [response] = await Promise.all([
          U.page.waitForResponse(candidate => candidate.request().method() === 'POST'
            && new URL(candidate.url()).pathname === remediationPaths.review, { timeout: 30_000 }),
          (async () => {
            await dialog.getByTestId('remediation-review').focus()
            await U.page.keyboard.press('Enter')
            await confirmPublishedFields(U.page, 'review')
          })(),
        ])
        const mutation = await browserMutation(response, ticketId, '提交复测决定')
        assert.deepEqual(bodyKeys(mutation.body), REVIEW_KEYS, '复测提交体字段集合')
        assert.equal(mutation.body.expected_ticket_revision, submitted.after.context.ticket_revision, '复测票修订 CAS')
        const inputs = submittedItems(mutation.body)
        assert.equal(inputs.length, submitted.after.context.items.length)
        for (const item of submitted.after.context.items) {
          const input = inputs.find(entry => entry.link_id === item.link_id)
          assert.ok(input, `复测提交体缺少资产 ${item.link_id}`)
          const decision = decisions.get(item.link_id)
          assert.ok(decision)
          assert.deepEqual(input, {
            link_id: item.link_id,
            expected_link_revision: item.link_revision,
            expected_risk_revision: item.risk_revision,
            expected_proposal_version: item.proposal_version,
            decision: decision.decision,
            note: decision.note,
            evidence: [],
          }, `资产 ${item.link_id} 复测输入`)
          assert.deepEqual(Object.keys(input).sort(), REVIEW_ITEM_KEYS, '复测项字段集合')
        }
        expectResultMap(mutation.outcome, Object.fromEntries(
          submitted.after.context.items.map(item => [item.link_id,
            item.link_id === rejectItem.link_id ? 'rejected' : 'applied']),
        ))
        await expectOutcomeRows(dialog, Object.fromEntries(submitted.after.context.items.map(item => [
          item.link_id, item.link_id === rejectItem.link_id ? '已打回' : '已生效',
        ])))
        assert.deepEqual(writes.map(request => new URL(request.url()).pathname), [remediationPaths.review],
          '复测只允许一次写请求')

        const after = await readWorkflow(P.client, ticketId)
        assert.equal(after.context.status, 'in_progress', '打回后工单须回到 in_progress 才允许重提')
        assert.equal(after.ticket.status, after.context.status, '工单详情状态与逐资产办理上下文一致')
        expectCommitted({
          label: '复测决定', actor: U.userId, operationId: mutation.outcome.operation_id,
          before: submitted.after, after, outcome: mutation.outcome,
          expectedStates: Object.fromEntries(submitted.after.context.items.map(item => [item.link_id,
            item.link_id === rejectItem.link_id ? 'rejected' : 'resolved'])),
        })
        assert.deepEqual(await readOutcome(U.client, ticketId, mutation.outcome.operation_id), mutation.outcome,
          '复测人按原操作号读回同一回执')
        await closeRemediationDialog(dialog)
        phases.push({
          phase: 'u-review', operation: mutation.outcome.operation_id, outcome: mutation.outcome,
          ticket: { status: after.ticket.status, revision: after.context.ticket_revision },
          approved: [approvePrimary.link_id, ...approveRest.map(item => item.link_id)], rejected: rejectItem.link_id,
        })
        return { mutation, after, writes, approvePrimary, rejectItem, approveRest, decisions }
      })

      const resubmitted = await test.step('P 只重提被打回的 B，已通过资产零再写', async () => {
        await reloadWorkflowPage(P, ticketId)
        const current = await readContext(P.client, ticketId)
        assert.equal(current.status, 'in_progress')
        const dialog = await openRemediationDialog(P.page, current.items.length)
        const writes = observeRemediationWrites(P.page)
        const approvedIds = [reviewed.approvePrimary.link_id, ...reviewed.approveRest.map(item => item.link_id)]
        for (const linkId of approvedIds) {
          await expectAssetToggleable(itemRow(dialog, linkId), false)
        }
        await expectAssetToggleable(itemRow(dialog, reviewed.rejectItem.link_id), true)
        await selectAssetByClick(itemRow(dialog, reviewed.rejectItem.link_id))
        const measures = `B2 第8项重提证据 ${randomUUID().slice(0, 8)}`
        await fillFinishDraft(dialog, reviewed.rejectItem.link_id, measures, base.source.fileName)
        const targetItem = current.items.find(item => item.link_id === reviewed.rejectItem.link_id)
        assert.ok(targetItem)
        await expect(dialog.getByTestId('remediation-finish')).toBeEnabled()
        const [response] = await Promise.all([
          P.page.waitForResponse(candidate => candidate.request().method() === 'POST'
            && new URL(candidate.url()).pathname === remediationPaths.finish, { timeout: 30_000 }),
          submitWithPublishedFields(dialog.getByTestId('remediation-finish'), 'finish'),
        ])
        const mutation = await browserMutation(response, ticketId, '重提整改证据')
        assert.equal(mutation.body.expected_ticket_revision, current.ticket_revision)
        const inputs = submittedItems(mutation.body)
        assert.equal(inputs.length, 1, '重提只允许提交被打回的那一项')
        assert.deepEqual(inputs[0], {
          link_id: targetItem.link_id,
          expected_link_revision: targetItem.link_revision,
          expected_risk_revision: targetItem.risk_revision,
          resolution: 'fixed',
          measures,
          evidence: [{ kind: 'file', ref: base.source.ref, version: base.source.version }],
        })
        expectResultMap(mutation.outcome, { [targetItem.link_id]: 'pending_confirmation' })
        await expectOutcomeRows(dialog, { [targetItem.link_id]: '已提交待复测' })
        assert.deepEqual(await readOutcome(P.client, ticketId, mutation.outcome.operation_id), mutation.outcome,
          '重提的原操作号回执与响应一致')

        const after = await readWorkflow(P.client, ticketId)
        assert.equal(after.context.status, 'pending_verify')
        expectCommitted({
          label: '重提证据', actor: P.userId, operationId: mutation.outcome.operation_id,
          before: reviewed.after, after, outcome: mutation.outcome,
          expectedStates: Object.fromEntries(after.context.items.map(item => [item.link_id,
            item.link_id === targetItem.link_id ? 'pending_verify' : 'resolved'])),
        })
        for (const item of reviewed.after.context.items) {
          if (item.link_id === targetItem.link_id) continue
          assert.deepEqual(assetFacts(after, item.link_id), assetFacts(reviewed.after, item.link_id),
            `已生效资产 ${item.link_id} 不得被重提连带改写（上下文/风险详情/历史）`)
        }
        assert.deepEqual(after.attachments, base.workflow.attachments, '重提不改动附件集合')
        await closeRemediationDialog(dialog)
        phases.push({
          phase: 'p-resubmit', operation: mutation.outcome.operation_id, outcome: mutation.outcome,
          untouched: reviewed.after.context.items.filter(item => item.link_id !== targetItem.link_id)
            .map(item => item.link_id),
        })
        const nextTarget = after.context.items.find(item => item.link_id === targetItem.link_id)
        assert.ok(nextTarget, '重提后仍需读到原关联')
        assert.ok(BigInt(nextTarget.proposal_version) > BigInt(targetItem.proposal_version), '重提必须推进提案修订')
        return { mutation, after, writes, targetItem: nextTarget }
      })

      const closed = await test.step('U 通过重提证据收尾，全部资产生效', async () => {
        await reloadWorkflowPage(U, ticketId)
        const dialog = await openRemediationDialog(U.page, resubmitted.after.context.items.length)
        const writes = observeRemediationWrites(U.page)
        for (const item of resubmitted.after.context.items) {
          if (item.link_id !== resubmitted.targetItem.link_id) {
            await expectAssetToggleable(itemRow(dialog, item.link_id), false)
          }
        }
        await selectAssetByClick(itemRow(dialog, resubmitted.targetItem.link_id))
        const note = `B2 复测通过重提证据 ${resubmitted.targetItem.link_id}`
        await fillReviewDraft(dialog, resubmitted.targetItem.link_id, 'approve', note)
        await expect(dialog.getByTestId('remediation-review')).toBeEnabled()
        const [response] = await Promise.all([
          U.page.waitForResponse(candidate => candidate.request().method() === 'POST'
            && new URL(candidate.url()).pathname === remediationPaths.review, { timeout: 30_000 }),
          submitWithPublishedFields(dialog.getByTestId('remediation-review'), 'review'),
        ])
        const mutation = await browserMutation(response, ticketId, '复测重提证据')
        const inputs = submittedItems(mutation.body)
        assert.equal(inputs.length, 1)
        assert.deepEqual(inputs[0], {
          link_id: resubmitted.targetItem.link_id,
          expected_link_revision: resubmitted.targetItem.link_revision,
          expected_risk_revision: resubmitted.targetItem.risk_revision,
          expected_proposal_version: resubmitted.targetItem.proposal_version,
          decision: 'approve',
          note,
          evidence: [],
        })
        expectResultMap(mutation.outcome, { [resubmitted.targetItem.link_id]: 'applied' })
        assert.deepEqual(await readOutcome(U.client, ticketId, mutation.outcome.operation_id), mutation.outcome,
          '收尾复测的原操作号回执与响应一致')
        assert.equal(mutation.outcome.terminal_allowed, true, '全部资产生效后应可正常收尾')
        await expectOutcomeRows(dialog, { [resubmitted.targetItem.link_id]: '已生效' })

        const after = await readWorkflow(P.client, ticketId)
        expectCommitted({
          label: '复测收尾', actor: U.userId, operationId: mutation.outcome.operation_id,
          before: resubmitted.after, after, outcome: mutation.outcome,
          expectedStates: Object.fromEntries(after.context.items.map(item => [item.link_id, 'resolved'])),
        })
        assert.equal(after.ticket.status, 'closed', '全部复测生效后原工单必须关单')
        assert.equal(after.context.status, 'closed', '逐资产上下文对应同一已关闭工单')
        assert.ok(after.context.items.every(item => item.remediation_state === 'resolved'),
          '收尾后全部资产应为已生效')
        assert.deepEqual(after.attachments, base.workflow.attachments)
        await closeRemediationDialog(dialog)
        phases.push({
          phase: 'u-closeout', operation: mutation.outcome.operation_id, outcome: mutation.outcome,
          ticket: { status: after.ticket.status, revision: after.context.ticket_revision },
        })
        return { mutation, after, writes }
      })

      await test.step('收尾只读核对：三方均无可写入口，写请求计数保持不变', async () => {
        const writesBefore = {
          P: submitted.writes.length,
          U: reviewed.writes.length,
        }
        assert.equal(writesBefore.P, 2, 'P 页面全程应恰有两次整改写（初次提交与仅重提 B）')
        assert.equal(writesBefore.U, 2, 'U 页面全程应恰有两次复测写（通过A打回B 与 通过重提）')
        await reloadWorkflowPage(P, ticketId)
        const pDialog = await openRemediationDialog(P.page, closed.after.context.items.length)
        await expectAssetsLocked(pDialog, closed.after.context)
        await closeRemediationDialog(pDialog)
        await reloadWorkflowPage(U, ticketId)
        const uDialog = await openRemediationDialog(U.page, closed.after.context.items.length)
        await expectAssetsLocked(uDialog, closed.after.context)
        await closeRemediationDialog(uDialog)
        await reloadWorkflowPage(X, ticketId)
        const xDialog = await openRemediationDialog(X.page, closed.after.context.items.length)
        await expect(xDialog.getByText('当前无办理或复测写权限，仅可查看。')).toBeVisible()
        await expectAssetsLocked(xDialog, closed.after.context)
        await closeRemediationDialog(xDialog)
        assert.equal(submitted.writes.length, writesBefore.P, '只读核对期间 P 不得再写')
        assert.equal(reviewed.writes.length, writesBefore.U, '只读核对期间 U 不得再写')
        expect(xRemediationWrites, '无关成员全程不得发出整改写').toHaveLength(0)
        expect(xWrites, '无关成员全程不得发出任何风险/工单业务写').toHaveLength(0)
        const finalRead = await readWorkflow(P.client, ticketId)
        assert.deepEqual(workflowFacts(finalRead), workflowFacts(closed.after), '只读核对不得改变现势状态')
        phases.push({
          phase: 'readonly-closeout',
          writes: { P: writesBefore.P, U: writesBefore.U, X: xWrites.length },
          ticket: { status: finalRead.ticket.status, revision: finalRead.context.ticket_revision },
        })
      })
    })
  } finally {
    await attachPhases(testInfo, 'b2-remediation-main.json', { ticket: ticketId, phases })
  }
})

test('B2 第8项 办理提交丢响应只按原 K 只读核查，绝不盲重发', async ({ browser }, testInfo) => {
  test.setTimeout(300_000)
  const fixture = loadRemediationFixture()
  const ticketId = fixture.dropTicketId
  const phases: Array<Record<string, unknown>> = []
  try {
    await withRemediationSessions(browser, fixture, async ({ P, U }) => {
      const base = await test.step('前置读回并准备带版本附件', async () => {
        await openWorkflowPage(P, ticketId)
        const workflow = await readWorkflow(P.client, ticketId)
        assert.equal(workflow.context.status, 'in_progress', '丢响应场景工单须在 in_progress')
        assert.equal(workflow.ticket.status, 'in_progress', '工单详情状态须为 in_progress')
        assert.equal(workflow.ticket.assigned_to, P.userId, 'P 必须是该单当前处理人')
        assert.ok(workflow.context.items.length >= 1)
        assert.ok(workflow.context.items.every(item => item.remediation_state === 'open'), '该单资产须为待办理')
        assert.ok(workflow.context.allowed_actions?.includes('finish'), 'P 的上下文须允许办理动作')
        const ownerContext = await readContext(U.client, ticketId)
        assert.equal(ownerContext.ticket_revision, workflow.context.ticket_revision, '复测人读到同一票修订')
        assert.ok(ownerContext.items.every(item => item.is_risk_owner === true), 'U 须是该单全部资产责任人')
        const source = await ensureEvidenceSource(P, ticketId)
        return { workflow: source.uploaded ? await readWorkflow(P.client, ticketId) : workflow, source }
      })

      const dropped = await test.step('提交被中断：上游成功、浏览器丢响应、仅一次写入', async () => {
        let dialog = await openRemediationDialog(P.page, base.workflow.context.items.length)
        const writes = observeRemediationWrites(P.page)
        const measures = new Map<string, string>()
        for (const item of base.workflow.context.items) {
          measures.set(item.link_id, `B2 丢响应对照 ${randomUUID().slice(0, 8)} 资产 ${item.link_id}`)
          await selectAssetByClick(itemRow(dialog, item.link_id))
          await fillFinishDraft(dialog, item.link_id, measures.get(item.link_id) as string, base.source.fileName)
        }
        await expect(dialog.getByTestId('remediation-finish')).toBeEnabled()
        const finishUrl = `${fixture.origin}${remediationPaths.finish}`
        let upstream: { status: number; envelope: Envelope<unknown> } | undefined
        let forwardError: unknown
        await P.page.route(finishUrl, async route => {
          if (route.request().method() !== 'POST') return route.fallback()
          try {
            const response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 15_000 })
            upstream = { status: response.status(), envelope: await response.json() as Envelope<unknown> }
          } catch (error) {
            forwardError = error
          } finally {
            await route.abort('connectionreset')
          }
        }, { times: 1 })
        const [failed] = await Promise.all([
          P.page.waitForEvent('requestfailed', {
            predicate: request => request.method() === 'POST' && request.url() === finishUrl,
            timeout: 30_000,
          }),
          submitWithPublishedFields(dialog.getByTestId('remediation-finish'), 'finish'),
        ])
        assert.equal(await failed.response(), null, '浏览器侧必须确实丢失响应')
        assert.equal(forwardError, undefined, '真实转发不得失败')
        assert.ok(upstream, '上游必须真实返回')
        assert.equal(upstream.status, 200)
        assert.equal(upstream.envelope.code, 0)
        const body = failed.postDataJSON() as Record<string, unknown>
        const operationId = body.operation_id
        assert.equal(body.ticket_id, ticketId, '丢响应的原始写入必须绑定这张工单')
        assert.ok(isOperationId(operationId), '首次请求缺少 canonical 原操作号')
        const outcome = assertOutcome(upstream.envelope.data, operationId)
        assert.equal(outcome.ticket_id, ticketId)
        assert.equal(writes.length, 1, '丢响应后不得自动重发')
        assert.equal(writes[0], failed, '唯一写入即被中断的原请求')
        await expect(dialog.getByText(/^结果待核查/)).toBeVisible()
        await expectDialogOperation(dialog, operationId)
        await expect(dialog.getByRole('status')).toContainText(`工单 ${ticketId} 状态`)
        await expect(dialog.getByTestId('remediation-inspect')).toBeEnabled()
        await expect(dialog.getByTestId('remediation-resume'), '尚未显式 GET 404，不得重发原请求').toBeDisabled()
        const committed = await readWorkflow(P.client, ticketId)
        assert.equal(committed.context.status, 'pending_verify', '上游确实已提交，现势进入待复测')
        expectCommitted({
          label: '丢响应办理', actor: P.userId, operationId: operationId,
          before: base.workflow, after: committed, outcome,
          expectedStates: Object.fromEntries(base.workflow.context.items.map(item => [item.link_id, 'pending_verify'])),
        })
        assert.deepEqual(await readOutcome(P.client, ticketId, operationId), outcome, '原号回执与上游结果一致')
        assert.deepEqual(writes.map(request => new URL(request.url()).pathname), [remediationPaths.finish])

        await closeRemediationDialog(dialog)
        assert.equal(new URL(P.page.url()).hash, `#/tickets/${ticketId}`, '关闭窗口仍停留在原工单')
        dialog = await openRemediationDialog(P.page, base.workflow.context.items.length)
        await expectDialogOperation(dialog, operationId)
        await expect(dialog.getByRole('status')).toContainText(`工单 ${ticketId} 状态`)
        await expect(dialog.getByText(/^结果待核查/)).toBeVisible()
        await expect(dialog.getByTestId('remediation-inspect')).toBeEnabled()
        await expect(dialog.getByTestId('remediation-finish')).toHaveCount(0)
        await expect(dialog.getByTestId('remediation-review')).toHaveCount(0)
        assert.equal(writes.length, 1, '关闭重开只能恢复原尝试，不得自动发起新请求或重发')
        const inspected = await clickInspect(P.page, dialog, ticketId, operationId)
        assert.equal(inspected.reads.length, 1, '只读核查必须只读一次原号')
        assert.equal(inspected.outcome.operation_id, operationId, '恢复后的回执必须保留首次写入的原 K')
        assert.equal(inspected.outcome.ticket_id, ticketId, '恢复后的回执必须属于首次写入的原工单')
        assert.deepEqual(inspected.outcome, outcome, '按原号核查结果与上游一致')
        assert.equal(inspected.context.status, 'pending_verify', '只读核查后父页自动刷新到待复测现势')
        assert.equal(inspected.ticket.id, ticketId, '只读核查刷新的是原工单')
        await expect(P.page.locator('.el-card__header').filter({ hasText: `#${ticketId} ` }).getByText('待验证', { exact: true }))
          .toBeVisible()
        assert.equal(writes.length, 1, '只读核查后仍不得重发原请求')
        await expect(dialog.getByTestId('remediation-resume'), '核查确认后不再提供重发入口').toHaveCount(0)
        await expectOutcomeRows(dialog, Object.fromEntries(base.workflow.context.items.map(item => [
          item.link_id, '已提交待复测',
        ])))
        await closeRemediationDialog(dialog)
        phases.push({
          phase: 'dropped-finish', operation: operationId, upstreamStatus: upstream.status,
          ticket: inspected.outcome.ticket_id, closeReopen: true,
          writes: writes.length, inspected: inspected.reads.length, refreshedStatus: inspected.context.status,
        })
        return { outcome, writes, committed }
      })

      await test.step('U 从现势读回继续复测并收尾，办理页不再新增写入', async () => {
        await openWorkflowPage(U, ticketId)
        const context = await readContext(U.client, ticketId)
        assert.equal(context.status, 'pending_verify')
        const dialog = await openRemediationDialog(U.page, context.items.length)
        const writes = observeRemediationWrites(U.page)
        for (const item of context.items) {
          await selectAssetByClick(itemRow(dialog, item.link_id))
          await fillReviewDraft(dialog, item.link_id, 'approve', `B2 丢响应后复测 ${item.link_id}`)
        }
        await expect(dialog.getByTestId('remediation-review')).toBeEnabled()
        const [response] = await Promise.all([
          U.page.waitForResponse(candidate => candidate.request().method() === 'POST'
            && new URL(candidate.url()).pathname === remediationPaths.review, { timeout: 30_000 }),
          submitWithPublishedFields(dialog.getByTestId('remediation-review'), 'review'),
        ])
        const mutation = await browserMutation(response, ticketId, '丢响应后复测')
        expectResultMap(mutation.outcome, expectedResults(context.items, 'applied'))
        const after = await readWorkflow(P.client, ticketId)
        expectCommitted({
          label: '丢响应后复测', actor: U.userId, operationId: mutation.outcome.operation_id,
          before: dropped.committed, after, outcome: mutation.outcome,
          expectedStates: Object.fromEntries(context.items.map(item => [item.link_id, 'resolved'])),
        })
        assert.ok(after.context.items.every(item => item.remediation_state === 'resolved'))
        const ownerReadback = await readContext(U.client, ticketId)
        assert.equal(after.context.status, 'closed', 'P 读回办理上下文须已关闭')
        assert.equal(ownerReadback.status, 'closed', 'U 读回复测上下文须已关闭')
        assert.equal(after.ticket.status, 'closed', '全部复测通过后原工单须关闭')
        assert.equal(mutation.outcome.terminal_allowed, true, '全部资产生效后应可收尾')
        assert.equal(writes.length, 1, '复测只允许一次写请求')
        assert.equal(dropped.writes.length, 1, '办理页全程仍只有一次原请求')
        await closeRemediationDialog(dialog)
        phases.push({
          phase: 'u-review-after-drop', operation: mutation.outcome.operation_id,
          ticket: after.ticket.id, readbackStatus: { P: after.context.status, U: ownerReadback.status },
        })
      })
    })
  } finally {
    await attachPhases(testInfo, 'b2-remediation-drop.json', { ticket: ticketId, phases })
  }
})

test('B2 第8项 已有数据按复测上下文续测，已生效资产不再写', async ({ browser }, testInfo) => {
  const fixture = loadRemediationFixture()
  const ticketId = fixture.verifyTicketId
  test.setTimeout(240_000)
  const phases: Array<Record<string, unknown>> = []
  try {
    await withRemediationSessions(browser, fixture, async ({ U }) => {
      const baseline = await readWorkflow(U.client, ticketId)
      const pending = baseline.context.items.filter(item => item.remediation_state === 'pending_verify')
      const states = statesOf(baseline)
      phases.push({ phase: 'baseline', states, status: baseline.ticket.status })
      assert.ok(pending.length > 0 && baseline.context.items.some(item => item.remediation_state === 'resolved'),
        '续测夹具须同时包含待复测和已生效资产')
      for (const item of pending) {
        assert.equal(item.is_risk_owner, true, `U 须是待复测资产 ${item.link_id} 的现势责任人`)
      }
      await openWorkflowPage(U, ticketId)
      const dialog = await openRemediationDialog(U.page, baseline.context.items.length)
      const writes = observeRemediationWrites(U.page)
      for (const item of baseline.context.items) {
        if (item.remediation_state !== 'pending_verify') {
          await expectAssetToggleable(itemRow(dialog, item.link_id), false)
        }
      }
      for (const item of pending) {
        await selectAssetByClick(itemRow(dialog, item.link_id))
        await fillReviewDraft(dialog, item.link_id, 'approve', `B2 复测上下文续测 ${item.link_id}`)
      }
      await expect(dialog.getByTestId('remediation-review')).toBeEnabled()
      const [response] = await Promise.all([
        U.page.waitForResponse(candidate => candidate.request().method() === 'POST'
          && new URL(candidate.url()).pathname === remediationPaths.review, { timeout: 30_000 }),
        submitWithPublishedFields(dialog.getByTestId('remediation-review'), 'review'),
      ])
      const mutation = await browserMutation(response, ticketId, '复测上下文续测')
      assert.equal(submittedItems(mutation.body).length, pending.length, '只提交待复测项')
      expectResultMap(mutation.outcome, expectedResults(pending, 'applied'))
      const after = await readWorkflow(U.client, ticketId)
      expectCommitted({
        label: '复测上下文续测', actor: U.userId, operationId: mutation.outcome.operation_id,
        before: baseline, after, outcome: mutation.outcome,
        expectedStates: Object.fromEntries(baseline.context.items.map(item => [item.link_id,
          item.remediation_state === 'pending_verify' ? 'resolved' : item.remediation_state])),
      })
      for (const item of baseline.context.items) {
        if (item.remediation_state !== 'pending_verify') {
          const expected = assetFacts(baseline, item.link_id)
          const linkRevision = after.ticket.status === 'closed'
            ? (BigInt(expected.item.link_revision) + 1n).toString()
            : expected.item.link_revision
          assert.deepEqual(assetFacts(after, item.link_id), {
            ...expected,
            item: { ...expected.item, link_revision: linkRevision },
          }, `非待复测资产 ${item.link_id} 仅允许随整单关闭推进关联修订`)
        }
      }
      assert.deepEqual(writes.map(request => new URL(request.url()).pathname), [remediationPaths.review])
      await closeRemediationDialog(dialog)
      phases.push({
        phase: 'review-resume', operation: mutation.outcome.operation_id,
        reviewed: pending.map(item => item.link_id), states: statesOf(after),
      })
    })
  } finally {
    await attachPhases(testInfo, 'b2-remediation-resume.json', { ticket: ticketId, phases })
  }
})
