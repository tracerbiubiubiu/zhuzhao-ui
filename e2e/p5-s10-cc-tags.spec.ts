/**
 * P5-S10 工单协作：抄送 + 标签（B10-1 / B10-2）——详情页两卡片走查自动化。
 * - 抄送我 → 抄送行出现（抄送即可见——L2 第四 OR 支的 UI 侧证据）→ 点 × 自摘 → 行消失
 * - 标签：输入回车挂标签 → chip 出现 → 列表接口按 tag 筛选命中本单（EXISTS 子查询不旁路可见性管线）
 *   → 点 × 摘除 → 消失
 * 打标准三栈；建单走 API 预置，收尾软删。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, mustData } from './helpers'
import { uiLogin } from './ui'

test('P5-S10：抄送我/自摘 + 标签挂/筛/摘（详情页卡片）', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)

  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'p5-s10')
  expect(admin.env?.code, 'admin API 登录须成功').toBe(0)
  const h = { token: admin.env!.data.access_token } as const
  const me = await mustData(api<{ id: string }>('/api/v1/user/profile', h), 'GET /user/profile')
  const orgId = (await mustData(api<Array<{ id: string }>>('/api/v1/orgs', h), 'GET /orgs'))[0].id
  const created = await api<{ id: string }>('/api/v1/tickets', {
    ...h, method: 'POST', body: { type_code: 'incident', title: `P5-S10 抄送标签_${suffix}`, org_id: orgId },
  })
  expect(created.env?.code, '建单须成功').toBe(0)
  const tid = created.env!.data.id

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.goto(`/#/tickets/${tid}`)

    // ── 抄送（B10-1）──
    const ccCard = page.getByTestId('ticket-cc-card')
    await expect(ccCard).toBeVisible({ timeout: 15_000 })
    await ccCard.getByTestId('cc-self').click()
    const ccRow = ccCard.getByTestId(`cc-row-${me.id}`)
    await expect(ccRow).toBeVisible({ timeout: 10_000 })
    await expect(ccCard.getByText('抄送（1）')).toBeVisible()
    await ccRow.locator('.el-tag__close').click()
    await expect(ccRow).toHaveCount(0, { timeout: 10_000 })
    await expect(ccCard.getByText('抄送（0）')).toBeVisible()

    // ── 标签（B10-2）──
    const tagCard = page.getByTestId('ticket-tags-card')
    const tag = `e2e-${suffix}`
    const input = tagCard.getByTestId('tag-input')
    await input.fill(tag)
    await input.press('Enter')
    const chip = tagCard.getByTestId(`tag-${tag}`)
    await expect(chip).toBeVisible({ timeout: 10_000 })
    const byTag = await api<{ list: Array<{ id: string }> }>(`/api/v1/tickets?tag=${encodeURIComponent(tag)}`, h)
    expect(byTag.env?.code).toBe(0)
    expect(byTag.env!.data.list.map((t) => t.id), '按 tag 筛选须命中本单').toContain(tid)
    await chip.locator('.el-tag__close').click()
    await expect(chip).toHaveCount(0, { timeout: 10_000 })
  } finally {
    await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id: tid } }).catch(() => {})
  }
})
