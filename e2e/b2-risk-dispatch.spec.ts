import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page, type Request, type Response } from '@playwright/test'
import { assertB2Config, loadB2Endpoints, loginB2Browser, restrictB2Browser } from './b2-browser-env'
import { assertB2RiskResponse, observeB2RiskRequests } from './b2-risk-assertions'
import { dispatchAccount, loadDispatchFixture } from './b2-risk-dispatch-fixture'
import { confirmDispatchRestart, confirmRestartReadback, verifyRestartDirectory } from './b2-risk-dispatch-restart'
import type { Envelope, TicketDefinitionRef, TokenPair } from './helpers'

const risksPath = '/api/v1/risk-items'
const planPath = `${risksPath}/dispatch-plan`
const applyPath = `${risksPath}/dispatch`
const operationsPath = `${risksPath}/dispatch-operations/`
const operationPath = (id: string) => `${operationsPath}${encodeURIComponent(id)}`
const ticketsPath = '/api/v1/tickets'
const riskPriorities = { urgent: 1, high: 2, medium: 3, low: 4 } as const

type Fixture = ReturnType<typeof loadDispatchFixture>
type FixtureRisk = Fixture['ownerless']
type RiskRef = { id: string; revision: string; human_key: string }
type RiskView = {
  risk: RiskRef; title: string; status: string; org_id: string; finding_key: string
  asset_ref: { provider: string; external_id: string } | null; owner_user_id: string | null
  deadline: string | null; level: keyof typeof riskPriorities | null; dispatch_blockers: string[] | null
}
type RiskHistory = {
  total: number
  items: { event_kind: string; operation_id: string; actor_id: string; risk_id: string; aggregate_revision: string; payload: unknown }[]
}
type TicketRef = { id: string; ref: string }
type Ticket = { id: string; human_key: string; definition_ref: TicketDefinitionRef; revision: string }
type PlanGroup = {
  group_key: string; owner_user_id: string; priority: number; business_due_at: string; ticket?: TicketRef
  items: { risk_id: string; revision: string; human_key: string; title: string; asset_ref: RiskView['asset_ref']; deadline: string }[]
}
type Plan = {
  plan_id: string; plan_hash: string; expires_at: string; groups: PlanGroup[] | null
  blocked?: { risk_id: string; reason: string }[] | null
}
type ApplyInput = { operation_id: string; plan_id: string; plan_hash: string }
type Group = {
  group_key: string; group_operation_id: string; status: string; ticket: TicketRef
  owner_user_id: string; owner_org_at_dispatch: string
  items: { risk_id: string; result: string; reason?: string; ticket?: TicketRef }[]
}
type Result = { operation_id: string; plan_id: string; status: string; groups: Group[] }
type Session = {
  page: Page; origin: string; fixture: Fixture; actor: string
  read: <T>(path: string) => Promise<T>
  call: <T>(path: string, body?: ApplyInput) => Promise<{ status: number; envelope: Envelope<T> }>
}

const dispatch = test.extend<{ session: Session }>({
  session: async ({ page, baseURL, context }, use, testInfo) => {
    assertB2Config(testInfo)
    const { ui: origin, core } = loadB2Endpoints()
    expect(baseURL, 'Playwright baseURL 必须指向本轮 UI').toBe(origin)
    const fixture = loadDispatchFixture()
    const account = dispatchAccount()
    await restrictB2Browser(context, [origin])

    const [login] = await Promise.all([
      page.waitForResponse(response => matches(response.request(), 'POST', `${origin}/api/v1/auth/login`)),
      loginB2Browser(page, account),
    ])
    await page.waitForURL(/#\/home(?:[/?]|$)/)
    const session = await browserData<TokenPair>(login)
    if (!session.access_token || session.must_change_password) throw new Error('派单合成账号未取得可用会话')

    async function call<T>(path: string, body?: ApplyInput) {
      const url = new URL(path, core)
      if (url.origin !== core) throw new Error('独立回读须使用本轮 Core')
      const response = await fetch(url, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal: AbortSignal.timeout(8_000),
      })
      return { status: response.status, envelope: await response.json() as Envelope<T> }
    }

    async function read<T>(path: string) {
      const result = await call<T>(path)
      expect(result.status, `独立 GET ${path}`).toBe(200)
      expect(result.envelope.code, `独立 GET ${path} 业务码`).toBe(0)
      return result.envelope.data
    }

    const { id: actor, employee_no: employeeNo } = await read<{ id: string; employee_no: string }>('/api/v1/user/profile')
    expect(actor).toMatch(/^[1-9]\d*$/)
    if (employeeNo?.toUpperCase() !== account.employeeNo.toUpperCase()) {
      throw new Error('派单会话回读工号与本轮合成账号不符')
    }
    await use({ page, origin, fixture, actor, call, read })
  },
})

