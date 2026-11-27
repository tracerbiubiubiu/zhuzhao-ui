import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { api, apiLogin, loadState, mustData, publishTicketType, tempTicketType, waitUserRateBudget } from './helpers'
import { uiLogin } from './ui'

test('工单转办丢回包后原号重试、撤回和同筛选统计导出', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const auth = async (account: typeof state.admin, label: string) => ({
    token: (await mustData(apiLogin(account.employeeNo, account.password, 'handling-' + label), '合成账号登录')).access_token,
  })
  const admin = await auth(state.admin, 'setup')
  const actor = await auth(state.operator, 'actor')
  const viewer = await auth(state.viewer, 'target')
  const profile = (h: typeof admin) => mustData(api<{ id: string }>('/api/v1/user/profile', h), '读取账号')
  const actorId = (await profile(actor)).id
  const viewerId = (await profile(viewer)).id
  const type = await tempTicketType(admin, 'e2e_handling')
  const post = <T = unknown>(path: string, body: unknown, token = admin.token) =>
    mustData(api<T>('/api/v1/' + path, { method: 'POST', token, body }), path)
  let orgId = ''
  let successorId = ''
  const successor = { employeeNo: `E89${suffix.slice(-8)}`, password: `E2eHandling#${suffix}` }
  const tickets: string[] = []
  const members: string[] = []
  try {
    orgId = (await post<{ id: string }>('orgs', { code: 'h_' + suffix, name: '合成办理组 ' + suffix })).id
    const roles = await mustData(api<Array<{ id: string; code: string }>>('/api/v1/roles', admin), '读取合成角色')
    const operator = roles.find(role => role.code === 'operator')
    expect(operator).toBeDefined()
    successorId = (await post<{ id: string }>('users', { employee_no: successor.employeeNo, password: successor.password,
      username: `e2e_handling_${suffix}`, role_ids: [operator!.id] })).id
    for (const user_id of [actorId, viewerId, successorId]) {
      await post('orgs/members', { org_id: orgId, user_id, ticket_scope: 'group' })
      members.push(user_id)
    }
    await post('ticket-types/update', { code: type.code, states: ['open', 'assigned', 'closed', 'cancelled'],
      transitions: { open: ['assigned', 'closed', 'cancelled'], assigned: ['closed'] },
      transition_meta: { 'open>cancelled': { roles: ['creator'], comment_required: true } } })
    await publishTicketType(admin.token, type.code)
    for (const title of ['转办', '撤回']) {
      tickets.push((await post<{ id: string }>('tickets', { type_code: type.code, org_id: orgId, title: title + suffix }, actor.token)).id)
    }
    const [transfer, withdraw] = tickets
    await post('tickets/assign', { id: transfer, assigned_to: actorId })
    await waitUserRateBudget()
    await uiLogin(page, state.operator.employeeNo, state.operator.password)
    await page.waitForURL(/#\/home/)
    await page.goto('/#/tickets/' + transfer)
    await page.getByTestId('btn-transfer').click()
    const transferDialog = page.getByRole('dialog', { name: '转办工单' })
    await transferDialog.getByRole('combobox').fill(successor.employeeNo)
    await page.getByRole('option', { name: new RegExp(successor.employeeNo) }).click()
    let sentKey = ''
    await page.route('**/api/v1/tickets/transfer', async route => {
      sentKey = route.request().headers()['idempotency-key'] ?? ''
      const committed = await route.fetch()
      expect(committed.ok()).toBe(true)
      await route.abort('failed')
    }, { times: 1 })
    await transferDialog.getByRole('button', { name: '确认转办' }).click()
    await expect(transferDialog.getByText(/原提交结果待确认/)).toBeVisible()
    const replay = page.waitForResponse(res => new URL(res.url()).pathname === '/api/v1/tickets/transfer')
    await transferDialog.getByRole('button', { name: '原操作重试' }).click()
    const result = await replay
    expect(sentKey).not.toBe('')
    expect(result.request().headers()['idempotency-key']).toBe(sentKey)
    expect(result.ok()).toBe(true)
    const row = (await result.json()).data
    expect(row).toMatchObject({ id: transfer, assigned_to: successorId, status: 'assigned' })
    await expect(transferDialog).not.toBeVisible()

    await page.goto('/#/tickets/' + withdraw)
    await expect(page.getByTestId('btn-transfer')).toHaveCount(0)
    await page.getByTestId('btn-withdraw').click()
    const withdrawDialog = page.getByRole('dialog', { name: '撤回工单' })
    const confirmWithdraw = withdrawDialog.getByRole('button', { name: '确认撤回' })
    await expect(confirmWithdraw).toBeDisabled()
    await withdrawDialog.getByPlaceholder('请填写撤回说明').fill('合成撤回说明')
    await confirmWithdraw.click()
    await expect(page.locator('.el-card').first().locator('.el-tag').first()).toHaveText('已撤回')
    await expect(page.getByTestId('btn-withdraw')).toHaveCount(0)

    const query = 'type_code=' + encodeURIComponent(type.code) + '&status=cancelled'
    await page.goto('/#/tickets?' + query)
    await expect(page.getByText('撤回' + suffix, { exact: true })).toBeVisible()
    await expect(page.getByText('转办' + suffix, { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '工单统计' }).click()
    const stats = page.getByRole('dialog', { name: '工单统计' })
    await expect(stats.getByRole('row', { name: /已撤回/ })).toContainText('—')
    await expect(stats.getByText(/共 1 份工单/)).toBeVisible()
    await stats.getByText('按优先级').click()
    await expect(stats.getByRole('rowheader')).toHaveCount(1)
    await stats.getByText('按类型').click()
    await expect(stats.getByRole('rowheader')).toContainText(type.code)
    await page.keyboard.press('Escape')
    const exported = page.waitForResponse(res => new URL(res.url()).pathname === '/api/v1/tickets/export')
    await page.getByTestId('btn-export').click()
    const excel = await exported
    expect(excel.ok()).toBe(true)
    const params = new URL(excel.url()).searchParams
    expect(Object.fromEntries(params)).toEqual({ type_code: type.code, status: 'cancelled' })
    // 读取实际 XLSX 工作表，兼容共享字符串和内联字符串两种编码。
    const values: string[][] = JSON.parse(execFileSync('python3', ['-c', `
import io, json, sys, zipfile
from xml.etree import ElementTree as ET
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as book:
    strings = []
    if 'xl/sharedStrings.xml' in book.namelist():
        strings = [''.join(si.itertext()) for si in ET.fromstring(book.read('xl/sharedStrings.xml'))]
    rows = []
    for row in ET.fromstring(book.read('xl/worksheets/sheet1.xml')).findall('.//{*}row'):
        values = []
        for cell in row.findall('{*}c'):
            value = cell.findtext('{*}v', '')
            values.append(strings[int(value)] if cell.get('t') == 's' else
                ''.join(cell.itertext()) if cell.get('t') == 'inlineStr' else value)
        rows.append(values)
    print(json.dumps(rows))
`], { input: await excel.body(), encoding: 'utf8' }))
    expect(values).toHaveLength(2)
    expect(values[1]).toContain('撤回' + suffix)
    expect(values.flat()).not.toContain('转办' + suffix)

    await page.evaluate(() => localStorage.clear())
    await uiLogin(page, successor.employeeNo, successor.password)
    await page.waitForURL(/#\/home/)
    await page.goto('/#/tickets/' + transfer)
    await page.reload()
    await expect(page.getByText('转办' + suffix, { exact: false }).first()).toBeVisible()
    await expect(page.getByTestId('btn-withdraw')).toHaveCount(0)
    await page.getByTestId('btn-transition-closed').click()
    await expect(page.locator('.el-card').first().locator('.el-tag').first()).toHaveText('已关闭')
    await page.evaluate(() => localStorage.clear())
    await uiLogin(page, state.viewer.employeeNo, state.viewer.password)
    await page.waitForURL(/#\/home/)
    await page.goto('/#/tickets?type_code=' + encodeURIComponent(type.code))
    await expect(page.getByText('转办' + suffix, { exact: true })).toHaveCount(0)
    await expect(page.getByText('撤回' + suffix, { exact: true })).toHaveCount(0)

  } finally {
    for (const id of tickets) await post('tickets/delete', { id })
    for (const user_id of members) await post('orgs/members/delete', { org_id: orgId, user_id })
    if (orgId) await post('orgs/delete', { org_id: orgId })
    if (successorId) await post('users/delete', { user_id: successorId })
    await type.cleanup()
  }
})
