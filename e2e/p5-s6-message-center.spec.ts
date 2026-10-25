/**
 * P5-S6 二期 站内消息中心（B6-7）+ 铃铛未读（B10-3 badges unread 并入）：
 * API 建单并分派给 admin → ticket.assigned 事件（to_assignee）→ inbox 落行 → 铃铛红点
 * → 点铃铛进 /messages（000076 起为常量路由——此前菜单驱动，非绑定角色 404）→ 通知 tab 有未读行 → 全部已读 → 未读点清零
 * → 待办 tab 含本单（状态派生：assignee=me 非终态）→ 刷新后铃铛红点消失（badges 重取）
 * → viewer 点铃铛同样可达（G-23：/messages 常量路由 + inbox selfService）。
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

    // 点铃铛 → 消息中心（常量路由；菜单行已惰性化）
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

    // ── viewer：铃铛同样可达消息中心（G-23 实施 000076：/messages 常量路由 + inbox selfService——
    //    修前非 admin 角色点铃铛即 404 兜底页，inbox 请求 403）──
    await page.evaluate(() => localStorage.clear())
    await uiLogin(page, state.viewer.employeeNo, state.viewer.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.getByTestId('navbar-badge').click()
    await page.waitForURL(/#\/messages/, { timeout: 15_000 })
    await expect(page.getByRole('tab', { name: /通知/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('抱歉，您访问的页面不存在')).toHaveCount(0)
    const viewer = await mustData(apiLogin(state.viewer.employeeNo, state.viewer.password, 'p5-s6-v'), 'viewer API 登录')
    expect((await api('/api/v1/notifications/inbox?page=1&page_size=1', { token: viewer.access_token })).status, 'viewer inbox 须 200（selfService）').toBe(200)
  } finally {
    await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: tid } }).catch(() => {})
  }
})