dispatch.use({ actionTimeout: 10_000, navigationTimeout: 15_000, serviceWorkers: 'block', trace: 'off', screenshot: 'off', video: 'off' })

function matches(request: Request, method: string, url: string): boolean {
  return request.method() === method && request.url() === url
}

async function browserData<T>(response: Response): Promise<T> {
  return await assertB2RiskResponse(response.request(), 200, 0) as T
}

function observeDispatch(session: Session) {
  const { origin, page } = session
  const requests: Request[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    const writes = !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    const businessPath = [risksPath, ticketsPath].some(path => url.pathname === path || url.pathname.startsWith(`${path}/`))
    if (url.origin === origin && ((writes && businessPath) || url.pathname.startsWith(operationsPath))) {
      requests.push(request)
    }
  })
  return requests
}

async function readRisk(session: Session, id: string) {
  const [detail, history] = await Promise.all([
    session.read<{ view: RiskView }>(`${risksPath}/${id}`),
    session.read<RiskHistory>(`${risksPath}/${id}/history`),
  ])
  return { view: detail.view, history }
}

async function readInputs(session: Session, inputs: FixtureRisk[]) {
  return Promise.all(inputs.map(async ({ risk_id, expected_revision }) => {
    const before = await readRisk(session, risk_id)
    expect(before.view.risk).toMatchObject({ id: risk_id, revision: expected_revision })
    expect(before.view.risk.human_key).toMatch(/\S/)
    expect(before.history.items.filter(event => event.event_kind === 'dispatch'), '夹具风险必须尚未派单').toEqual([])
    return before
  }))
}

type RiskBefore = Awaited<ReturnType<typeof readRisk>>

async function ticketIndex(session: Session) {
  const type = encodeURIComponent(session.fixture.target.type_code)
  const { list, total } = await session.read<{ list: { id: string }[] | null; total: number }>(`${ticketsPath}?type_code=${type}&page=1&page_size=100`)
  const ids = (list ?? []).map(ticket => ticket.id).sort()
  expect(ids).toHaveLength(total)
  return ids
}

function sharedTitle(views: RiskView[]): string {
  let prefix = views[0].title
  for (const { title } of views.slice(1)) {
    while (prefix && !title.startsWith(prefix)) prefix = prefix.slice(0, -1)
  }
  const query = prefix.trim()
  expect(query.length, '合成三资产需要共同的可搜索标题前缀').toBeGreaterThan(0)
  return query
}

