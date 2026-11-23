import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page, type Request } from '@playwright/test'
import { assertB2RiskResponse } from './b2-risk-assertions'
import {
  assetFacts, assertContext, browserMutation, closeRemediationDialog, expectAssetToggleable,
  expectCommitted, expectDialogOperation, expectOutcomeRows, expectResultMap, fillFinishDraft,
  fillReviewDraft, itemRow, observeBusinessWrites, openRemediationDialog, readAttachments,
  readOutcome, readWorkflow, remediationPaths, selectAssetByClick, workflowFacts,
  type CoreClient, type EvidenceRef, type RemediationContext, type Workflow,
} from './b2-risk-remediation-fixture'

const assignPath = '/api/v1/risk-items/remediation-assign-handler'
const claimPath = '/api/v1/risk-items/remediation-accept-assignment'
const presignPath = '/api/v1/storage/presign/upload'
const attachPath = '/api/v1/tickets/attachments/confirm'
const reviewField = 'synthetic_review_mark'
const reviewLabel = 'Synthetic review mark'
const publishedActions = {
  in_progress: { collect_fields: [], comment_required: false },
  pending_verify: { collect_fields: [], comment_required: true },
  closed: { collect_fields: [{ key: reviewField, required: true }], comment_required: false },
}

type LifecycleActor = { page: Page; client: CoreClient; userId: string; employeeNo: string; storage?: string }

type LifecycleRemediation = {
  dispatcher: LifecycleActor
  handler: LifecycleActor
  owner: LifecycleActor
  ticketId: string
  riskId: string
  definitionVersion: string
}

function browserRequest(page: Page, method: string, path: string) {
  const origin = new URL(page.url()).origin
  return (request: Request) => {
    const url = new URL(request.url())
    return request.method() === method && url.origin === origin && url.pathname === path
  }
}

