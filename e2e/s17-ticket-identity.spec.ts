import { test, expect, type Locator, type Page } from '@playwright/test'
import { api, apiLogin, loadState, mustData, pgAvailable, psql, tempTicketType } from './helpers'
import { uiLogin } from './ui'

async function pickUser(page: Page, field: Locator, employeeNo: string) {
  await field.getByRole('combobox').fill(employeeNo)
  await page.getByRole('option').filter({ hasText: employeeNo }).click()
}

test('S17：建单/分派催办上级与抄送保持大ID精确字符串', async ({ page }) => {
  test.skip(!pgAvailable(), '大ID夹具需要专属PG；不能通过公开建号API指定主键')
  const state = loadState()
  const suffix = Date.now().toString(36)
  const employeeNo = `E8B08${suffix}`
  const userId = (9007199254740993n + BigInt(Date.now())).toString()
  const login = await mustData(apiLogin(state.admin.employeeNo, state.admin.password, 's17-setup'), 'S17登录')
  const h = { token: login.access_token }
  const tt = await tempTicketType(h, 's17_id')
  let ticketId: string | undefined
  psql(`INSERT INTO users(id,username,employee_no,password,status) VALUES(${userId},'s17_${suffix}','${employeeNo}','synthetic-no-login',1)`)
  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.goto('/#/tickets/new')
    await page.locator('.el-form-item').filter({ hasText: '工单类型' }).locator('.el-select').click()
    await page.getByRole('option', { name: `E2E 临时类型 ${tt.code}`, exact: true }).click()
    await page.getByPlaceholder('一句话描述问题或请求').fill(`S17 精确ID_${suffix}`)
    await page.locator('.el-form-item').filter({ hasText: '归属组织' }).locator('.el-select').click()
    await page.getByRole('option', { name: '集团总部', exact: true }).click()
    await pickUser(page, page.locator('.el-form-item').filter({ hasText: '催办上级' }), employeeNo)
    const createRequest = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/v1/tickets' && r.method() === 'POST')
    await page.getByRole('button', { name: '提交工单', exact: true }).click()
    expect((await createRequest).postDataJSON().escalation_supervisor_id).toBe(userId)
    await page.waitForURL(/#\/tickets\/\d+/)
    ticketId = page.url().match(/tickets\/(\d+)/)?.[1]
    const created = await mustData(api<{ escalation_supervisor_id: string }>(`/api/v1/tickets/${ticketId}`, h), 'S17建单回读')
    expect(created.escalation_supervisor_id).toBe(userId)

    const cc = page.getByTestId('ticket-cc-card')
    await pickUser(page, cc.getByTestId('user-picker'), employeeNo)
    const ccRequest = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/v1/tickets/cc' && r.method() === 'POST')
    await cc.getByTestId('cc-add').click()
    expect((await ccRequest).postDataJSON().user_ids).toEqual([userId])
    await expect(cc.getByTestId(`cc-row-${userId}`)).toBeVisible()

    await page.getByRole('button', { name: '分派', exact: true }).click()
    const dialog = page.getByRole('dialog').filter({ hasText: '分派工单' })
    await pickUser(page, dialog.locator('.el-form-item').filter({ hasText: '处理人' }), employeeNo)
    await pickUser(page, dialog.locator('.el-form-item').filter({ hasText: '催办上级' }), employeeNo)
    const assignRequest = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/v1/tickets/assign')
    await dialog.getByRole('button', { name: '分派', exact: true }).click()
    expect((await assignRequest).postDataJSON().escalation_supervisor_id).toBe(userId)
    await expect(dialog).not.toBeVisible()
  } finally {
    if (ticketId) await mustData(api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: ticketId } }), 'S17清理工单')
    await tt.cleanup()
    // 消息规则可为合成收件人生成inbox，先清其专属行再移除账号，防FK残留。
    psql(`DELETE FROM notifications WHERE recipient_id=${userId}; DELETE FROM users WHERE id=${userId} AND employee_no='${employeeNo}'`)
  }
})
