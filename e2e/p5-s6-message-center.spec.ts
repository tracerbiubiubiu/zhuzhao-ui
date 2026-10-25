/**
 * P5-S6 二期 站内消息中心（B6-7）+ 铃铛未读（B10-3 badges unread 并入）：
 * API 建单并分派给 admin → ticket.assigned 事件（to_assignee）→ inbox 落行 → 铃铛红点
 * → 点铃铛进 /messages（000074 回补 role_menus 前此处 404）→ 通知 tab 有未读行 → 全部已读 → 未读点清零
 * → 待办 tab 含本单（状态派生：assignee=me 非终态）→ 刷新后铃铛红点消失（badges 重取）。
 * 注：全部已读会清掉 admin 既有未读（E2E 专属账号的测试数据，可接受）。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, mustData } from './helpers'
import { uiLogin } from './ui'

test('P5-S6：分派事件入站 → 铃铛未读 → 消息中心全部已读 → 待办派生', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const title = `P5-S6 消息中心_${suffix}`

  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'p5-s6')
  expect(admin.env?.code).toBe(0)
  const h = { token: admin.env!.data.access_token } as const
  const me = await mustData(api<{ id: string }>('/api/v1/user/profile', h), 'GET /user/profile')
  const orgId = (await mustData(api<Array<{ id: string }>>('/api/v1/orgs', h), 'GET /orgs'))[0].id
  const created = await api<{ id: string }>('/api/v1/tickets', {
    ...h, method: 'POST', body: { type_code: 'incident', title, org_id: orgId },
  })
  expect(created.env?.code, '建单须成功').toBe(0)
  const tid = created.env!.data.id
  const assign = await api('/api/v1/tickets/assign', { ...h, method: 'POST', body: { id: tid, assigned_to: me.id } })
  expect(assign.env?.code, '分派须成功（触发 ticket.assigned → inbox）').toBe(0)

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })

    // 铃铛可见且有未读红点
    const bell = page.getByTestId('navbar-badge')
    await expect(bell).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('badge-unread').locator('.el-badge__content')).toBeVisible({ timeout: 15_000 })

    // 点铃铛 → 消息中心（菜单页可达——000074 前对 superadmin 亦 404）
    await bell.click()
    await page.waitForURL(/#\/messages/, { timeout: 15_000 })
    const rows = page.locator('[data-testid^="msg-"]')
    await expect(rows.first()).toBeVisible({ timeout: 15_000 })
    // 通知行标题含工单标题（事件快照入站即渲染）；pane 限定——非活动 tab 仍在 DOM 会撞 strict mode
    await expect(page.locator('#pane-notifications').getByText(title).first()).toBeVisible()
    await expect(page.locator('.msg-dot--unread').first()).toBeVisible()

    // 全部已读 → 未读点清零
    await page.getByTestId('read-all').click()
    await expect(page.locator('.msg-dot--unread')).toHaveCount(0, { timeout: 10_000 })

    // 待办 tab：状态派生（assignee=me 且非终态）含本单
    await page.getByRole('tab', { name: /待办/ }).click()
    await expect(page.locator('#pane-todos').getByText(title)).toBeVisible({ timeout: 15_000 })

    // 刷新重取 badges → 未读红点消失
    await page.reload()
    await expect(page.getByTestId('navbar-badge')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('badge-unread').locator('.el-badge__content')).toBeHidden({ timeout: 15_000 })
  } finally {
    await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: tid } }).catch(() => {})
  }
})
