import { expect, test } from '@playwright/test'
import { api, apiLogin, loadState } from './helpers'
import { uiLogin } from './ui'

/**
 * S2 工作台冒烟（主仓 03 号 §2 场景表，W2 冒烟集；2026-10-02 断言加固）
 * admin 登录 → 菜单渲染（管理面可见=全量绑定）→ 工作台状态卡数字 + 我的待办/已办 +
 * 最近工单行。数据确定性：API 预造一张 open 工单 → 「待处理」卡 ≥1 + 最近表必含该行
 * （原版只断两个标题文本——数字区/表行零断言，卡片坏数字也绿）。
 */
test('S2 工作台冒烟：admin 登录 → 菜单渲染 → 状态卡与最近工单', async ({ page }) => {
  const { admin } = loadState()
  const suffix = Date.now().toString(36)

  // ── API setup：造一张 open 工单（数据锚点）──
  const login = await apiLogin(admin.employeeNo, admin.password, 's2-setup')
  const h = { token: login.env!.data.access_token } as const
  const orgId = ((await api('/api/v1/orgs', { token: h.token })).env!.data as Array<{ id: string }>)[0].id
  const created = await api('/api/v1/tickets', {
    ...h, method: 'POST',
    body: { type_code: 'incident', title: `S2 冒烟单据_${suffix}`, org_id: orgId },
  })
  expect(created.env!.code).toBe(0)
  const ticketId = (created.env!.data as { id: string }).id

  try {
    await uiLogin(page, admin.employeeNo, admin.password)
    await expect(page).toHaveURL(/#\/home/, { timeout: 30_000 })

    // 侧栏：admin 全量菜单——管理面目录可见
    await expect(page.locator('.el-menu').getByText('系统管理')).toBeVisible()

    // 状态卡数字真渲染（原版只断卡片标题）：加载完成后为数字（loading 态显 '—'）
    const openCardNum = page.locator('.el-card').filter({ hasText: '待处理' }).first().locator('.text-2xl')
    await expect(openCardNum).toHaveText(/^\d+$/, { timeout: 15_000 })
    expect(parseInt(await openCardNum.innerText(), 10), '「待处理」卡数字（预造 open 单 ≥1）').toBeGreaterThanOrEqual(1)

    // 我的待办/已办两卡同口径（assignee=me 数据源——W4 随批件点亮面）
    const myTodoNum = page.locator('.el-card').filter({ hasText: '我的待办' }).locator('.text-2xl')
    await expect(myTodoNum).toHaveText(/^\d+$/, { timeout: 15_000 })
    const myDoneNum = page.locator('.el-card').filter({ hasText: '我的已办' }).locator('.text-2xl')
    await expect(myDoneNum).toHaveText(/^\d+$/, { timeout: 15_000 })

    // 最近工单表行（id DESC——新造单必在首屏 10 行内）
    await expect(page.getByText('最近工单')).toBeVisible()
    await expect(page.locator('tr', { hasText: `S2 冒烟单据_${suffix}` })).toBeVisible({ timeout: 15_000 })
    // 行内状态 tag 与数据一致（open → 待处理）
    await expect(page.locator('tr', { hasText: `S2 冒烟单据_${suffix}` }).locator('.el-tag', { hasText: '待处理' })).toBeVisible()
    expect(ticketId).toBeTruthy()
  } finally {
    await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: ticketId } }).catch(() => {})
  }
})