async function openPreview(session: Session, rows: RiskBefore[], inputs: FixtureRisk[]) {
  const { page, origin, fixture: { target } } = session
  await page.getByRole('menuitem', { name: '风险列表', exact: true }).click()
  await expect(page).toHaveURL(/#\/risks$/)
  const query = sharedTitle(rows.map(({ view }) => view))
  const search = page.getByPlaceholder('标题或编号')
  await expect(search).toBeVisible()
  const [list] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.origin === origin && url.pathname === risksPath && url.searchParams.get('q') === query
        && response.request().method() === 'GET'
    }),
    search.fill(query),
  ])
  const { items } = await browserData<{ items: RiskView[] }>(list)
  expect(items.map(item => item.risk)).toEqual(expect.arrayContaining(rows.map(({ view }) => view.risk)))
  for (const { view } of rows) {
    const row = page.getByRole('row').filter({ has: page.getByText(view.risk.human_key, { exact: true }) })
    await row.locator('.el-checkbox__inner').click()
    await expect(row.getByRole('checkbox')).toBeChecked()
  }

  await page.getByRole('textbox', { name: '目标组织 ID', exact: true }).fill(target.org_id)
  await page.getByRole('textbox', { name: '整改类型代码', exact: true }).fill(target.type_code)
  await page.getByRole('button', { name: '预览派单', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '风险派单', exact: true })
  await expect(dialog.getByRole('status')).toContainText(`已选 ${inputs.length} 项风险；目标组织 ${target.org_id}，整改类型 ${target.type_code}。`)
  const [response] = await Promise.all([
    page.waitForResponse(response => matches(response.request(), 'POST', `${origin}${planPath}`)),
    dialog.getByRole('button', { name: '预览派单', exact: true }).click(),
  ])
  const body = response.request().postDataJSON() as { items: FixtureRisk[] }
  expect(body).toEqual({ items: expect.arrayContaining(inputs), target_org_id: target.org_id, target_type_code: target.type_code })
  expect(body.items).toHaveLength(inputs.length)
  const plan = await browserData<Plan>(response)
  expect(plan.plan_id).toMatch(/\S/)
  expect(plan.plan_hash).toMatch(/\S/)
  expect(Date.parse(plan.expires_at)).toBeGreaterThan(Date.now())
  return { dialog, plan }
}

async function verifyGroups(dialog: Locator, plan: Plan, rows: RiskBefore[], actor: string) {
  const [a, b, c] = rows.map(({ view }) => view)
  expect(a.owner_user_id).toMatch(/^[1-9]\d*$/)
  expect(b.owner_user_id).toBe(a.owner_user_id)
  expect(c.owner_user_id).toMatch(/^[1-9]\d*$/)
  expect(new Set([a.owner_user_id, c.owner_user_id, actor]).size).toBe(3)
  expect(a.finding_key).toMatch(/\S/)
  expect([b.finding_key, c.finding_key]).toEqual([a.finding_key, a.finding_key])
  expect([b.org_id, c.org_id]).toEqual([a.org_id, a.org_id])
  const views = [a, b, c]
  for (const view of views) {
    expect(view.asset_ref?.provider).toMatch(/\S/)
    expect(view.asset_ref?.external_id).toMatch(/\S/)
    expect(Date.parse(view.deadline ?? '')).toBeGreaterThan(0)
    expect(Object.keys(riskPriorities)).toContain(view.level)
    expect(view.dispatch_blockers ?? []).toEqual([])
  }
  expect(new Set(views.map(view => JSON.stringify([view.asset_ref?.provider, view.asset_ref?.external_id]))).size).toBe(3)
  const groups = plan.groups ?? []
  expect(plan.blocked ?? []).toEqual([])
  expect(groups).toHaveLength(2)
  expect(new Set(groups.map(group => group.group_key)).size).toBe(2)
  await expect(dialog.getByRole('status')).toContainText('预计涉及 2 张工单')
  for (const members of [[a, b], [c]]) {
    const group = groups.find(item => item.owner_user_id === members[0].owner_user_id)
    if (!group) throw new Error('预览缺少具名负责人分组')
    expect(group.group_key).toMatch(/\S/)
    expect(group.ticket).toBeUndefined()
    expect(group.items).toHaveLength(members.length)
    expect(group.items).toEqual(expect.arrayContaining(members.map(member => expect.objectContaining({
      risk_id: member.risk.id, revision: member.risk.revision, human_key: member.risk.human_key,
      asset_ref: member.asset_ref, deadline: member.deadline,
    }))))
    expect(Date.parse(group.business_due_at)).toBe(Math.min(...members.map(member => Date.parse(member.deadline ?? ''))))
    expect(group.priority).toBe(Math.min(...members.map(member => member.level ? riskPriorities[member.level] : 0)))
    const row = dialog.getByTestId('dispatch-preview').getByRole('row').filter({ hasText: group.group_key })
    for (const member of members) await expect(row.getByRole('listitem').filter({ hasText: member.risk.human_key })).toBeVisible()
  }
}