async function openTicket(page: Page, ticketId: string, to?: keyof typeof publishedActions): Promise<RemediationContext> {
  const contextRequest = browserRequest(page, 'GET', remediationPaths.context(ticketId))
  const actionsRequest = browserRequest(page, 'GET', `${remediationPaths.ticket(ticketId)}/actions`)
  const [contextResponse, actionsResponse] = await Promise.all([
    page.waitForResponse(response => contextRequest(response.request())),
    to ? page.waitForResponse(response => actionsRequest(response.request())) : undefined,
    new URL(page.url()).hash === `#/tickets/${ticketId}`
      ? page.reload({ waitUntil: 'domcontentloaded' })
      : page.goto(`/#/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' }),
  ])
  const context = assertContext(await assertB2RiskResponse(contextResponse.request(), 200, 0), ticketId)
  if (to && actionsResponse) {
    const body = await assertB2RiskResponse(actionsResponse.request(), 200, 0) as { actions?: unknown[]; available_actions?: unknown[] }
    expect(body.actions ?? body.available_actions, '须提供本轮已发布的办理动作').toContainEqual(expect.objectContaining({
      to, expected_revision: context.ticket_revision,
      definition_ref: expect.objectContaining({ definition_version: context.definition_version }),
      ...publishedActions[to],
    }))
  }
  await expect(page.getByTestId('open-risk-remediation')).toBeVisible()
  return context
}

function sameRisk(workflow: Workflow, options: LifecycleRemediation) {
  expect(workflow.ticket.id).toBe(options.ticketId)
  expect(workflow.context.definition_version).toBe(options.definitionVersion)
  expect(workflow.context.items.map(item => item.risk_id)).toEqual([options.riskId])
  const work = assetFacts(workflow, workflow.context.items[0]!.link_id)
  expect(work.risk.risk).toMatchObject({ id: options.riskId, revision: work.item.risk_revision })
  expect(work.risk.owner_user_id).toBe(options.owner.userId)
  return work
}

async function openCommands(page: Page) {
  await page.getByTestId('open-risk-workflow-commands').click()
  const dialog = page.getByRole('dialog', { name: '整改分派与风险接受', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function chooseHandler(dialog: Locator, ticketId: string, handler: LifecycleActor) {
  const page = dialog.page()
  const peopleRequest = browserRequest(page, 'GET', '/api/v1/tickets/people')
  const search = dialog.getByTestId('remediation-command-picker').locator('input')
  const [response] = await Promise.all([
    page.waitForResponse(response => {
      const query = new URL(response.url()).searchParams
      return peopleRequest(response.request()) && query.get('q') === handler.employeeNo
        && query.get('purpose') === 'assign' && query.get('ticket_id') === ticketId
    }),
    search.fill(handler.employeeNo),
  ])
  const { list } = await assertB2RiskResponse(response.request(), 200, 0) as { list: { id: string; label: string }[] }
  const matches = list.filter(row => row.id === handler.userId)
  expect(matches).toHaveLength(1)
  await page.getByRole('option', { name: matches[0]!.label, exact: true }).click()
}

async function readTicketCommand(options: {
  actor: LifecycleActor; dialog: Locator; button: string; path: string; before: RemediationContext; input?: object
}) {
  const { actor, dialog, button, path, before, input } = options
  const request = browserRequest(actor.page, 'POST', path)
  const [response] = await Promise.all([
    actor.page.waitForResponse(response => request(response.request())),
    dialog.getByTestId(button).click(),
  ])
  const { body, outcome } = await browserMutation(response, before.ticket_id, path)
  expect(body).toEqual({
    operation_id: outcome.operation_id, ticket_id: before.ticket_id,
    expected_ticket_revision: before.ticket_revision, definition_version: before.definition_version, ...input,
  })
  expect(outcome.items).toEqual([])
  expect(BigInt(outcome.ticket_revision)).toBeGreaterThan(BigInt(before.ticket_revision))
  await expect(dialog.getByRole('status')).toContainText(outcome.operation_id)
  await expect(dialog.getByRole('status')).toContainText('已取得本次操作回执')
  expect(await readOutcome(actor.client, before.ticket_id, outcome.operation_id)).toEqual(outcome)
  await dialog.getByRole('button', { name: '关闭并保留操作', exact: true }).click()
  await expect(dialog).toBeHidden()
  return outcome
}

async function uploadSyntheticEvidence(handler: LifecycleActor, ticketId: string): Promise<{ fileName: string; evidence: EvidenceRef }> {
  const { page, storage } = handler
  assert.ok(storage, '第9项需要独占对象存储 B2_RISK_STORAGE_ORIGIN')
  expect(await readAttachments(handler.client, ticketId), '新派发工单不得预置附件').toEqual([])
  const fileName = `b2-lifecycle-${randomUUID().slice(0, 12)}.txt`
  const mimeType = 'text/plain'
  const buffer = Buffer.from(`B2 第9项合成整改证据 ${fileName}\n`, 'utf8')
  const presignRequest = browserRequest(page, 'POST', presignPath)
  const confirmRequest = browserRequest(page, 'POST', attachPath)
  const card = page.locator('.ticket-attachments')
  const [presign, put, confirm] = await Promise.all([
    page.waitForResponse(response => presignRequest(response.request())),
    page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).origin === storage),
    page.waitForResponse(response => confirmRequest(response.request())),
    card.locator('input[type=file]').setInputFiles({ name: fileName, mimeType, buffer }),
  ])
  expect(presign.request().postDataJSON()).toEqual({
    purpose: 'ticket_attachment', ticket_id: ticketId, file_name: fileName, mime_type: mimeType,
    size_bytes: String(buffer.byteLength),
  })
  const pre = await assertB2RiskResponse(presign.request(), 200, 0) as { object_key: string; upload_url: string }
  expect(pre.object_key).toMatch(/\S/)
  expect(put.url() === pre.upload_url, '浏览器应直传到本次签发的地址').toBe(true)
  expect(put.ok(), '独占对象存储必须成功写入合成附件').toBe(true)
  expect(put.fromServiceWorker()).toBe(false)
  expect(await put.serverAddr(), '直传响应必须有独占对象存储地址').toMatchObject({ port: Number(new URL(storage).port) })
  expect(confirm.request().postDataJSON()).toEqual({ ticket_id: ticketId, object_key: pre.object_key })
  expect(await assertB2RiskResponse(confirm.request(), 200, 0)).toMatchObject({ status: 'confirmed', object_key: pre.object_key })
  await expect(card.getByRole('link', { name: fileName, exact: true })).toBeVisible()
  const attachments = await readAttachments(handler.client, ticketId)
  expect(attachments).toEqual([expect.objectContaining({
    file_name: fileName, object_key: pre.object_key, evidence_version: expect.stringMatching(/\S/),
  })])
  const downloadPath = '/api/v1/files/' + pre.object_key.split('/').map(encodeURIComponent).join('/')
  const download = await page.request.get(downloadPath, { maxRedirects: 0 })
  try {
    expect(download.status()).toBe(200)
    expect(await download.body()).toEqual(buffer)
  } finally {
    await download.dispose()
  }
  return { fileName, evidence: { kind: 'file', ref: pre.object_key, version: attachments[0]!.evidence_version! } }
}

async function submitWithPublishedField(dialog: Locator, kind: 'finish' | 'review', value: string) {
  const page = dialog.page()
  const label = kind === 'finish' ? '办理说明' : reviewLabel
  const field = page.getByLabel(label, { exact: true })
  const request = browserRequest(page, 'POST', remediationPaths[kind])
  const [response] = await Promise.all([
    page.waitForResponse(response => request(response.request())),
    (async () => {
      await dialog.getByTestId(`remediation-${kind}`).click()
      await field.fill(value)
      await page.getByRole('dialog').filter({ has: field }).getByRole('button', { name: /^确认/ }).click()
    })(),
  ])
  return response
}

export async function runRiskLifecycleRemediation(options: LifecycleRemediation) {
  const { dispatcher, handler, owner, ticketId, riskId, definitionVersion } = options
  expect(new Set([dispatcher.userId, handler.userId, owner.userId]).size).toBe(3)
  const dispatcherWrites = observeBusinessWrites(dispatcher.page)
  const handlerWrites = observeBusinessWrites(handler.page)
  const ownerWrites = observeBusinessWrites(owner.page)
  const read = () => readWorkflow(dispatcher.client, ticketId)

  const assigned = await test.step('管理者在原工单分派具名办理人', async () => {
    const browserContext = await openTicket(dispatcher.page, ticketId)
    const before = await read()
    const asset = sameRisk(before, options)
    expect(before.ticket).toMatchObject({ status: 'assigned', assigned_to: owner.userId })
    expect(asset.item).toMatchObject({ remediation_state: 'open', can_manage_risk: true })
    expect(browserContext).toEqual(before.context)
    expect(browserContext.allowed_actions).toContain('assign_handler')
    const dialog = await openCommands(dispatcher.page)
    await chooseHandler(dialog, ticketId, handler)
    const outcome = await readTicketCommand({
      actor: dispatcher, dialog, button: 'remediation-command-assign', path: assignPath, before: browserContext,
      input: { assigned_to_user_id: handler.userId },
    })
    const after = await read()
    expect(sameRisk(after, options).item.link_id).toBe(asset.item.link_id)
    expect(after.ticket).toMatchObject({ status: 'assigned', assigned_to: handler.userId })
    expect(after.context).toMatchObject({ status: 'assigned', ticket_revision: outcome.ticket_revision })
    expect(after.attachments).toEqual([])
    return { after, operationId: outcome.operation_id }
  })

  const claimed = await test.step('办理人本人接单，读取同票同风险', async () => {
    const browserContext = await openTicket(handler.page, ticketId, 'in_progress')
    expect(browserContext.ticket_revision).toBe(assigned.after.context.ticket_revision)
    expect(browserContext.allowed_actions).toContain('accept_assignment')
    const dialog = await openCommands(handler.page)
    const outcome = await readTicketCommand({
      actor: handler, dialog, button: 'remediation-command-claim', path: claimPath, before: browserContext,
    })
    const after = await read()
    expect(sameRisk(after, options).item.link_id).toBe(sameRisk(assigned.after, options).item.link_id)
    expect(after.ticket).toMatchObject({ status: 'in_progress', assigned_to: handler.userId })
    expect(after.context).toMatchObject({ status: 'in_progress', ticket_revision: outcome.ticket_revision })
    return { after, operationId: outcome.operation_id }
  })

  const finished = await test.step('真实上传附件并按同一风险的版本提交整改', async () => {
    const browserContext = await openTicket(handler.page, ticketId, 'pending_verify')
    expect(browserContext.ticket_revision).toBe(claimed.after.context.ticket_revision)
    expect(browserContext.allowed_actions).toContain('finish')
    const source = await uploadSyntheticEvidence(handler, ticketId)
    const before = await read()
    const { item } = sameRisk(before, options)
    expect(item.link_id).toBe(sameRisk(claimed.after, options).item.link_id)
    const dialog = await openRemediationDialog(handler.page, 1)
    await selectAssetByClick(itemRow(dialog, item.link_id))
    const measures = '已按合成场景完成整改'
    const comment = '附件记录本次整改结果'
    await fillFinishDraft(dialog, item.link_id, measures, source.fileName)
    const response = await submitWithPublishedField(dialog, 'finish', comment)
    const { body, outcome } = await browserMutation(response, ticketId, '登记风险的整改办理')
    expect(body).toEqual({
      operation_id: outcome.operation_id, ticket_id: ticketId, expected_ticket_revision: before.context.ticket_revision,
      definition_version: definitionVersion, comment,
      items: [{
        link_id: item.link_id, expected_link_revision: item.link_revision, expected_risk_revision: item.risk_revision,
        resolution: 'fixed', measures, evidence: [source.evidence],
      }],
    })
    expectResultMap(outcome, { [item.link_id]: 'pending_confirmation' })
    expect(outcome.items[0]?.risk_id).toBe(riskId)
    await expectDialogOperation(dialog, outcome.operation_id)
    await expectOutcomeRows(dialog, { [item.link_id]: '已提交待复测' })
    const after = await read()
    expect(sameRisk(after, options).item.link_id).toBe(item.link_id)
    expect(after.ticket).toMatchObject({ status: 'pending_verify', assigned_to: handler.userId })
    expect(after.context.status).toBe('pending_verify')
    expectCommitted({ label: '办理', actor: handler.userId, operationId: outcome.operation_id,
      before, after, outcome, expectedStates: { [item.link_id]: 'pending_verify' } })
    expect(after.attachments).toEqual(before.attachments)
    expect(await readOutcome(handler.client, ticketId, outcome.operation_id)).toEqual(outcome)
    await closeRemediationDialog(dialog)
    return { after, operationId: outcome.operation_id }
  })

  const reviewed = await test.step('现势责任人逐项复测原风险并关闭同一工单', async () => {
    const browserContext = await openTicket(owner.page, ticketId, 'closed')
    expect(browserContext.ticket_revision).toBe(finished.after.context.ticket_revision)
    expect(browserContext.allowed_actions).toContain('review')
    const { item } = sameRisk(finished.after, options)
    expect(browserContext.items[0]).toMatchObject({
      link_id: item.link_id, risk_id: riskId, remediation_state: 'pending_verify', is_risk_owner: true,
    })
    const dialog = await openRemediationDialog(owner.page, 1)
    await selectAssetByClick(itemRow(dialog, item.link_id))
    const note = '已按附件逐项复测，整改通过'
    const reviewMark = 'synthetic pass'
    await fillReviewDraft(dialog, item.link_id, 'approve', note)
    const response = await submitWithPublishedField(dialog, 'review', reviewMark)
    const { body, outcome } = await browserMutation(response, ticketId, '登记风险的逐项复测关单')
    expect(body).toEqual({
      operation_id: outcome.operation_id, ticket_id: ticketId, expected_ticket_revision: finished.after.context.ticket_revision,
      definition_version: definitionVersion, custom_data_patch: { [reviewField]: reviewMark },
      items: [{
        link_id: item.link_id, expected_link_revision: item.link_revision, expected_risk_revision: item.risk_revision,
        expected_proposal_version: item.proposal_version, decision: 'approve', note, evidence: [],
      }],
    })
    expectResultMap(outcome, { [item.link_id]: 'applied' })
    expect(outcome.items[0]?.risk_id).toBe(riskId)
    expect(outcome.terminal_allowed).toBe(true)
    await expectOutcomeRows(dialog, { [item.link_id]: '已生效' })
    const after = await read()
    const asset = sameRisk(after, options)
    expect(asset.item.link_id).toBe(item.link_id)
    expect(asset.risk.status).toBe('closed')
    expect(after.ticket).toMatchObject({ status: 'closed', assigned_to: handler.userId })
    expect(after.context.status).toBe('closed')
    expectCommitted({ label: '复测关单', actor: owner.userId, operationId: outcome.operation_id,
      before: finished.after, after, outcome, expectedStates: { [item.link_id]: 'resolved' } })
    expect(after.attachments).toEqual(finished.after.attachments)
    expect(await readOutcome(owner.client, ticketId, outcome.operation_id)).toEqual(outcome)
    await closeRemediationDialog(dialog)
    return { after, asset, operationId: outcome.operation_id }
  })

  await test.step('关闭后只读浏览同一工单和风险，不新增写入', async () => {
    const context = await openTicket(owner.page, ticketId)
    expect(context.status).toBe('closed')
    const dialog = await openRemediationDialog(owner.page, 1)
    await expectAssetToggleable(itemRow(dialog, reviewed.asset.item.link_id), false)
    await expect(dialog.getByTestId('remediation-finish')).toBeDisabled()
    await expect(dialog.getByTestId('remediation-review')).toBeDisabled()
    await closeRemediationDialog(dialog)
    expect(workflowFacts(await read())).toEqual(workflowFacts(reviewed.after))
    const paths = (requests: Request[]) => requests.map(request => new URL(request.url()).pathname)
    expect(paths(dispatcherWrites)).toEqual([assignPath])
    expect(paths(handlerWrites)).toEqual([claimPath, attachPath, remediationPaths.finish])
    expect(paths(ownerWrites)).toEqual([remediationPaths.review])
    expect(new Set([assigned.operationId, claimed.operationId, finished.operationId, reviewed.operationId]).size).toBe(4)
  })

  return {
    ticketId: reviewed.after.ticket.id, riskId: reviewed.asset.risk.risk.id, linkId: reviewed.asset.item.link_id,
    revision: reviewed.asset.item.risk_revision, status: reviewed.asset.risk.status,
    assignOperationId: assigned.operationId, claimOperationId: claimed.operationId,
    finishOperationId: finished.operationId, reviewOperationId: reviewed.operationId,
  }
}
