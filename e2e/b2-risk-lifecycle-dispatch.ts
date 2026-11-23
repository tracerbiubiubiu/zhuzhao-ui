import { expect, type Page, type Request, type Response } from '@playwright/test'
import { loadB2Endpoints } from './b2-browser-env'
import { assertB2RiskResponse, observeB2RiskRequests } from './b2-risk-assertions'
import { confirmDispatchRestart, confirmRestartReadback } from './b2-risk-dispatch-restart'
import type { Envelope, TicketDefinitionRef } from './helpers'

const risksPath = '/api/v1/risk-items'
const ticketsPath = '/api/v1/tickets'
const planPath = `${risksPath}/dispatch-plan`
const applyPath = `${risksPath}/dispatch`
const operationsPath = `${risksPath}/dispatch-operations/`
const priorities = { urgent: 1, high: 2, medium: 3, low: 4 } as const

type RiskRef = { id: string; revision: string; human_key: string }
type AssetRef = { provider: string; external_id: string }
type RiskView = {
  risk: RiskRef; status: string; title: string; finding_key: string; asset_ref: AssetRef
  owner_user_id: string; dispatch_blockers: string[] | null; deadline: string; level: keyof typeof priorities
}
type RiskHistory = {
  total: number
  items: { event_kind: string; operation_id: string; actor_id: string; risk_id: string; aggregate_revision: string; payload: unknown }[]
}
type TicketRef = { id: string; ref: string }
type Ticket = { id: string; human_key: string; definition_ref: TicketDefinitionRef; revision: string }
type PlanGroup = {
  group_key: string; owner_user_id: string; ticket?: TicketRef; priority: number; business_due_at: string
  items: { risk_id: string; revision: string; human_key: string; asset_ref: AssetRef; deadline: string }[]
}
type Plan = {
  plan_id: string; plan_hash: string; expires_at: string; groups: PlanGroup[] | null; blocked?: unknown[] | null
}
type Result = {
  operation_id: string; plan_id: string; status: string
  groups: {
    group_key: string; group_operation_id: string; owner_user_id: string; owner_org_at_dispatch: string
    status: string; ticket: TicketRef
    items: { risk_id: string; result: string; reason?: string; ticket?: TicketRef }[]
  }[]
}
type Options = {
  page: Page; origin: string; actorId: string; ownerId: string; riskId: string; restartDir: string
  target: { org_id: string; type_code: string; definition_version: string }
  read: <T>(path: string) => Promise<T>
}

function matches(request: Request, method: string, url: string) {
  return request.method() === method && request.url() === url
}

async function browserData<T>(response: Response): Promise<T> {
  return await assertB2RiskResponse(response.request(), 200, 0) as T
}

async function readRisk({ read, riskId }: Options) {
  const [{ view }, history] = await Promise.all([
    read<{ view: RiskView }>(`${risksPath}/${riskId}`),
    read<RiskHistory>(`${risksPath}/${riskId}/history`),
  ])
  return { view, history }
}

async function ticketIndex({ read, target }: Options) {
  const type = encodeURIComponent(target.type_code)
  const { list, total } = await read<{ list: { id: string }[] | null; total: number }>(
    `${ticketsPath}?type_code=${type}&page=1&page_size=100`,
  )
  const ids = (list ?? []).map(({ id }) => id).sort()
  expect(ids).toHaveLength(total)
  return ids
}

