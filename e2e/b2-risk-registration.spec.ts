import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page, type Request, type Response } from '@playwright/test'
import { assertB2Config, loadB2Endpoints, loginB2Browser, restrictB2Browser } from './b2-browser-env'
import { mustData, type Envelope } from './helpers'
import { assertB2RiskResponse } from './b2-risk-assertions'
import { withB2RiskRolePages } from './b2-risk-fixtures'
import { provisionRiskRegistration } from './b2-risk-registration-fixture'

test.use({ actionTimeout: 10_000, navigationTimeout: 15_000, serviceWorkers: 'block', trace: 'off', screenshot: 'off' })

const risksPath = '/api/v1/risk-items'
const createPath = `${risksPath}/create`
const assessPath = `${risksPath}/assess`
const assignPath = `${risksPath}/assign`
const operationsPath = `${risksPath}/operations/`
const operationPath = (id: string) => `${operationsPath}${encodeURIComponent(id)}`

type Auth = { token: string }
type RiskRef = { id: string; human_key: string; revision: string }
type RiskView = {
  risk: RiskRef
  title: string
  status: string
  org_id: string
  owner_user_id: string | null
  level: string | null
  treatment: string | null
  dispatch_blockers: string[]
}
type RiskDetail = { view: RiskView; description: string }
type RiskReceipt = {
  operation_id: string
  command: string
  status: string
  risk_id: string
  revision: string
  created_at: string
  replayed: boolean
}
type Mutation = { risk: RiskRef; status: string; receipt_ref: RiskReceipt }
type RiskEvent = { event_kind: string; operation_id: string; actor_id: string; risk_id: string; aggregate_revision: string }
type RiskSample = { title: string; description: string; org_id: string }

let fixture: Awaited<ReturnType<typeof provisionRiskRegistration>>
test.beforeAll(async ({}, testInfo) => {
  assertB2Config(testInfo)
  const { ui, core } = loadB2Endpoints()
  fixture = await provisionRiskRegistration(ui, core)
})

function targets(request: Request, method: string, path: string): boolean {
  const url = new URL(request.url())
  return request.method() === method && url.origin === fixture.ui && url.pathname === path
}

async function browserData<T>(response: Response): Promise<T> {
  return await assertB2RiskResponse(response.request(), 200, 0) as T
}

async function browserActorId(page: Page): Promise<string> {
  const [response] = await Promise.all([
    page.waitForResponse(response => targets(response.request(), 'GET', '/api/v1/user/profile')),
    page.reload(),
  ])
  return (await browserData<{ id: string }>(response)).id
}

function field(dialog: Locator, label: string): Locator {
  return dialog.locator('.el-form-item').filter({ has: dialog.page().getByText(label, { exact: true }) })
}

function riskRow(page: Page, title: string): Locator {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name: title, exact: true }) })
}

function sampleFor(kind: string): RiskSample {
  return { title: `B2 风险 ${kind} ${fixture.tag}`, description: `B2 合成风险说明 ${fixture.tag}`, org_id: fixture.orgId }
}