function originalInput(request: Request, plan: Plan): ApplyInput {
  const body = request.postDataJSON() as ApplyInput
  expect(body).toEqual({ operation_id: expect.any(String), plan_id: plan.plan_id, plan_hash: plan.plan_hash })
  expect(body.operation_id).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
  return body
}

async function assertResult(dialog: Locator, result: Result, input: ApplyInput, plan: Plan) {
  expect(result).toMatchObject({ operation_id: input.operation_id, plan_id: input.plan_id, status: 'completed' })
  expect(result.groups).toHaveLength(2)
  expect(new Set(result.groups.map(group => group.ticket?.id)).size).toBe(2)
  expect(new Set(result.groups.map(group => group.group_operation_id)).size).toBe(2)
  expect(new Set(result.groups.map(group => group.group_key))).toEqual(new Set((plan.groups ?? []).map(group => group.group_key)))
  await expect(dialog.getByText('本次派单已完成', { exact: true })).toBeVisible()
  for (const group of result.groups) {
    const preview = plan.groups?.find(row => row.group_key === group.group_key)
    if (!preview) throw new Error('回执分组与预览不符')
    expect(group).toMatchObject({ status: 'completed', owner_user_id: preview.owner_user_id })
    expect(group.group_operation_id).toMatch(/\S/)
    expect(group.owner_org_at_dispatch).toMatch(/^[1-9]\d*$/)
    expect(group.ticket.id).toMatch(/^[1-9]\d*$/)
    expect(group.ticket.ref).toMatch(/\S/)
    expect(group.items).toHaveLength(preview.items.length)
    expect(group.items).toEqual(expect.arrayContaining(preview.items.map(item => expect.objectContaining({ risk_id: item.risk_id, result: 'created' }))))
    const row = dialog.getByTestId('dispatch-results').getByRole('row').filter({ hasText: group.group_key })
    await expect(row.getByTestId('authorized-ticket')).toHaveText(group.ticket.ref)
    for (const item of group.items) {
      expect(item.reason).toBeUndefined()
      if (item.ticket) expect(item.ticket).toEqual(group.ticket)
      await expect(row.getByRole('listitem').filter({ hasText: `${item.risk_id}：已建票` })).toBeVisible()
    }
  }
}

async function readCommitted(session: Session, result: Result, before: RiskBefore[], plan: Plan, previousTickets: string[]) {
  const { target } = session.fixture
  expect(await ticketIndex(session)).toEqual([...previousTickets, ...result.groups.map(group => group.ticket.id)].sort())
  const receipt = await session.read<Result>(operationPath(result.operation_id))
  expect(receipt).toEqual(result)
  return Promise.all(result.groups.map(async group => {
    const { ticket, items } = group
    const ticketRead = await session.read<Ticket>(`${ticketsPath}/${ticket.id}`)
    const preview = plan.groups?.find(row => row.group_key === group.group_key)
    if (!preview) throw new Error('持久读回缺对应预览组')
    expect(ticketRead).toMatchObject({
      id: ticket.id, human_key: ticket.ref, org_id: target.org_id, type_code: target.type_code,
      created_by: group.owner_user_id, assigned_to: group.owner_user_id, priority: preview.priority, status: 'assigned',
      definition_ref: { type_code: target.type_code, definition_version: target.definition_version },
    })
    expect(ticketRead.definition_ref.definition_hash).toMatch(/^[0-9a-f]{64}$/)
    const risks = await Promise.all(items.map(async ({ risk_id }) => {
      const initial = before.find(({ view }) => view.risk.id === risk_id)
      if (!initial) throw new Error('回执含本轮以外的风险')
      const after = await readRisk(session, risk_id)
      const revision = String(BigInt(initial.view.risk.revision) + 1n)
      expect(after.view).toMatchObject({
        risk: { ...initial.view.risk, revision }, status: 'remediating', owner_user_id: group.owner_user_id,
        asset_ref: initial.view.asset_ref, finding_key: initial.view.finding_key,
      })
      expect(after.history.total).toBe(initial.history.total + 1)
      expect(after.history.items.filter(event => event.event_kind === 'dispatch')).toEqual([expect.objectContaining({
        operation_id: result.operation_id, actor_id: session.actor, risk_id, aggregate_revision: revision,
        payload: expect.objectContaining({ ticket_id: ticket.id, ticket_ref: ticket.ref, group_key: group.group_key }),
      })])
      return after
    }))
    return { ticket: ticketRead, risks }
  }))
}

