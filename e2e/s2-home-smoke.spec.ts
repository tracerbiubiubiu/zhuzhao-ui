import { expect, test } from '@playwright/test'
import { api, apiLogin, loadState, tempTicketType, waitUserRateBudget } from './helpers'
import { uiLogin } from './ui'
import { setDarkTheme } from './appearance'
import { primaryButtonStates } from './buttonContrast'

/**
 * S2 工作台冒烟（主仓 03 号 §2 场景表，W2 冒烟集；2026-10-02 断言加固）
 * admin 登录 → 菜单渲染（管理面可见=全量绑定）→ 工作台状态卡数字 + 我的待办/已办 +
 * 最近工单行。数据确定性：API 预造一张 open 工单 → 「待处理」卡 ≥1 + 最近表必含该行
 * （原版只断两个标题文本——数字区/表行零断言，卡片坏数字也绿）。
 */
test('S2 工作台冒烟：admin 登录 → 菜单渲染 → 状态卡与最近工单', async ({ page }) => {
  const { admin } = loadState()
  const suffix = Date.now().toString(36)

  // ── API setup：造一张 open 工单（数据锚点）——用临时类型隔离自动分派规则（incident 全量命中规则会把新单秒变 assigned）──
  const login = await apiLogin(admin.employeeNo, admin.password, 's2-setup')
  const h = { token: login.env!.data.access_token } as const
  const orgId = ((await api('/api/v1/orgs', { token: h.token })).env!.data as Array<{ id: string }>)[0].id
  const tt = await tempTicketType(h, 'e2e_s2')
  let ticketId = ''
  const handled: string[] = []
  try {
    // 自定义非终态用真实类型图推进，不能把角标排除集合退化成内置状态白名单。
    const graph = await api('/api/v1/ticket-types/update', {
      ...h, method: 'POST', body: {
        code: tt.code,
        states: ['open', 'assigned', 'in_progress', 'pending_verify', 'closed', 'rejected', 'review_custom'],
        transitions: { open: ['assigned', 'closed'], assigned: ['in_progress', 'open', 'review_custom'], in_progress: ['pending_verify', 'rejected', 'closed'], pending_verify: ['closed', 'in_progress'], closed: ['open'], rejected: ['open'], review_custom: ['closed'] },
      },
    })
    expect(graph.env!.code).toBe(0)
    const created = await api('/api/v1/tickets', {
      ...h, method: 'POST',
      body: { type_code: tt.code, title: `S2 冒烟单据_${suffix}`, org_id: orgId },
    })
    expect(created.env!.code).toBe(0)
    ticketId = (created.env!.data as { id: string }).id
    const mine = (await api<{ id: string }>('/api/v1/user/profile', h)).env!.data.id
    for (const status of ['assigned', 'closed', 'review_custom']) {
      const r = await api<{ id: string }>('/api/v1/tickets', {
        ...h, method: 'POST', body: { type_code: tt.code, title: `S2 ${status}_${suffix}`, org_id: orgId },
      })
      expect(r.env!.code).toBe(0)
      const id = r.env!.data.id
      handled.push(id)
      expect((await api('/api/v1/tickets/assign', { ...h, method: 'POST', body: { id, assigned_to: mine } })).env!.code).toBe(0)
      if (status === 'closed') {
        expect((await api('/api/v1/tickets/transition', { ...h, method: 'POST', body: { id, to: 'in_progress' } })).env!.code).toBe(0)
        expect((await api('/api/v1/tickets/close', { ...h, method: 'POST', body: { id } })).env!.code).toBe(0)
      } else if (status === 'review_custom') {
        expect((await api('/api/v1/tickets/transition', { ...h, method: 'POST', body: { id, to: 'review_custom' } })).env!.code).toBe(0)
      }
    }

    await waitUserRateBudget() // 图/四张状态夹具与浏览器共用user_id限流桶
    const badgeResponse = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/badges' && r.status() === 200)
    await uiLogin(page, admin.employeeNo, admin.password)
    await expect(page).toHaveURL(/#\/home/, { timeout: 30_000 })

    const badgeCount = (await (await badgeResponse).json()).data.sections.todo as number

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

    // 真实computed颜色：状态/优先级是12px语义文字，不能以淡底淡字掩掉可读性。
    const tagContrasts = await page.locator('.home-recent-row .el-tag').evaluateAll((tags) => {
      const luminance = (css: string) => {
        const rgb = css.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => {
          const c = v / 255
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722
      }
      return tags.map((tag) => {
        const style = getComputedStyle(tag)
        const a = luminance(style.color), b = luminance(style.backgroundColor)
        return { text: tag.textContent, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) }
      })
    })
    expect(tagContrasts.length).toBeGreaterThan(0)
    for (const tag of tagContrasts) expect(tag.ratio, `徽标${tag.text}的文字对比度`).toBeGreaterThanOrEqual(4.5)


    // 首页卡片反复进入已缓存列表：URL、筛选回显和真实请求必须同口径。
    await page.locator('.el-card').filter({ hasText: '待处理' }).first().click()
    await expect(page).toHaveURL(/#\/tickets\?status=open/)
    const statusSelect = page.locator('.filter-bar .el-select').nth(1)
    // F14：真实鼠标状态下暗色实色primary文字可读；颜色稳定后测，不代替动画质量验证。
    const initialDark = await page.getByRole('switch', { name: 'Toggle dark mode' }).isChecked()
    await setDarkTheme(page, true)
    const primary = page.getByRole('button', { name: '新建工单', exact: true })
    const buttonStates = await primaryButtonStates(page, primary)
    expect(buttonStates[1].hover).toBe(true)
    expect(buttonStates[2].active).toBe(true)
    for (const state of buttonStates) {
      expect(state.disabled).toBe(false)
      expect(state.opacity).toBe('1')
      expect(state.ratio, `暗色实色主按钮${state.state}文字对比度`).toBeGreaterThanOrEqual(4.5)
    }
    await setDarkTheme(page, initialDark)
    await expect(statusSelect).toContainText('待处理')
    const focus = page.getByRole('button', { name: '表格聚焦', exact: true })
    await focus.press('Enter')
    await expect(page.getByRole('button', { name: '退出表格聚焦', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '表格聚焦', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await statusSelect.click()
    await page.getByRole('option', { name: '已关闭', exact: true }).click()
    await expect(statusSelect).toContainText('已关闭')
    await page.locator('.v-tags-view__link').filter({ hasText: '首页' }).click()
    await expect(page).toHaveURL(/#\/home/)
    await page.locator('.el-card').filter({ hasText: '待处理' }).first().click()
    await expect(page).toHaveURL(/#\/tickets\?status=open/)
    await expect(statusSelect).toContainText('待处理')
    await page.locator('.v-tags-view__link').filter({ hasText: '首页' }).click()
    await expect(page).toHaveURL(/#\/home/)
    const closedRequest = page.waitForResponse((r) => {
      const u = new URL(r.url())
      return u.pathname === '/api/v1/tickets' && u.searchParams.get('status') === 'closed'
    })
    await page.getByRole('link', { name: '查看已关闭工单', exact: true }).press('Enter')
    await expect(page).toHaveURL(/#\/tickets\?status=closed/)
    await expect(statusSelect).toContainText('已关闭')
    expect((await closedRequest).status()).toBe(200)
    await page.locator('.v-tags-view__link').filter({ hasText: '首页' }).click()
    const todoRequest = page.waitForResponse((r) => {
      const u = new URL(r.url())
      return u.pathname === '/api/v1/tickets' && u.searchParams.get('statuses') === 'assigned,in_progress'
        && u.searchParams.get('assignee') === 'me'
    })
    await page.getByRole('link', { name: '查看我的待办', exact: true }).press('Enter')
    await expect(statusSelect).toContainText('待办（已分派 / 进行中）')
    const response = await todoRequest
    expect(response.status()).toBe(200)
    const result = (await response.json()).data as { list: Array<{ id: string; status: string }> }
    expect(result.list.every((t) => ['assigned', 'in_progress'].includes(t.status))).toBe(true)
    expect(result.list.some((t) => t.id === handled[0]), '我的待办必须包含本轮已分派单').toBe(true)
    expect(result.list.some((t) => t.id === handled[1]), '我的待办不能混入本轮已关闭单').toBe(false)
    expect(result.list.some((t) => t.id === handled[2]), '首页两态待办不包含自定义状态').toBe(false)
    await expect(page.getByTestId('btn-export'), '收起筛选时导出动作仍可见').toBeVisible()
    const todoExport = page.waitForResponse((r) => {
      const u = new URL(r.url())
      return u.pathname === '/api/v1/tickets/export' && u.searchParams.get('statuses') === 'assigned,in_progress' && u.searchParams.get('assignee') === 'me'
    })
    await page.getByTestId('btn-export').click()
    expect((await todoExport).status()).toBe(200)

    // 角标是另一已明确统计口径：分派给我且排除终态，须保留自定义状态。
    const badgeList = page.waitForResponse((r) => {
      const u = new URL(r.url())
      return u.pathname === '/api/v1/tickets' && u.searchParams.get('exclude_statuses') === 'closed,rejected' && u.searchParams.get('assignee') === 'me'
    })
    await page.getByTestId('navbar-todo').press('Enter')
    await expect(statusSelect).toContainText('排除 已关闭 / 已驳回')
    const badgeRows = (await (await badgeList).json()).data as { list: Array<{ id: string; status: string }>; total: number }
    expect(badgeRows.total, '角标与入口列表总数必须一致').toBe(badgeCount)
    expect(badgeRows.list.some((t) => t.id === handled[0])).toBe(true)
    expect(badgeRows.list.some((t) => t.id === handled[2]), '角标必须保留本轮自定义非终态').toBe(true)
    expect(badgeRows.list.every((t) => !['closed', 'rejected'].includes(t.status))).toBe(true)
    const badgeExport = page.waitForResponse((r) => {
      const u = new URL(r.url())
      return u.pathname === '/api/v1/tickets/export' && u.searchParams.get('exclude_statuses') === 'closed,rejected'
        && u.searchParams.get('assignee') === 'me' && !u.searchParams.has('status') && !u.searchParams.has('statuses')
    })
    await page.getByTestId('btn-export').click()
    expect((await badgeExport).status()).toBe(200)
    await statusSelect.click()
    await page.getByRole('option', { name: '已关闭', exact: true }).click()
    await page.locator('.v-tags-view__link').filter({ hasText: '首页' }).click()
    await page.getByTestId('navbar-todo').press('Enter')
    await expect(statusSelect).toContainText('排除 已关闭 / 已驳回')
    await page.getByRole('button', { name: '重置', exact: true }).click()
    await expect(statusSelect).not.toContainText('排除')

  } finally {
    for (const id of [ticketId, ...handled].filter(Boolean)) await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id } }).catch(() => {})
    await tt.cleanup()
  }
})
