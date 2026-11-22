import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page, type Request, type Response } from '@playwright/test'
import { API_BASE, api, apiLogin, loadState, mustData, psql, publishTicketType, tempTicketType, waitUserRateBudget, type Envelope, type TicketDefinitionRef } from './helpers'
import { uiLogin } from './ui'

test.use({ trace: 'off', screenshot: 'off' })

const reviewStatus = 'pending_verify'
const reviewPath = '/api/v1/tickets/transition'
const repair = { field_key: 'repair', field_label: '整改说明', field_type: 'textarea' }
const evidence = { field_key: 'evidence', field_label: '整改附件', field_type: 'file', field_options: ['text/plain'] }
const environment = { field_key: 'environment', field_label: '复测环境', field_type: 'input' }

type Auth = { token: string }
type TicketFacts = {
  id: string
  status: string
  revision: string
  assigned_to: string
  status_changed_at: string
  updated_at: string
  definition_resolution: string
  definition_ref: TicketDefinitionRef
  custom_data?: Record<string, unknown>
}
type Attachment = { object_key: string; file_name: string }

function postsTo(request: Request, path: string): boolean {
  return request.method() === 'POST' && new URL(request.url()).pathname === path
}

async function responseData<T>(response: Response, label: string): Promise<T> {
  expect(response.status(), label).toBe(200)
  const envelope = await response.json() as Envelope<T>
  expect(envelope.code, label).toBe(0)
  return envelope.data
}