async function readFromDialog(session: Session, dialog: Locator, input: ApplyInput) {
  const { page, origin } = session
  await expect(dialog.getByRole('status').locator('code')).toHaveText(input.operation_id)
  const reads = await observeB2RiskRequests(page, { method: 'GET', url: `${origin}${operationPath(input.operation_id)}` }, async () => {
    await dialog.getByTestId('dispatch-inspect').click()
    await expect(dialog.getByRole('status')).toContainText('只读核查成功，未续建')
  })
  expect(reads).toHaveLength(1)
  expect(reads[0].postData()).toBeNull()
  return await assertB2RiskResponse(reads[0], 200, 0) as Result
}

function expectSequence(requests: Request[], operationId: string) {
  expect(requests.map(request => [request.method(), new URL(request.url()).pathname])).toEqual([
    ['POST', planPath], ['POST', applyPath], ['GET', operationPath(operationId)],
  ])
}

async function acknowledgePlan(dialog: Locator) {
  const label = '我已核对分组、目标和受阻项，确认按此预览派单'
  await dialog.getByText(label, { exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: label })).toBeChecked()
}

dispatch('B2 第7项 三资产按两个具名负责人派两票，逐项回读和原号只读核查', async ({ session }) => {
  const inputs = session.fixture.risks
  const before = await readInputs(session, inputs)
  const tickets = await ticketIndex(session)
  const requests = observeDispatch(session)
  const { dialog, plan } = await openPreview(session, before, inputs)
  await verifyGroups(dialog, plan, before, session.actor)
  expect(await ticketIndex(session)).toEqual(tickets)

  const submit = dialog.getByRole('button', { name: '确认派单', exact: true })
  await expect(submit).toBeDisabled()
  await acknowledgePlan(dialog)
  const [response] = await Promise.all([
    session.page.waitForResponse(response => matches(response.request(), 'POST', `${session.origin}${applyPath}`)),
    submit.click(),
  ])
  const input = originalInput(response.request(), plan)
  const result = await browserData<Result>(response)
  await assertResult(dialog, result, input, plan)
  const committed = await readCommitted(session, result, before, plan, tickets)
  expect(await readFromDialog(session, dialog, input)).toEqual(result)
  expect(await readCommitted(session, result, before, plan, tickets)).toEqual(committed)
  expectSequence(requests, input.operation_id)

  const original = result.groups[0]!
  const ticketPath = `${ticketsPath}/${original.ticket.id}`
  const originalRow = dialog.getByTestId('dispatch-results').getByRole('row').filter({ hasText: original.group_key })
  const [detail] = await Promise.all([
    session.page.waitForResponse(response => matches(response.request(), 'GET', `${session.origin}${ticketPath}`)),
    originalRow.getByTestId('authorized-ticket').click(),
  ])
  await expect(session.page).toHaveURL(`${session.origin}/#/tickets/${original.ticket.id}`)
  expect(await browserData<Ticket>(detail)).toMatchObject({ id: original.ticket.id, human_key: original.ticket.ref })
})

