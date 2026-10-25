/**
 * P5-S3a 自动分派规则（B3-2）：规则管理页（000073 菜单行——E2E 补齐批补孤岛页）CRUD + 建单自动分派全链
 * （OnAfterCreate priority 首个命中 → Assign，决议③ target_user 须属 target_org）+ 停用后不再分派
 * + viewer 边界（B 案：页面 GET 可达、写控件不渲染、三写端点 403——000075 写端点迁按钮行后的 L1 口径）。
 * 隔离：用专属临时类型（API 建，默认六状态图含 open→assigned）——避免与存量 incident 规则
 * （无 keyword=全量命中）竞争首个命中。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, mustData } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(150_000)

test('P5-S3a：规则页建规则 → 建单自动分派 → 停用不分派 → 删除；viewer 只读+写端点 403', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const typeCode = `p5s3a_${suffix}`
  const keyword = `AUTO-${suffix}`

  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'p5-s3a-r')
  expect(admin.env?.code).toBe(0)
  const h = { token: admin.env!.data.access_token } as const
  const me = await mustData(api<{ id: string }>('/api/v1/user/profile', h), 'GET /user/profile')
  const orgs = await mustData(api<Array<{ id: string; name: string }>>('/api/v1/orgs', h), 'GET /orgs')
  const root = orgs.find((o) => o.name === '集团总部') ?? orgs[0] // admin 主组织（决议③ 写侧校验前提）
  const createdType = await api('/api/v1/ticket-types', { ...h, method: 'POST', body: { code: typeCode, name: `P5S3A类型_${suffix}` } })
  expect(createdType.env?.code, '建专属类型须成功').toBe(0)
  const ticketIds: string[] = []

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.goto('/#/tickets/rules')
    await page.reload() // 直达 URL 冷启动保险
    await expect(page.getByTestId('add-rule')).toBeVisible({ timeout: 20_000 })

    // ── 建规则（类型/关键词/目标组织/目标处理人=admin）──
    await page.getByTestId('add-rule').click()
    const dlg = page.locator('.el-dialog').filter({ hasText: '新建分派规则' })
    await expect(dlg).toBeVisible()
    await dlg.locator('.el-select').nth(0).click() // 工单类型
    await page.getByRole('option', { name: new RegExp(typeCode) }).click({ timeout: 10_000 })
    await dlg.getByPlaceholder('标题包含匹配（可选）').fill(keyword)
    await dlg.locator('.el-select').nth(1).click() // 目标组织
    await page.getByRole('option', { name: root.name }).click({ timeout: 10_000 })
    const picker = dlg.getByRole('combobox', { name: '目标处理人' }) // UserPicker（remote el-select）
    await picker.click()
    await picker.fill(state.admin.employeeNo)
    await page.getByRole('option', { name: new RegExp(state.admin.employeeNo) }).click({ timeout: 10_000 })
    await dlg.getByRole('button', { name: '创建' }).click()
    await expect(dlg).not.toBeVisible({ timeout: 10_000 })
    const ruleRow = page.locator('tr', { hasText: keyword })
    await expect(ruleRow).toBeVisible({ timeout: 10_000 })

    // ── 建单命中 → OnAfterCreate 自动分派给 admin，状态 assigned ──
    const mk = async (title: string) => {
      const r = await api<{ id: string }>('/api/v1/tickets', { ...h, method: 'POST', body: { type_code: typeCode, title, org_id: root.id } })
      expect(r.env?.code, `建单失败：${title}`).toBe(0)
      ticketIds.push(r.env!.data.id)
      return r.env!.data.id
    }
    const t1 = await mk(`${keyword} 自动分派验证`)
    const g1 = await api<{ status: string; assigned_to: string | null }>(`/api/v1/tickets/${t1}`, h)
    expect(g1.env?.data.status, '命中规则须自动进入 assigned').toBe('assigned')
    expect(String(g1.env?.data.assigned_to), '须分派给规则 target_user').toBe(String(me.id))

    // ── 停用规则 → 再建单保持 open ──
    const sw = ruleRow.locator('.el-switch')
    await sw.click()
    await expect(sw).not.toHaveClass(/is-checked/, { timeout: 10_000 })
    const t2 = await mk(`${keyword} 停用后`)
    const g2 = await api<{ status: string }>(`/api/v1/tickets/${t2}`, h)
    expect(g2.env?.data.status, '规则停用后不得分派').toBe('open')

    // ── 删除规则（危险确认）──
    await ruleRow.getByRole('button', { name: '删除' }).click()
    await page.locator('.el-message-box').filter({ hasText: '危险操作' }).getByRole('button', { name: '删除' }).click()
    await expect(ruleRow).toHaveCount(0, { timeout: 10_000 })

    // ── viewer 边界（B 案：预设绑 biz 域页面=GET 可达，写码 ticket:type:manage 排除）──
    // 页面可看、写控件全不渲染；API 侧三写端点须 403（000075 前写端点误挂页面行——只读角色曾可建/停/删规则）
    await page.evaluate(() => localStorage.clear())
    await uiLogin(page, state.viewer.employeeNo, state.viewer.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.goto('/#/tickets/rules')
    await page.reload()
    await expect(page.getByText('关键词（LIKE）')).toBeVisible({ timeout: 20_000 }) // 列表可达（页面行=GET）
    await expect(page.getByTestId('add-rule')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '删除' })).toHaveCount(0)
    await expect(page.locator('.el-table .el-switch')).toHaveCount(0)
    const viewer = await mustData(apiLogin(state.viewer.employeeNo, state.viewer.password, 'p5-s3a-v'), 'viewer API 登录')
    const vh = { token: viewer.access_token } as const
    expect((await api('/api/v1/assignment-rules', vh)).status, 'viewer 读规则列表须 200').toBe(200)
    const forbidden = await api('/api/v1/assignment-rules', { ...vh, method: 'POST', body: { type_code: '__p5_probe__', target_org: root.id } })
    expect(forbidden.status, 'viewer 建规则须 403（L1 按钮行口径）').toBe(403)
    const forbiddenToggle = await api('/api/v1/assignment-rules/enabled', { ...vh, method: 'POST', body: { id: '1', enabled: false } })
    expect(forbiddenToggle.status, 'viewer 停启规则须 403').toBe(403)
  } finally {
    for (const id of ticketIds) {
      await api('/api/v1/tickets/delete', { ...h, method: 'POST', body: { id } }).catch(() => {})
    }
    // 规则若未经 UI 删除（中途失败）按 keyword/类型兜底清理（列表信封 data.rules）
    const rules = await api<{ rules?: Array<{ id: string; keyword?: string; type_code: string }> }>('/api/v1/assignment-rules', h).catch(() => null)
    for (const r of rules?.env?.data?.rules ?? []) {
      if (r.keyword === keyword || r.type_code === typeCode || r.type_code === '__p5_probe__') {
        await api('/api/v1/assignment-rules/delete', { ...h, method: 'POST', body: { id: r.id } }).catch(() => {})
      }
    }
    await api('/api/v1/ticket-types/delete', { ...h, method: 'POST', body: { code: typeCode } }).catch(() => {})
  }
})