async function signIn(page: Page, account: { employeeNo: string; password: string }) {
  try {
    await uiLogin(page, account.employeeNo, account.password)
    await page.waitForURL(/#\/home/)
  } catch {
    throw new Error('合成账号浏览器登录未到达首页')
  }
}

async function saveDraft(auth: Auth, code: string, fields: Array<{ field_key: string; field_label: string; field_type: string; field_options?: string[] }>) {
  await mustData(api('/api/v1/ticket-types/fields/replace', {
    ...auth, method: 'POST', body: { code, fields },
  }), '保存整改字段草稿')
  await mustData(api('/api/v1/ticket-types/update', {
    ...auth, method: 'POST',
    body: {
      code,
      states: ['open', 'assigned', reviewStatus, 'closed'],
      transitions: { open: ['assigned'], assigned: [reviewStatus], [reviewStatus]: ['closed'] },
      transition_meta: {
        [`assigned>${reviewStatus}`]: {
          roles: ['assignee'],
          collect_fields: fields.map(field => ({ key: field.field_key, required: true })),
        },
      },
    },
  }), '保存送复测动作草稿')
}

function field(root: Page | Locator, label: string): Locator {
  return root.locator('.el-form-item').filter({ hasText: label })
}

function readTicket(auth: Auth, id: string): Promise<TicketFacts> {
  return mustData(api<TicketFacts>(`/api/v1/tickets/${id}`, auth), '回读整改工单')
}

function readAttachments(auth: Auth, id: string): Promise<Attachment[]> {
  return mustData(api<Attachment[]>(`/api/v1/tickets/${id}/attachments`, auth), '回读工单附件')
}

function reviewHistory(id: string): Array<{ user_id: string; from_value: string; to_value: string }> | null {
  if (!process.env.E2E_PG_CONTAINER) return null
  if (!/^[1-9]\d*$/.test(id)) throw new Error('回读历史需要十进制工单 ID')
  const sql = `SELECT COALESCE(json_agg(json_build_object('user_id', user_id::text,
    'from_value', from_value, 'to_value', to_value) ORDER BY id), '[]'::json)
    FROM ticket_events WHERE ticket_id=${id} AND action='status_changed'`
  try {
    return JSON.parse(psql(sql.replace(/\s+/g, ' ')))
  } catch {
    throw new Error('候选工单历史回读失败')
  }
}

async function startReview(page: Page, id: string, version: string, requiresEnvironment: boolean) {
  await page.goto(`/#/tickets/${id}`)
  const versionCell = page.locator('.el-descriptions__label').filter({ hasText: /^规则版本$/ }).locator('xpath=following-sibling::td[1]')
  await expect(versionCell).toHaveText(version)
  await expect(page.getByText(repair.field_label, { exact: true })).toBeVisible()
  if (requiresEnvironment) await expect(page.getByText(environment.field_label, { exact: true })).toBeVisible()
  else await expect(page.getByText(environment.field_label, { exact: true })).toHaveCount(0)
  const action = page.getByTestId(`btn-transition-${reviewStatus}`)
  const actionTitle = (await action.innerText()).trim()
  await action.click()
  const dialog = page.getByRole('dialog', { name: actionTitle, exact: true })
  await expect(dialog).toBeVisible()
  await expect(field(dialog, repair.field_label).getByRole('textbox')).toBeVisible()
  await expect(field(dialog, evidence.field_label).locator('input[type="file"]')).toBeVisible()
  if (requiresEnvironment) await expect(field(dialog, environment.field_label).getByRole('textbox')).toBeVisible()
  else await expect(field(dialog, environment.field_label)).toHaveCount(0)
  return { dialog, confirm: dialog.getByRole('button', { name: `确认${actionTitle}`, exact: true }) }
}

async function uploadEvidence(page: Page, dialog: Locator, fileName: string, content: string): Promise<string> {
  const confirmed = page.waitForResponse(response => postsTo(response.request(), '/api/v1/tickets/attachments/confirm'))
  await field(dialog, evidence.field_label).locator('input[type="file"]').setInputFiles({
    name: fileName, mimeType: 'text/plain', buffer: Buffer.from(content),
  })
  const file = await responseData<{ object_key: string; status: string; purpose: string }>(await confirmed, '实际对象上传确认')
  expect(file).toMatchObject({ status: 'confirmed', purpose: 'attachment_create', object_key: expect.any(String) })
  expect(file.object_key).not.toBe('')
  await expect(dialog.getByRole('button', { name: `移除 ${fileName}` })).toBeVisible()
  return file.object_key
}

test('B2 第4–5项：已发布规则固定，办理人一次提交整改证据并送复测', async ({ page, browser, baseURL }, testInfo) => {
  test.setTimeout(150_000)
  if (!process.env.E2E_PG_CONTAINER) {
    testInfo.annotations.push({ type: '历史未覆盖', description: '设置候选的 E2E_PG_CONTAINER 可补充工单历史回读' })
  }
  const { admin, operator } = loadState()
  const [adminSession, operatorSession] = await Promise.all([
    mustData(apiLogin(admin.employeeNo, admin.password, 'b2-fixture-admin'), '合成管理员 API 登录'),
    mustData(apiLogin(operator.employeeNo, operator.password, 'b2-fixture-assignee'), '合成办理人 API 登录'),
  ])
  const adminAuth = { token: adminSession.access_token }
  const operatorAuth = { token: operatorSession.access_token }
  const [assignee, organizations] = await Promise.all([
    mustData(api<{ id: string }>('/api/v1/user/profile', operatorAuth), '读取办理人身份'),
    mustData(api<{ list: Array<{ org_name: string }> }>('/api/v1/user/orgs', adminAuth), '读取建单组织'),
  ])
  const orgName = organizations.list?.[0]?.org_name ?? '集团总部'
  const type = await tempTicketType(adminAuth, 'b2_d01_d02')
  const typeName = `E2E 临时类型 ${type.code}`
  const ticketIds: string[] = []
  let assigneePage: Page | undefined

  async function createInBrowser(title: string, definition: TicketDefinitionRef, hasEnvironment: boolean) {
    await page.goto('/#/tickets/new')
    await field(page, '工单类型').locator('.el-select').click()
    await page.getByRole('option', { name: typeName, exact: true }).click()
    await expect(page.getByText(`${typeName} · 已发布版本 ${definition.definition_version}`, { exact: true })).toBeVisible()
    await expect(page.getByText(`定义摘要 ${definition.definition_hash}`, { exact: true })).toBeVisible()
    await expect(field(page, repair.field_label).getByRole('textbox')).toBeVisible()
    if (hasEnvironment) await expect(field(page, environment.field_label).getByRole('textbox')).toBeVisible()
    else await expect(field(page, environment.field_label)).toHaveCount(0)
    await page.getByPlaceholder('一句话描述问题或请求').fill(title)
    await field(page, '归属组织').locator('.el-select').click()
    await page.getByRole('option', { name: orgName, exact: true }).click()
    const sent = page.waitForResponse(response => postsTo(response.request(), '/api/v1/tickets'))
    await page.getByRole('button', { name: '提交工单', exact: true }).click()
    const response = await sent
    const { id } = await responseData<{ id: string }>(response, '页面建单')
    ticketIds.push(id)
    expect(response.request().postDataJSON()).toMatchObject({
      type_code: type.code, definition_version: definition.definition_version, definition_hash: definition.definition_hash,
    })
    await page.waitForURL(`**/#/tickets/${id}`)
    expect(await readTicket(adminAuth, id)).toMatchObject({
      id, status: 'open', definition_resolution: 'exact', definition_ref: definition,
    })
    return id
  }

  try {
    const { ticketA, ticketB, definitionA, definitionB } = await test.step('发布 A、保存 B 草稿并确认 A 仍可建单、发布 B', async () => {
      await saveDraft(adminAuth, type.code, [repair, evidence])
      const unpublished = await api(`/api/v1/ticket-types/${type.code}/published`, adminAuth)
      expect(unpublished.status, '首次发布前，新草稿没有可建单的表单').toBe(503)
      const a = await publishTicketType(adminAuth.token, type.code)
      await waitUserRateBudget()
      await signIn(page, admin)
      const first = await createInBrowser('B2 A版整改工单', a, false)

      await saveDraft(adminAuth, type.code, [repair, evidence, environment])
      await waitUserRateBudget()
      await createInBrowser('B2 B草稿期间按 A 建单', a, false)

      const b = await publishTicketType(adminAuth.token, type.code)
      expect(b.definition_version).not.toBe(a.definition_version)
      expect(b.definition_hash).not.toBe(a.definition_hash)
      await waitUserRateBudget()
      const second = await createInBrowser('B2 B版整改工单', b, true)
      return { ticketA: first, ticketB: second, definitionA: a, definitionB: b }
    })

    for (const id of [ticketA, ticketB]) {
      await mustData(api('/api/v1/tickets/assign', {
        ...adminAuth, method: 'POST', body: { id, assigned_to: assignee.id },
      }), '分派给合成办理人')
    }
    const workerPage = await browser.newPage({ baseURL })
    assigneePage = workerPage
    await signIn(workerPage, operator)
    const reviewRequests: Request[] = []
    workerPage.on('request', request => { if (postsTo(request, reviewPath)) reviewRequests.push(request) })

    async function exerciseReview(id: string, definition: TicketDefinitionRef, withEnvironment: boolean) {
      const before = await readTicket(operatorAuth, id)
      expect(before).toMatchObject({ status: 'assigned', assigned_to: assignee.id, definition_ref: definition })
      const historyBefore = reviewHistory(id)
      const { dialog, confirm } = await startReview(workerPage, id, definition.definition_version, withEnvironment)
      const explanation = `B2 合成整改说明 ${id}`
      const fileName = `b2-evidence-${id}.txt`
      const fileContent = `B2 synthetic evidence ${id}`
      await field(dialog, repair.field_label).getByRole('textbox').fill(explanation)
      const objectKey = await uploadEvidence(workerPage, dialog, fileName, fileContent)
      expect(await readAttachments(operatorAuth, id)).toEqual([])

      const priorWrites = reviewRequests.length
      const patch: Record<string, unknown> = { repair: explanation, evidence: [objectKey] }
      const command = { id, to: reviewStatus, expected_revision: before.revision, definition_version: definition.definition_version, custom_data_patch: patch }
      if (withEnvironment) {
        await confirm.click()
        await expect(dialog.getByText('请填写「复测环境」', { exact: true })).toBeVisible()
        expect(reviewRequests).toHaveLength(priorWrites)
        expect(await readTicket(operatorAuth, id)).toEqual(before)

        const rejected = await api(reviewPath, {
          ...operatorAuth, method: 'POST', headers: { 'Idempotency-Key': randomUUID() }, body: command,
        })
        expect(rejected.status, '服务端也须拒绝缺复测环境的相同证据').toBe(400)
        expect(rejected.env?.message).toContain('缺少必填证据')
        expect(await readTicket(operatorAuth, id)).toEqual(before)
        expect(await readAttachments(operatorAuth, id)).toEqual([])
        expect(reviewHistory(id)).toEqual(historyBefore)
        const environmentValue = '合成复测环境 B'
        const environmentInput = field(dialog, environment.field_label).getByRole('textbox')
        await environmentInput.fill(environmentValue)
        await expect(environmentInput).toHaveValue(environmentValue)
        await expect(dialog.getByText('请填写「复测环境」', { exact: true })).toBeHidden()
        patch.environment = environmentValue
      }

      await expect(confirm, '补齐后应允许提交').toBeEnabled()
      const [response] = await Promise.all([
        workerPage.waitForResponse(r => postsTo(r.request(), reviewPath), { timeout: 15_000 }),
        confirm.click(),
      ])
      await responseData<unknown>(response, '送复测提交')
      expect(response.request().postDataJSON()).toMatchObject(command)
      expect(await response.request().headerValue('idempotency-key')).toBeTruthy()
      await expect(dialog).toBeHidden()
      await expect(workerPage.locator('.el-card').first().getByText('待验证', { exact: true })).toBeVisible()
      await expect(workerPage.getByText(explanation, { exact: true })).toBeVisible()
      if (withEnvironment) await expect(workerPage.getByText(String(patch.environment), { exact: true })).toBeVisible()
      const card = workerPage.locator('.ticket-attachments')
      await expect(card.locator('.attachment-item')).toHaveCount(1)
      await expect(card.getByText(fileName, { exact: true })).toBeVisible()
      expect(reviewRequests).toHaveLength(priorWrites + 1)

      const after = await readTicket(operatorAuth, id)
      expect(after).toMatchObject({ status: reviewStatus, definition_ref: definition, custom_data: patch })
      expect(after.custom_data).toEqual(patch)
      expect(after.revision).toBe(String(BigInt(before.revision) + 1n))
      expect(Date.parse(after.status_changed_at)).toBeGreaterThan(Date.parse(before.status_changed_at))
      expect(Date.parse(after.updated_at)).toBeGreaterThan(Date.parse(before.updated_at))
      expect(await readAttachments(operatorAuth, id)).toEqual([expect.objectContaining({ object_key: objectKey, file_name: fileName })])
      const download = await fetch(`${API_BASE}/api/v1/files/${objectKey.split('/').map(encodeURIComponent).join('/')}`, {
        headers: { Authorization: `Bearer ${operatorAuth.token}` },
      })
      expect(download.status).toBe(200)
      expect(await download.text()).toBe(fileContent)
      if (historyBefore) {
        expect(reviewHistory(id)).toEqual([...historyBefore, { user_id: assignee.id, from_value: 'assigned', to_value: reviewStatus }])
      }
    }

    await test.step('B 发布后，A 办理人一次提交说明、附件并送复测', () => exerciseReview(ticketA, definitionA, false))
    await test.step('B 缺复测环境时保持原记录，补齐后一次推进', () => exerciseReview(ticketB, definitionB, true))
  } finally {
    try {
      const results = await Promise.allSettled([
        assigneePage?.close(),
        ...ticketIds.map(id => mustData(api('/api/v1/tickets/delete', {
          ...adminAuth, method: 'POST', body: { id },
        }), '清理合成整改工单')),
      ])
      const failed = results.find(result => result.status === 'rejected')
      if (failed) throw failed.reason
    } finally {
      await type.cleanup()
    }
  }
})