async function openPlan({ page, origin, ownerId, target }: Options, view: RiskView) {
  const { risk, asset_ref, deadline } = view
  await page.getByRole('menuitem', { name: '风险列表', exact: true }).click()
  await expect(page).toHaveURL(/#\/risks$/)
  const search = page.getByPlaceholder('标题或编号')
  const [listResponse] = await Promise.all([
    page.waitForResponse(response => {
      const url = new URL(response.url())
      return response.request().method() === 'GET' && url.origin === origin
        && url.pathname === risksPath && url.searchParams.get('q') === risk.human_key
    }),
    search.fill(risk.human_key),
  ])
  const list = await browserData<{ items: RiskView[] }>(listResponse)
  expect(list.items.filter(item => item.risk.id === risk.id)).toEqual([
    expect.objectContaining({ risk, owner_user_id: ownerId, asset_ref, status: 'assessed' }),
  ])
  const row = page.getByRole('row').filter({ has: page.getByText(risk.human_key, { exact: true }) })
  await row.locator('.el-checkbox__inner').click()
  await expect(row.getByRole('checkbox', { name: `选择 ${risk.human_key} 派单` })).toBeChecked()
  await page.getByRole('textbox', { name: '目标组织 ID', exact: true }).fill(target.org_id)
  await page.getByRole('textbox', { name: '整改类型代码', exact: true }).fill(target.type_code)
  await page.getByTestId('risk-dispatch-open').click()
  const dialog = page.getByRole('dialog', { name: '风险派单', exact: true })
  await expect(dialog.getByRole('status')).toContainText(`已选 1 项风险；目标组织 ${target.org_id}，整改类型 ${target.type_code}。`)

  const [response] = await Promise.all([
    page.waitForResponse(response => matches(response.request(), 'POST', `${origin}${planPath}`)),
    dialog.getByRole('button', { name: '预览派单', exact: true }).click(),
  ])
  expect(response.request().postDataJSON()).toEqual({
    items: [{ risk_id: risk.id, expected_revision: risk.revision }],
    target_org_id: target.org_id, target_type_code: target.type_code,
  })
  const plan = await browserData<Plan>(response)
  expect(plan.plan_id).toMatch(/\S/)
  expect(plan.plan_hash).toMatch(/\S/)
  expect(Date.parse(plan.expires_at)).toBeGreaterThan(Date.now())
  expect(plan.blocked ?? []).toEqual([])
  expect(plan.groups).toHaveLength(1)
  const group = plan.groups![0]
  expect(group.group_key).toMatch(/\S/)
  expect(group.ticket).toBeUndefined()
  expect(group).toMatchObject({
    owner_user_id: ownerId, priority: priorities[view.level],
    items: [{ risk_id: risk.id, revision: risk.revision, human_key: risk.human_key, asset_ref, deadline }],
  })
  expect(Date.parse(group.business_due_at)).toBe(Date.parse(deadline))
  await expect(dialog.getByRole('status')).toContainText('预计涉及 1 张工单')
  const groupRow = dialog.getByTestId('dispatch-preview').getByRole('row').filter({ hasText: group.group_key })
  await expect(groupRow.getByRole('listitem').filter({ hasText: risk.human_key })).toBeVisible()
  return { dialog, plan, group }
}

async function readCommitted(
  options: Options,
  before: Awaited<ReturnType<typeof readRisk>>,
  priorTickets: string[],
  operationId: string,
  group: Result['groups'][number],
  priority: number,
) {
  const { target, riskId, ownerId, actorId, read } = options
  const { ticket } = group
  const [current, storedTicket, ticketIds] = await Promise.all([
    readRisk(options),
    read<Ticket>(`${ticketsPath}/${ticket.id}`),
    ticketIndex(options),
  ])
  expect(ticketIds).toEqual([...priorTickets, ticket.id].sort())
  expect(storedTicket).toMatchObject({
    id: ticket.id, human_key: ticket.ref, org_id: target.org_id, type_code: target.type_code,
    created_by: ownerId, assigned_to: ownerId, priority, status: 'assigned',
    definition_ref: { type_code: target.type_code, definition_version: target.definition_version },
  })
  expect(storedTicket.definition_ref.definition_hash).toMatch(/^[0-9a-f]{64}$/)
  const revision = String(BigInt(before.view.risk.revision) + 1n)
  expect(current.view).toMatchObject({
    risk: { ...before.view.risk, revision }, status: 'remediating', owner_user_id: ownerId,
    finding_key: before.view.finding_key, asset_ref: before.view.asset_ref,
  })
  expect(current.history.total).toBe(before.history.total + 1)
  expect(current.history.items.filter(event => event.event_kind === 'dispatch')).toEqual([expect.objectContaining({
    operation_id: operationId, actor_id: actorId, risk_id: riskId, aggregate_revision: revision,
    payload: expect.objectContaining({ ticket_id: ticket.id, ticket_ref: ticket.ref, group_key: group.group_key }),
  })])
  return { current, storedTicket, ticketIds }
}

/** 从正常入口派发刚登记的风险，完成同窗口原号查回与独立 PG 核对。 */
export async function dispatchB2LifecycleRisk(options: Options) {
  const { page, origin, actorId, ownerId, riskId, restartDir } = options
  expect(origin).toBe(loadB2Endpoints().ui)
  expect(ownerId).not.toBe(actorId)
  const before = await readRisk(options)
  expect(before.view).toMatchObject({ risk: { id: riskId }, owner_user_id: ownerId, status: 'assessed' })
  expect(before.view.finding_key).toMatch(/\S/)
  expect(before.view.asset_ref?.provider).toMatch(/\S/)
  expect(before.view.asset_ref?.external_id).toMatch(/\S/)
  expect(Object.keys(priorities)).toContain(before.view.level)
  expect(Date.parse(before.view.deadline)).toBeGreaterThan(0)
  expect(before.view.dispatch_blockers ?? []).toEqual([])
  expect(before.history.items.filter(event => event.event_kind === 'dispatch')).toEqual([])
  const tickets = await ticketIndex(options)

  const requests: Request[] = []
  function observe(request: Request) {
    const url = new URL(request.url())
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    const businessPath = [risksPath, ticketsPath].some(path => url.pathname === path || url.pathname.startsWith(`${path}/`))
    if (url.origin === origin && ((write && businessPath) || url.pathname.startsWith(operationsPath))) requests.push(request)
  }

  page.on('request', observe)
  try {
    const { dialog, plan, group: preview } = await openPlan(options, before.view)
    expect(await ticketIndex(options)).toEqual(tickets)
    expect(await readRisk(options)).toEqual(before)
    const submit = dialog.getByRole('button', { name: '确认派单', exact: true })
    const acknowledgement = '我已核对分组、目标和受阻项，确认按此预览派单'
    await expect(submit).toBeDisabled()
    await dialog.getByText(acknowledgement, { exact: true }).click()
    await expect(dialog.getByRole('checkbox', { name: acknowledgement })).toBeChecked()

    const applyURL = `${origin}${applyPath}`
    let upstream: { status: number; envelope: Envelope<Result> } | undefined
    await page.route(applyURL, async route => {
      if (!matches(route.request(), 'POST', applyURL)) return route.continue()
      try {
        const response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 15_000 })
        upstream = { status: response.status(), envelope: await response.json() as Envelope<Result> }
      } finally {
        await route.abort('connectionreset')
      }
    }, { times: 1 })
    const [failed] = await Promise.all([
      page.waitForEvent('requestfailed', { predicate: request => matches(request, 'POST', applyURL) }),
      submit.click(),
    ])
    expect(await failed.response()).toBeNull()
    const input = failed.postDataJSON() as { operation_id: string; plan_id: string; plan_hash: string }
    const operationId = input.operation_id
    expect(operationId).toMatch(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i)
    expect(input).toEqual({ operation_id: operationId, plan_id: plan.plan_id, plan_hash: plan.plan_hash })
    expect(upstream).toMatchObject({ status: 200, envelope: { code: 0 } })
    if (!upstream) throw new Error('浏览器响应丢失前未取得真实上游回执')
    const result = upstream.envelope.data
    expect(result).toMatchObject({ operation_id: operationId, plan_id: plan.plan_id, status: 'completed' })
    expect(result.groups).toHaveLength(1)
    const [group] = result.groups
    expect(group).toMatchObject({
      group_key: preview.group_key, owner_user_id: ownerId, status: 'completed',
      items: [{ risk_id: riskId, result: 'created' }],
    })
    expect(group.group_operation_id).toMatch(/\S/)
    expect(group.owner_org_at_dispatch).toMatch(/^[1-9]\d*$/)
    expect(group.ticket.id).toMatch(/^[1-9]\d*$/)
    expect(group.ticket.ref).toMatch(/\S/)
    const [item] = group.items
    expect(item.reason).toBeUndefined()
    if (item.ticket) expect(item.ticket).toEqual(group.ticket)
    await expect(dialog.getByRole('status')).toContainText('结果待核查，请保留此窗口并按原操作号核查')
    await expect(dialog.getByRole('status').locator('code')).toHaveText(operationId)

    const committed = await readCommitted(options, before, tickets, operationId, group, preview.priority)
    const restarted = await confirmDispatchRestart(restartDir, {
      operationId, planId: plan.plan_id, planHash: plan.plan_hash, actorId,
      groups: [{
        groupKey: group.group_key, groupOperationId: group.group_operation_id, ticketId: group.ticket.id,
        ownerId, ownerOrgId: group.owner_org_at_dispatch, riskIds: [riskId],
      }],
    }, { groups: 1, risks: 1 })
    const operationPath = `${operationsPath}${encodeURIComponent(operationId)}`
    expect(restarted.before.ticketRefs).toEqual([{ id: group.ticket.id, ref: group.ticket.ref }])
    const lookups = await observeB2RiskRequests(page, { method: 'GET', url: `${origin}${operationPath}` }, async () => {
      await dialog.getByTestId('dispatch-inspect').click()
      await expect(dialog.getByRole('status')).toContainText('只读核查成功，未续建')
    })
    expect(lookups).toHaveLength(1)
    expect(lookups[0].postData()).toBeNull()
    expect(await assertB2RiskResponse(lookups[0], 200, 0)).toEqual(result)
    await expect(dialog.getByRole('status').locator('code')).toHaveText(operationId)
    expect(await readCommitted(options, before, tickets, operationId, group, preview.priority)).toEqual(committed)
    await confirmRestartReadback(restartDir, operationId, restarted)

    await expect(dialog.getByText('本次派单已完成', { exact: true })).toBeVisible()
    const resultRow = dialog.getByTestId('dispatch-results').getByRole('row').filter({ hasText: group.group_key })
    await expect(resultRow.getByRole('listitem').filter({ hasText: `${riskId}：已建票` })).toBeVisible()
    const ticketLink = resultRow.getByTestId('authorized-ticket')
    await expect(ticketLink).toHaveText(group.ticket.ref)
    const [detailResponse] = await Promise.all([
      page.waitForResponse(response => matches(response.request(), 'GET', `${origin}${ticketsPath}/${group.ticket.id}`)),
      ticketLink.click(),
    ])
    await expect(page).toHaveURL(`${origin}/#/tickets/${group.ticket.id}`)
    expect(await browserData<Ticket>(detailResponse)).toMatchObject({ id: group.ticket.id, human_key: group.ticket.ref })
    expect(requests.map(request => [request.method(), new URL(request.url()).pathname])).toEqual([
      ['POST', planPath], ['POST', applyPath], ['GET', operationPath],
    ])
    return { ticket: group.ticket, operationId, operationPath, result, linkId: restarted.before.activeLinks[0]!.id,
      riskRefs: restarted.before.riskRefs }
  } finally {
    page.off('request', observe)
  }
}
