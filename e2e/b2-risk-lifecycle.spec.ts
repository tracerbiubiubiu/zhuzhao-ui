import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page, type Response } from '@playwright/test'
import { assertB2Config } from './b2-browser-env'
import { assertB2RiskResponse } from './b2-risk-assertions'
import { verifyLifecycleRestartDirectory } from './b2-risk-dispatch-restart'
import { dispatchB2LifecycleRisk } from './b2-risk-lifecycle-dispatch'
import { loadLifecycleFixture, withLifecycleActors } from './b2-risk-lifecycle-fixture'
import { runRiskLifecycleRemediation } from './b2-risk-lifecycle-remediation'
import { isOperationId, observeBusinessWrites } from './b2-risk-remediation-fixture'

const risksPath = '/api/v1/risk-items'
const receiptPath = (id: string) => `${risksPath}/operations/${id}`

type Ref = { id: string; revision: string; human_key: string }
type View = {
  risk: Ref; title: string; org_id: string; status: string; finding_key: string
  asset_ref: { provider: string; external_id: string }; owner_user_id: string | null
  level: string | null; treatment: string | null; deadline: string | null; dispatch_blockers: string[] | null
}
type Detail = { view: View; description: string }
type Receipt = { operation_id: string; command: string; status: string; risk_id: string; revision: string; replayed: boolean }
type Mutation = { risk: Ref; status: string; receipt_ref: Receipt }
type RiskEvent = { event_kind: string; operation_id: string; actor_id: string; risk_id: string; aggregate_revision: string }
type History = { total: number; items: RiskEvent[] }

function matches(response: Response, origin: string, method: string, path: string): boolean {
  const url = new URL(response.url())
  return response.request().method() === method && url.origin === origin && url.pathname === path
}

async function browserData<T>(response: Response): Promise<T> {
  return await assertB2RiskResponse(response.request(), 200, 0) as T
}