async function findRisks(page: Page, title: string) {
  await page.getByRole('menuitem', { name: '风险列表', exact: true }).click()
  await expect(page).toHaveURL(/#\/risks$/)
  const search = page.getByPlaceholder('标题或编号')
  await expect(search).toBeVisible()
  const [response] = await Promise.all([
    page.waitForResponse(response => targets(response.request(), 'GET', risksPath) && new URL(response.url()).searchParams.get('q') === title),
    search.fill(title),
  ])
  return browserData<{ items: RiskView[]; total: number }>(response)
}

async function openRegistration(page: Page, sample: RiskSample) {
  await page.getByRole('button', { name: '登记风险', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '登记风险', exact: true })
  await field(dialog, '标题').getByRole('textbox').fill(sample.title)
  await field(dialog, '风险管理组织 ID').getByRole('textbox').fill(sample.org_id)
  await expect(field(dialog, '责任人 ID').getByRole('textbox')).toHaveValue('')
  await field(dialog, '说明').getByRole('textbox').fill(sample.description)
  return { dialog, submit: dialog.getByRole('button', { name: '提交登记', exact: true }) }
}

async function openDetail(page: Page, row: Locator, ref: RiskRef, sample: RiskSample) {
  const [response] = await Promise.all([
    page.waitForResponse(response => targets(response.request(), 'GET', `${risksPath}/${ref.id}`)),
    row.getByRole('button', { name: `查看 ${ref.human_key} 详情`, exact: true }).click(),
  ])
  const detail = await browserData<RiskDetail>(response)
  expect(detail).toMatchObject({ view: { risk: ref, title: sample.title, org_id: sample.org_id }, description: sample.description })
  const drawer = page.getByRole('dialog', { name: '风险详情', exact: true })
  await expect(drawer.getByText(sample.description, { exact: true })).toBeVisible()
  return drawer
}

function readDetail(auth: Auth, ref: RiskRef) {
  return mustData(fixture.call<RiskDetail>(`${risksPath}/${ref.id}`, auth), '独立回读风险详情')
}

function readReceipt(auth: Auth, operationId: string) {
  return mustData(fixture.call<RiskReceipt>(operationPath(operationId), auth), '按原号读取风险回执')
}

function readHistory(auth: Auth, ref: RiskRef) {
  return mustData(fixture.call<{ items: RiskEvent[]; total: number }>(`${risksPath}/${ref.id}/history`, auth), '独立回读风险历史')
}

function readList(auth: Auth, sample: RiskSample) {
  return mustData(fixture.call<{ items: RiskView[]; total: number }>(`${risksPath}?q=${encodeURIComponent(sample.title)}`, auth), '独立回读合成风险列表')
}

function expectCreated(detail: RiskDetail, ref: RiskRef, sample: RiskSample) {
  expect(detail).toMatchObject({
    view: {
      risk: ref, title: sample.title, org_id: sample.org_id, status: 'new', owner_user_id: null,
      dispatch_blockers: ['owner_unconfirmed', 'not_assessed'],
    },
    description: sample.description,
  })
}

function expectHistory(history: Awaited<ReturnType<typeof readHistory>>, ref: RiskRef, operations: Array<[string, string, string]>) {
  expect(history.total).toBe(operations.length)
  expect(history.items).toHaveLength(operations.length)
  expect(history.items).toEqual(expect.arrayContaining(operations.map(([event, operationId, revision]) =>
    expect.objectContaining({
      event_kind: event, operation_id: operationId, actor_id: fixture.accounts.M.userId,
      risk_id: ref.id, aggregate_revision: revision,
    }),
  )))
}

function expectReceipt(result: Mutation, command: string, operationId: string, revision: string, status: string) {
  expect(operationId).toEqual(expect.any(String))
  expect(operationId.trim()).not.toBe('')
  expect(result.risk.id).toMatch(/^[1-9]\d*$/)
  expect(result.risk.human_key).not.toBe('')
  expect(result.risk.revision).toBe(revision)
  expect(result.status).toBe(status)
  const facts = { operation_id: operationId, command, risk_id: result.risk.id, revision, status }
  expect(result.receipt_ref).toMatchObject({ ...facts, replayed: false })
  return facts
}

async function submitMutation(page: Page, button: Locator, path: string, input: Record<string, unknown>) {
  const [response] = await Promise.all([
    page.waitForResponse(response => targets(response.request(), 'POST', path)),
    button.click(),
  ])
  const body = response.request().postDataJSON() as { operation_id: string }
  expect(body).toMatchObject(input)
  return { result: await browserData<Mutation>(response), operationId: body.operation_id }
}

function observeRiskWrites(page: Page) {
  const writes: Request[] = []
  page.on('request', request => {
    const { pathname } = new URL(request.url())
    if ((pathname === risksPath || pathname.startsWith(`${risksPath}/`)) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) {
      writes.push(request)
    }
  })
  return writes
}

test('B2 第6项 风险登记、待确认回读、核实和责任确认及只读权限', async ({ browser }) => {
  test.setTimeout(150_000)
  const { accounts, manager, reader } = fixture
  const sample = sampleFor('登记与核实')
  await withB2RiskRolePages(browser, fixture.ui, accounts, browserActorId, async ({ M, U, P, X }) => {
    const { created, registered, initial, originalReceipt } = await test.step('主锚管理者登记风险并读取原号回执', async () => {
      expect(await findRisks(M, sample.title)).toMatchObject({ total: 0, items: [] })
      const registration = await openRegistration(M, sample)
      const created = await submitMutation(M, registration.submit, createPath, {
        ...sample, expected_revision: '0', attributes: {},
      })
      const creation = expectReceipt(created.result, 'create', created.operationId, '1', 'new')
      const registered = created.result.risk
      await expect(registration.dialog).toBeHidden()
      const row = riskRow(M, sample.title)
      await expect(row.getByText('待评估', { exact: true })).toBeVisible()
      await expect(row.getByText('责任待确认', { exact: true })).toBeVisible()
      const initial = await readDetail(manager, registered)
      expectCreated(initial, registered, sample)
      const originalReceipt = await readReceipt(manager, created.operationId)
      expect(originalReceipt).toMatchObject({ ...creation, replayed: true })
      expect(Date.parse(originalReceipt.created_at)).toBeGreaterThan(0)
      return { created, registered, initial, originalReceipt }
    })
    const managerRow = riskRow(M, sample.title)
    const readonlyWrites = observeRiskWrites(X)
    await test.step('只读成员可查看登记事实，写接口和他人的原操作号均受保护', async () => {
      expect(await findRisks(X, sample.title)).toMatchObject({ total: 1, items: [{ risk: registered }] })
      const readerRow = riskRow(X, sample.title)
      await expect(readerRow.getByText('责任待确认', { exact: true })).toBeVisible()
      await expect(X.getByRole('button', { name: '登记风险', exact: true })).toHaveCount(0)
      await expect(readerRow.getByRole('button', { name: `核实 ${registered.human_key}`, exact: true })).toHaveCount(0)
      await expect(readerRow.getByRole('button', { name: `指定 ${registered.human_key} 责任人`, exact: true })).toHaveCount(0)
      const drawer = await openDetail(X, readerRow, registered, sample)
      await expect(drawer.getByText('责任待确认', { exact: true })).toBeVisible()
      expect(await findRisks(P, sample.title)).toMatchObject({ total: 0, items: [] })
      await expect(P.getByText('暂无匹配记录', { exact: true })).toBeVisible()
      await expect(riskRow(P, sample.title)).toHaveCount(0)

      const hidden = await fixture.call(operationPath(created.operationId), reader)
      expect(hidden.status).toBe(404)
      expect(hidden.env?.code).toBe(94001)
      const target = { id: registered.id, expected_revision: registered.revision }
      const checks = [
        [createPath, { ...sample, expected_revision: '0' }],
        [assessPath, { ...target, level: 'high', treatment: 'mitigate', assessment_note: '合成权限核对' }],
        [assignPath, { ...target, owner_user_id: accounts.U.userId, reason: '合成权限核对' }],
      ] as const
      for (const [path, body] of checks) {
        const operationId = randomUUID()
        const denied = await fixture.call(path, { ...reader, method: 'POST', body: { ...body, operation_id: operationId } })
        expect(denied.status, path).toBe(403)
        expect(denied.env?.code, path).toBe(70001)
        const absent = await fixture.call(operationPath(operationId), reader)
        expect(absent.status).toBe(404)
        expect(absent.env?.code).toBe(94001)
      }
      expect(await readDetail(manager, registered)).toEqual(initial)
      expect(await readList(manager, sample)).toMatchObject({ total: 1, items: [{ risk: registered }] })
      expectHistory(await readHistory(manager, registered), registered, [['created', created.operationId, '1']])
    })

    const assessed = await test.step('主锚管理者核实风险，责任仍待确认', async () => {
      await managerRow.getByRole('button', { name: `核实 ${registered.human_key}`, exact: true }).click()
      const dialog = M.getByRole('dialog', { name: '核实风险', exact: true })
      await dialog.getByRole('combobox', { name: /整改级别/ }).press('ArrowDown')
      await M.getByRole('option', { name: '高', exact: true }).click()
      const note = 'B2 合成核实依据'
      await dialog.getByRole('textbox', { name: /核实说明/ }).fill(note)
      const assessed = await submitMutation(M, dialog.getByRole('button', { name: '提交核实', exact: true }), assessPath, {
        id: registered.id, expected_revision: registered.revision, level: 'high', treatment: 'mitigate', assessment_note: note,
      })
      expectReceipt(assessed.result, 'assess', assessed.operationId, '2', 'assessed')
      expect(assessed.result.risk).toMatchObject({ id: registered.id, human_key: registered.human_key })
      await expect(dialog).toBeHidden()
      await expect(managerRow.getByText('已评估', { exact: true })).toBeVisible()
      await expect(managerRow.getByText('责任待确认', { exact: true })).toBeVisible()
      expect(await readDetail(manager, registered)).toMatchObject({
        view: { risk: assessed.result.risk, status: 'assessed', level: 'high', treatment: 'mitigate',
          owner_user_id: null, dispatch_blockers: ['owner_unconfirmed'] },
      })
      return assessed
    })

    await test.step('确认责任后复核读者可见，原登记回执仍保留初始修订', async () => {
      await managerRow.getByRole('button', { name: `指定 ${registered.human_key} 责任人`, exact: true }).click()
      const dialog = M.getByRole('dialog', { name: '指定责任人', exact: true })
      const reason = 'B2 合成责任确认依据'
      await field(dialog, '责任人 ID').getByRole('textbox').fill(accounts.U.userId)
      await field(dialog, '确认说明').getByRole('textbox').fill(reason)
      const assigned = await submitMutation(M, dialog.getByRole('button', { name: '确认责任', exact: true }), assignPath, {
        id: registered.id, expected_revision: assessed.result.risk.revision, owner_user_id: accounts.U.userId, reason,
      })
      expectReceipt(assigned.result, 'assign', assigned.operationId, '3', 'assessed')
      const confirmed = assigned.result.risk
      expect(confirmed).toMatchObject({ id: registered.id, human_key: registered.human_key })
      await expect(dialog).toBeHidden()
      await expect(managerRow.getByRole('cell', { name: accounts.U.userId, exact: true })).toBeVisible()
      await expect(managerRow.getByText('责任待确认', { exact: true })).toHaveCount(0)
      expect(await readDetail(reader, confirmed)).toMatchObject({
        view: { risk: confirmed, status: 'assessed', level: 'high', owner_user_id: accounts.U.userId, dispatch_blockers: [] },
      })
      expect(await readReceipt(manager, created.operationId)).toEqual(originalReceipt)
      expect(new Set([created.operationId, assessed.operationId, assigned.operationId]).size).toBe(3)
      expectHistory(await readHistory(manager, confirmed), confirmed, [
        ['created', created.operationId, '1'], ['assessed', assessed.operationId, '2'], ['owner_assigned', assigned.operationId, '3'],
      ])
      expect(await findRisks(U, sample.title)).toMatchObject({ total: 1, items: [{ risk: confirmed }] })
      const ownerDrawer = await openDetail(U, riskRow(U, sample.title), confirmed, sample)
      await expect(ownerDrawer.getByText(accounts.U.userId, { exact: true })).toBeVisible()
      expect(readonlyWrites).toHaveLength(0)
    })
  })
})

test('B2 第6项 登记已提交但浏览器丢响应，只读核查原号且全程仅一次写入', async ({ page, context }) => {
  const { accounts: { M }, manager } = fixture
  await restrictB2Browser(context, [fixture.ui])
  await loginB2Browser(page, M)
  await page.waitForURL(/#\/home(?:[/?]|$)/)
  expect(await browserActorId(page)).toBe(M.userId)
  const sample = sampleFor('丢响应')
  expect(await findRisks(page, sample.title)).toMatchObject({ total: 0, items: [] })

  const { dialog, submit } = await openRegistration(page, sample)
  const writes = observeRiskWrites(page)
  let upstream: Envelope<Mutation> | undefined
  let upstreamStatus: number | undefined
  let forwardError: unknown
  // 真实请求原样转发一次。收到上游完整响应后，只中断这次浏览器响应。
  await page.route(`${fixture.ui}${createPath}`, async route => {
    if (!targets(route.request(), 'POST', createPath)) return route.fallback()
    try {
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 15_000 })
      upstreamStatus = response.status()
      upstream = await response.json() as Envelope<Mutation>
    } catch (error) {
      forwardError = error
    } finally {
      await route.abort('failed')
    }
  }, { times: 1 })
  const [failed] = await Promise.all([
    page.waitForEvent('requestfailed', request => targets(request, 'POST', createPath)),
    submit.click(),
  ])
  expect(forwardError).toBeUndefined()
  expect(upstreamStatus).toBe(200)
  expect(upstream?.code).toBe(0)
  expect(await failed.response()).toBeNull()
  const { operation_id: operationId } = failed.postDataJSON() as { operation_id: string }
  expect(failed.postDataJSON()).toMatchObject({ ...sample, expected_revision: '0', attributes: {} })
  expect(writes).toHaveLength(1)
  expect(writes[0] === failed).toBe(true)
  const result = upstream!.data
  const facts = expectReceipt(result, 'create', operationId, '1', 'new')
  const committed = await readDetail(manager, result.risk)
  expectCreated(committed, result.risk, sample)
  const committedReceipt = await readReceipt(manager, operationId)
  expect(committedReceipt).toMatchObject({ ...facts, replayed: true })
  expect(Date.parse(committedReceipt.created_at)).toBeGreaterThan(0)
  const history = await readHistory(manager, result.risk)
  expectHistory(history, result.risk, [['created', operationId, '1']])

  await expect(dialog.getByText(operationId, { exact: true })).toBeVisible()
  await expect(field(dialog, '标题').getByRole('textbox')).toBeDisabled()
  const [lookup] = await Promise.all([
    page.waitForResponse(response => targets(response.request(), 'GET', operationPath(operationId))),
    dialog.getByRole('button', { name: '只读核查', exact: true }).click(),
  ])
  expect(new URL(lookup.url()).pathname).toBe(operationPath(operationId))
  expect(await browserData<RiskReceipt>(lookup)).toEqual(committedReceipt)
  await expect(dialog).toBeHidden()
  const row = riskRow(page, sample.title)
  await expect(row.getByText('责任待确认', { exact: true })).toBeVisible()
  const drawer = await openDetail(page, row, result.risk, sample)
  await expect(drawer.getByText('责任待确认', { exact: true })).toBeVisible()

  expect(await readList(manager, sample)).toMatchObject({ total: 1, items: [{ risk: result.risk }] })
  expect(await readDetail(manager, result.risk)).toEqual(committed)
  expect(await readHistory(manager, result.risk)).toEqual(history)
  expect(await readReceipt(manager, operationId)).toEqual(committedReceipt)
  expect(writes).toHaveLength(1)
})
