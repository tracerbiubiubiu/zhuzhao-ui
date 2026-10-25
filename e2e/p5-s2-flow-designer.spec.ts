/**
 * P5-S2 流程图设计器（B2-2 画布/JSON 双模式 · B2-3/B2-4 图检查告警不阻断）。
 * 新建类型默认六状态图 → 编辑框画布可见 + 图检查通过 → 切 JSON 源码回显同一份数据 → 切回画布
 * → 添加孤立状态 → 角标翻告警（不阻断，仅提示）。只读走查，取消关闭；收尾删类型。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState } from './helpers'
import { uiLogin } from './ui'

test('P5-S2：画布/JSON 双模式回显 + 添加孤立状态触发图检查告警', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const code = `p5s2_${suffix}`

  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'p5-s2')
  expect(admin.env?.code).toBe(0)
  const h = { token: admin.env!.data.access_token } as const
  const created = await api('/api/v1/ticket-types', { ...h, method: 'POST', body: { code, name: `P5S2类型_${suffix}` } })
  expect(created.env?.code, '建类型须成功').toBe(0)

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/, { timeout: 30_000 })
    await page.goto('/#/tickets/types')
    await page.reload() // 直达 URL 冷启动保险（S12 同款）

    const row = page.locator('tr', { hasText: code })
    await expect(row).toBeVisible({ timeout: 15_000 })
    await row.getByRole('button', { name: '编辑' }).click()
    const dlg = page.locator('.el-dialog').filter({ hasText: '编辑类型' })
    await expect(dlg).toBeVisible()

    // 画布态：默认六状态图干净 → 图检查通过
    await expect(dlg.getByTestId('graph-mode')).toBeVisible()
    await expect(dlg.getByTestId('fg-canvas')).toBeVisible()
    await expect(dlg.getByTestId('fg-lint-ok')).toBeVisible({ timeout: 10_000 })

    // JSON 源码态：同一份数据回显（states 含 open）→ 切回画布
    await dlg.getByTestId('graph-mode').getByText('JSON 源码').click()
    const statesBox = dlg.getByPlaceholder(/"open","assigned"/)
    await expect(statesBox).toBeVisible()
    await expect(statesBox).toHaveValue(/"open"/)
    await dlg.getByTestId('graph-mode').getByText('画布').click()
    await expect(dlg.getByTestId('fg-canvas')).toBeVisible()

    // 添加状态 → 新节点无出入边 → 图检查角标翻告警（B2-4：告警不阻断——E-3 拍板）
    await dlg.getByTestId('fg-add-state').click()
    await expect(dlg.getByTestId('fg-lint-badge')).toBeVisible({ timeout: 10_000 })
    await expect(dlg.getByTestId('fg-lint-ok')).toHaveCount(0)
    await expect(dlg.getByRole('button', { name: '保存' })).toBeEnabled() // 不阻断

    await dlg.getByRole('button', { name: '取消' }).click()
    await expect(dlg).not.toBeVisible({ timeout: 10_000 })
  } finally {
    await api('/api/v1/ticket-types/delete', { ...h, method: 'POST', body: { code } }).catch(() => {})
  }
})
