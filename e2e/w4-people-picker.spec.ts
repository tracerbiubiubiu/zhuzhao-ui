/** F3 real-stack contract: ordinary ticket writer can pick without GET /users. */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, mustData, publishTicketType, tempTicketType, waitUserRateBudget } from './helpers'
import { uiLogin } from './ui'

test('F3：普通工单办理者选人不授用户管理读', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const login = await apiLogin(state.admin.employeeNo, state.admin.password, `f3_admin_${suffix}`)
  const h = { token: login.env!.data.access_token }
  const orgs = await mustData(api<Array<{ id: string }>>('/api/v1/orgs', h), 'orgs')
  const orgId = orgs[0]!.id
  const tt = await tempTicketType(h, 'e2e_f3')
  let roleId = ''; let userId = ''; let targetId = ''; let ticketId = ''
  const employeeNo = `F3${suffix}`
  const username = `f3_${suffix}`
  const targetNo = `F3B${suffix}`
  const targetName = `接单${suffix}`
  let password = 'F3Initial#20261117'
  try {
    await publishTicketType(h.token, tt.code)
    roleId = (await mustData(api<{ id: string }>('/api/v1/roles', { ...h, method: 'POST', body: { code: `f3_${suffix}`, name: `F3 ${suffix}`, priority: 50 } }), 'role')).id
    type Menu = { id: string; code: string; children?: Menu[] }
    const menus = await mustData(api<Menu[]>('/api/v1/menus', h), 'menus')
    const ids: string[] = []
    const wanted = new Set(['home', 'ticket_list', 'ticket_create_btn', 'ticket_assign_btn'])
    const visit = (nodes: Menu[]) => { for (const node of nodes) { if (wanted.has(node.code)) ids.push(node.id); visit(node.children ?? []) } }
    visit(menus)
    expect(ids).toHaveLength(4)
    await mustData(api('/api/v1/roles/menus', { ...h, method: 'POST', body: { role_id: roleId, menu_ids: ids } }), 'role menus')
    userId = (await mustData(api<{ id: string }>('/api/v1/users', { ...h, method: 'POST', body: { username, employee_no: employeeNo, real_name: `选人${suffix}`, password } }), 'user')).id
    targetId = (await mustData(api<{ id: string }>('/api/v1/users', { ...h, method: 'POST', body: { username: `f3_target_${suffix}`, employee_no: targetNo, real_name: targetName, password } }), 'target user')).id
    await mustData(api('/api/v1/users/roles', { ...h, method: 'POST', body: { user_id: userId, role_ids: [roleId] } }), 'user role')
    await mustData(api('/api/v1/orgs/members', { ...h, method: 'POST', body: { org_id: orgId, user_id: userId, ticket_scope: 'group' } }), 'membership')
    let actorLogin = await apiLogin(employeeNo, password, `f3_actor_${suffix}`)
    expect(actorLogin.env?.code).toBe(0)
    if (actorLogin.env!.data.must_change_password) {
      const changed = 'F3Current#20261117'
      await mustData(api('/api/v1/auth/password/update', { token: actorLogin.env!.data.access_token, method: 'POST', body: { old_password: password, new_password: changed } }), 'change synthetic password')
      password = changed
      actorLogin = await apiLogin(employeeNo, password, `f3_actor_current_${suffix}`)
    }
    const actor = { token: actorLogin.env!.data.access_token }
    expect((await api('/api/v1/users', actor)).status).toBe(403)
    ticketId = (await mustData(api<{ id: string }>('/api/v1/tickets', { ...actor, method: 'POST', body: { type_code: tt.code, title: `F3 ${suffix}`, org_id: orgId } }), 'ordinary create')).id
    await waitUserRateBudget()
    await uiLogin(page, employeeNo, password)
    await page.waitForURL(/#\/home/)
    await page.goto(`/#/tickets/${ticketId}`)
    await page.getByRole('button', { name: '分派', exact: true }).click()
    const dialog = page.locator('.el-dialog:visible').filter({ hasText: '分派工单' })
    const picker = dialog.getByTestId('user-picker').first()
    await expect(dialog.getByText('请输入2–50个字符搜索，最多显示20人').first()).toBeVisible()
    const requested = page.waitForResponse((r) => r.url().includes('/api/v1/tickets/people?') && new URL(r.url()).searchParams.get('q') === targetNo)
    await picker.locator('input').fill(targetNo)
    const response = await requested
    expect(response.status()).toBe(200)
    const rows = (await response.json()).data.list as Array<Record<string, unknown>>
    expect(rows).toEqual([{ id: targetId, label: `${targetName}(${targetNo})` }])
    await page.getByRole('option', { name: `${targetName}(${targetNo})`, exact: true }).click()
    await dialog.getByRole('button', { name: '分派', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect((await mustData(api<{ assigned_to: string }>(`/api/v1/tickets/${ticketId}`, actor), 'readback')).assigned_to).toBe(targetId)
    expect((await api('/api/v1/users', actor)).status).toBe(403)
    const cc = page.getByTestId('ticket-cc-card')
    await cc.getByTestId('user-picker').locator('input').fill(targetNo)
    await page.getByRole('option', { name: `${targetName}(${targetNo})`, exact: true }).click()
    await cc.getByTestId('cc-add').click()
    await expect(cc.getByTestId(`cc-row-${targetId}`)).toBeVisible()
  } finally {
    if (ticketId) await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: ticketId } })
    if (userId) await api('/api/v1/users/delete', { ...h, method: 'POST', body: { user_id: userId } })
    if (targetId) await api('/api/v1/users/delete', { ...h, method: 'POST', body: { user_id: targetId } })
    if (roleId) await api('/api/v1/roles/delete', { ...h, method: 'POST', body: { role_id: roleId } })
    await tt.cleanup()
  }
})