dispatch('B2 第7项 缺少具名负责人时阻断派单，未建票及未写派单历史', async ({ session }) => {
  const inputs = [session.fixture.ownerless]
  const before = await readInputs(session, inputs)
  const [{ view }] = before
  expect(view.owner_user_id).toBeNull()
  expect(view.finding_key).toMatch(/\S/)
  expect(view.asset_ref?.provider).toMatch(/\S/)
  expect(view.asset_ref?.external_id).toMatch(/\S/)
  expect(view.dispatch_blockers).toEqual(['owner_unconfirmed'])
  expect(Date.parse(view.deadline ?? '')).toBeGreaterThan(0)
  const tickets = await ticketIndex(session)
  const requests = observeDispatch(session)
  const { dialog, plan } = await openPreview(session, before, inputs)
  expect(plan.groups ?? []).toEqual([])
  expect(plan.blocked).toEqual([{ risk_id: view.risk.id, reason: 'missing_personal_owner' }])
  await expect(dialog.getByRole('region', { name: '受阻风险' })).toContainText(`${view.risk.id}：缺少具体负责人，须先确认负责人`)
  await expect(dialog.getByRole('button', { name: '确认派单', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)
  expect(requests.map(request => [request.method(), new URL(request.url()).pathname])).toEqual([['POST', planPath]])

  // 浏览器按钮保持禁用。以相同业务账号单独检查零分组命令在服务端的拒绝与无回执。
  const operation_id = randomUUID()
  const rejected = await session.call(applyPath, { operation_id, plan_id: plan.plan_id, plan_hash: plan.plan_hash })
  expect(rejected).toMatchObject({ status: 400, envelope: { code: 10001 } })
  const receipt = await session.call(operationPath(operation_id))
  expect(receipt).toMatchObject({ status: 404, envelope: { code: 10004 } })
  expect(await readRisk(session, view.risk.id)).toEqual(before[0])
  expect(await ticketIndex(session)).toEqual(tickets)
  expect(requests).toHaveLength(1)
})

dispatch('B2 第7项 提交后丢响应并受控重启，原页面只读核回两票', async ({ session }) => {
  test.setTimeout(180_000)
  const inputs = session.fixture.restart
  const dispatchRestartDir = await verifyRestartDirectory()
  const before = await readInputs(session, inputs)
  const tickets = await ticketIndex(session)
  const requests = observeDispatch(session)
  const { dialog, plan } = await openPreview(session, before, inputs)
  await verifyGroups(dialog, plan, before, session.actor)
  const applyURL = `${session.origin}${applyPath}`
  let upstream: { status: number; envelope: Envelope<Result> } | undefined
  await session.page.route(applyURL, async route => {
    if (!matches(route.request(), 'POST', applyURL)) return route.continue()
    try {
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 15_000 })
      upstream = { status: response.status(), envelope: await response.json() as Envelope<Result> }
    } finally {
      await route.abort('connectionreset')
    }
  }, { times: 1 })

  await acknowledgePlan(dialog)
  const [failed] = await Promise.all([
    session.page.waitForEvent('requestfailed', { predicate: request => matches(request, 'POST', applyURL) }),
    dialog.getByRole('button', { name: '确认派单', exact: true }).click(),
  ])
  const input = originalInput(failed, plan)
  expect(await failed.response()).toBeNull()
  expect(upstream).toMatchObject({ status: 200, envelope: { code: 0 } })
  if (!upstream) throw new Error('丢响应前未取得真实上游成功结果')
  const result = upstream.envelope.data
  expect(result).toMatchObject({ operation_id: input.operation_id, plan_id: input.plan_id, status: 'completed' })
  await expect(dialog.getByRole('status')).toContainText('结果待核查，请保留此窗口并按原操作号核查')
  const committed = await readCommitted(session, result, before, plan, tickets)
  const checkpoint = await confirmDispatchRestart(dispatchRestartDir, {
    operationId: input.operation_id, planId: input.plan_id, planHash: input.plan_hash, actorId: session.actor,
    groups: result.groups.map(group => ({
      groupKey: group.group_key, groupOperationId: group.group_operation_id, ticketId: group.ticket.id,
      ownerId: group.owner_user_id, ownerOrgId: group.owner_org_at_dispatch,
      riskIds: group.items.map(item => item.risk_id),
    })),
  })
  expect(await readFromDialog(session, dialog, input)).toEqual(result)
  await assertResult(dialog, result, input, plan)
  expect(await readCommitted(session, result, before, plan, tickets)).toEqual(committed)
  await confirmRestartReadback(dispatchRestartDir, input.operation_id, checkpoint)
  expectSequence(requests, input.operation_id)
})