async function findRisk(page: Page, origin: string, query: string) {
  await page.getByRole('menuitem', { name: '风险列表', exact: true }).click()
  await expect(page).toHaveURL(/#\/risks$/)
  const [response] = await Promise.all([
    page.waitForResponse(candidate => matches(candidate, origin, 'GET', risksPath)
      && new URL(candidate.url()).searchParams.get('q') === query),
    page.getByPlaceholder('标题或编号').fill(query),
  ])
  return browserData<{ total: number; items: View[] }>(response)
}

function field(dialog: Locator, label: string) {
  return dialog.locator('.el-form-item').filter({ has: dialog.page().getByText(label, { exact: true }) }).getByRole('textbox')
}

async function mutateRisk(dialog: Locator, origin: string, button: string, command: 'create' | 'assess' | 'assign', input: Record<string, unknown>,
  revision: string, status: string) {
  const [response] = await Promise.all([
    dialog.page().waitForResponse(candidate => matches(candidate, origin, 'POST', `${risksPath}/${command}`)),
    dialog.getByRole('button', { name: button, exact: true }).click(),
  ])
  const body = response.request().postDataJSON() as { operation_id: string }
  expect(body).toMatchObject(input)
  expect(isOperationId(body.operation_id), `${command} 须由页面产生操作号`).toBe(true)
  const result = await browserData<Mutation>(response)
  const { risk, receipt_ref: receipt } = result
  expect(risk.id).toMatch(/^[1-9]\d*$/)
  expect(risk.human_key).toMatch(/\S/)
  expect(risk.revision).toBe(revision)
  expect(result.status).toBe(status)
  expect(receipt).toMatchObject({
    operation_id: body.operation_id, command, status, risk_id: risk.id, revision, replayed: false,
  })
  await expect(dialog).toBeHidden()
  return { risk, receipt }
}

test('B2 第9项 人工登记同一风险，派单重启后原号只读核查，办理复测并关单', async ({ browser }, testInfo) => {
  test.setTimeout(300_000)
  assertB2Config(testInfo)
  const fixture = loadLifecycleFixture()
  const restartDir = await verifyLifecycleRestartDirectory()
  const { origin, target } = fixture
  const sampleId = randomUUID()
  const sample = {
    title: `B2 第9项合成风险 ${sampleId}`,
    description: 'B2 第9项从人工登记开始的合成风险',
    org_id: target.org_id,
    finding_key: `b2-finding-${sampleId}`,
    asset_ref: { provider: 'synthetic', external_id: `b2-asset-${sampleId}` },
  }

  await withLifecycleActors(browser, fixture, async ({ M, U, P, X }) => {
    const managerWrites = observeBusinessWrites(M.page)
    const { risk: original, receipt: created } = await test.step('M 在风险列表登记新漏洞及受影响资产', async () => {
      expect(await findRisk(M.page, origin, sample.title)).toMatchObject({ total: 0, items: [] })
      await M.page.getByRole('button', { name: '登记风险', exact: true }).click()
      const dialog = M.page.getByRole('dialog', { name: '登记风险', exact: true })
      await field(dialog, '标题').fill(sample.title)
      await field(dialog, '风险管理组织 ID').fill(sample.org_id)
      await field(dialog, '说明').fill(sample.description)
      await field(dialog, '漏洞标识').fill(sample.finding_key)
      await field(dialog, '资产来源').fill(sample.asset_ref.provider)
      await field(dialog, '资产外部 ID').fill(sample.asset_ref.external_id)
      await expect(field(dialog, '责任人 ID')).toHaveValue('')
      return mutateRisk(dialog, origin, '提交登记', 'create', { ...sample, expected_revision: '0', attributes: {} }, '1', 'new')
    })
    const { id: riskId, human_key: humanKey } = original
    const riskPath = `${risksPath}/${riskId}`
    const historyPath = `${riskPath}/history`
    const fields = {
      title: sample.title, org_id: sample.org_id, finding_key: sample.finding_key, asset_ref: sample.asset_ref,
    }
    const row = M.page.getByRole('row').filter({ has: M.page.getByRole('cell', { name: humanKey, exact: true }) })
    const originalReceipt = await M.read<Receipt>(receiptPath(created.operation_id))
    expect(originalReceipt).toMatchObject({ ...created, replayed: true })

    const confirmed = await test.step('M 核实原风险并确认具名责任 U', async () => {
      expect(await M.read<Detail>(riskPath)).toMatchObject({
        view: { ...fields, risk: original, status: 'new', owner_user_id: null,
          dispatch_blockers: ['owner_unconfirmed', 'not_assessed'] },
        description: sample.description,
      })
      await expect(row.getByText('待评估', { exact: true })).toBeVisible()
      await row.getByRole('button', { name: `核实 ${humanKey}`, exact: true }).click()
      const assessDialog = M.page.getByRole('dialog', { name: '核实风险', exact: true })
      await assessDialog.getByRole('combobox', { name: /整改级别/ }).press('ArrowDown')
      await M.page.getByRole('option', { name: '高', exact: true }).click()
      const note = 'B2 第9项合成核实依据'
      await assessDialog.getByRole('textbox', { name: /核实说明/ }).fill(note)
      const assessed = await mutateRisk(assessDialog, origin, '提交核实', 'assess', {
        id: riskId, expected_revision: original.revision, level: 'high', treatment: 'mitigate', assessment_note: note,
      }, '2', 'assessed')
      expect(assessed.risk).toMatchObject({ id: riskId, human_key: humanKey })
      const { view: assessedView } = await M.read<Detail>(riskPath)
      expect(assessedView).toMatchObject({ ...fields, risk: assessed.risk, status: 'assessed', level: 'high', treatment: 'mitigate',
        owner_user_id: null, dispatch_blockers: ['owner_unconfirmed'] })
      expect(Date.parse(assessedView.deadline ?? '')).toBeGreaterThan(Date.now())

      await row.getByRole('button', { name: `指定 ${humanKey} 责任人`, exact: true }).click()
      const assignDialog = M.page.getByRole('dialog', { name: '指定责任人', exact: true })
      const reason = 'B2 第9项合成具名责任确认依据'
      await field(assignDialog, '责任人 ID').fill(U.userId)
      await field(assignDialog, '确认说明').fill(reason)
      const assigned = await mutateRisk(assignDialog, origin, '确认责任', 'assign', {
        id: riskId, expected_revision: assessed.risk.revision, owner_user_id: U.userId, reason,
      }, '3', 'assessed')
      expect(assigned.risk).toMatchObject({ id: riskId, human_key: humanKey })
      await expect(row.getByRole('cell', { name: U.userId, exact: true })).toBeVisible()
      const { view } = await M.read<Detail>(riskPath)
      expect(view).toMatchObject({ ...fields, risk: assigned.risk, status: 'assessed', level: 'high',
        owner_user_id: U.userId, deadline: assessedView.deadline })
      expect(view.dispatch_blockers ?? []).toEqual([])
      const events = [
        { event_kind: 'created', operation_id: created.operation_id, aggregate_revision: '1' },
        { event_kind: 'assessed', operation_id: assessed.receipt.operation_id, aggregate_revision: '2' },
        { event_kind: 'owner_assigned', operation_id: assigned.receipt.operation_id, aggregate_revision: '3' },
      ]
      expect(new Set(events.map(event => event.operation_id)).size).toBe(3)
      const history = await M.read<History>(historyPath)
      expect(history.total).toBe(events.length)
      expect(history.items).toHaveLength(events.length)
      expect(history.items).toEqual(expect.arrayContaining(events.map(event =>
        expect.objectContaining({ ...event, risk_id: riskId, actor_id: M.userId }))))
      return { risk: assigned.risk, operations: events.map(event => event.operation_id) }
    })
    expect(managerWrites.map(request => [request.method(), new URL(request.url()).pathname])).toEqual([
      ['POST', `${risksPath}/create`], ['POST', `${risksPath}/assess`], ['POST', `${risksPath}/assign`],
    ])

    const readerWrites = observeBusinessWrites(X.page)
    await test.step('X 读取具名风险且无写入口', async () => {
      expect(await findRisk(X.page, origin, humanKey)).toMatchObject({ total: 1, items: [{ risk: confirmed.risk, owner_user_id: U.userId }] })
      const readerRow = X.page.getByRole('row').filter({ has: X.page.getByRole('cell', { name: humanKey, exact: true }) })
      await expect(X.page.getByRole('button', { name: '登记风险', exact: true })).toHaveCount(0)
      await expect(X.page.getByRole('button', { name: '预览派单', exact: true })).toHaveCount(0)
      await expect(readerRow.getByRole('button', { name: `核实 ${humanKey}`, exact: true })).toHaveCount(0)
      await expect(readerRow.getByRole('button', { name: `指定 ${humanKey} 责任人`, exact: true })).toHaveCount(0)
      const [response] = await Promise.all([
        X.page.waitForResponse(candidate => matches(candidate, origin, 'GET', riskPath)),
        readerRow.getByRole('button', { name: `查看 ${humanKey} 详情`, exact: true }).click(),
      ])
      expect(await browserData<Detail>(response)).toMatchObject({ view: { ...fields, risk: confirmed.risk, owner_user_id: U.userId } })
      await expect(X.page.getByRole('dialog', { name: '风险详情', exact: true })
        .getByText(`${sample.asset_ref.provider} / ${sample.asset_ref.external_id}`, { exact: true })).toBeVisible()
      const denied = await X.client(`${risksPath}/dispatch-plan`, {
        method: 'POST',
        body: { items: [{ risk_id: riskId, expected_revision: confirmed.risk.revision }],
          target_org_id: target.org_id, target_type_code: target.type_code },
      })
      expect(denied.status).toBe(403)
      expect((await M.read<Detail>(riskPath)).view.risk).toEqual(confirmed.risk)
    })

    const dispatch = await test.step('M 派原风险，Core 重启后原页面只读核查派单原号', () => dispatchB2LifecycleRisk({
      page: M.page, origin, actorId: M.userId, ownerId: U.userId, riskId, target, restartDir, read: M.read,
    }))
    expect(dispatch.riskRefs).toEqual([{ id: riskId, ref: humanKey }])
    const final = await runRiskLifecycleRemediation({ dispatcher: M, handler: P, owner: U, ticketId: dispatch.ticket.id,
      riskId, definitionVersion: target.definition_version })
    await test.step('回读原风险、原票关单与只读访问的最终事实', async () => {
      expect(final).toMatchObject({ ticketId: dispatch.ticket.id, riskId, linkId: dispatch.linkId, status: 'closed' })
      expect(new Set([...confirmed.operations, dispatch.operationId, final.assignOperationId, final.claimOperationId,
        final.finishOperationId, final.reviewOperationId]).size).toBe(8)
      const detail = await M.read<Detail>(riskPath)
      expect(detail).toMatchObject({ view: { ...fields, risk: { id: riskId, human_key: humanKey, revision: final.revision },
        status: 'closed', owner_user_id: U.userId },
        description: sample.description })
      expect(await X.read<Detail>(riskPath)).toMatchObject({ view: { ...fields, risk: detail.view.risk, status: 'closed' } })
      expect(await M.read<Receipt>(receiptPath(created.operation_id))).toEqual(originalReceipt)
      expect(await M.read(dispatch.operationPath)).toEqual(dispatch.result)
      expect(await M.read(`/api/v1/tickets/${dispatch.ticket.id}`)).toMatchObject({ human_key: dispatch.ticket.ref })
      expect(readerWrites).toHaveLength(0)
    })
  })
})
