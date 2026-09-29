/**
 * P4-3 字典冒烟：UI 建类型+项（一启用一停用）→消费端点只回启用项（业务表单选项语义）
 * →类型删除级联清理。幂等：code 带时间戳后缀，finally API 清理。
 */
import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState } from './helpers'
import { uiLogin } from './ui'

test.setTimeout(90_000)

test('P4-3 字典：类型/项 CRUD+消费端点启用过滤', async ({ page }) => {
  const state = loadState()
  const suffix = Date.now().toString(36)
  const typeCode = `e2e_dict_${suffix}`
  const admin = await apiLogin(state.admin.employeeNo, state.admin.password, 'dict-setup')
  const h = { token: admin.env!.data.access_token } as const

  try {
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await expect(page.getByRole('menuitem', { name: '字典管理' })).toBeVisible({ timeout: 15_000 })

    // ── UI 建类型 ──
    await page.goto('/#/system/dict')
    await page.getByRole('button', { name: '新建类型' }).click()
    const dlg = page.locator('.el-dialog')
    await dlg.locator('input').nth(0).fill(typeCode)
    await dlg.locator('input').nth(1).fill('E2E 字典类型')
    await page.locator('.el-dialog').getByRole('button', { name: '创建' }).click()
    await expect(page.locator('.el-dialog:visible')).toHaveCount(0, { timeout: 10_000 })
    await expect(page.locator('.el-table__row').filter({ hasText: typeCode }).first()).toBeVisible()

    // ── UI 建两项（prod 启用 / stg 停用）──
    const rightCard = page.locator('.el-card').filter({ hasText: `字典项（${typeCode}）` })
    for (const [code, label, disabled] of [['prod', '生产', false], ['stg', '预发', true]] as const) {
      await rightCard.getByRole('button', { name: '新增项' }).click()
      await page.locator('.el-dialog:visible').locator('input').nth(0).fill(code)
      await page.locator('.el-dialog:visible').locator('input').nth(1).fill(label)
      if (disabled) {
        // 建时即停用：创建后行内关开关（创建表单无停用开关——最小形态：建后 toggle）
        await page.locator('.el-dialog').getByRole('button', { name: '创建' }).click()
        await expect(page.locator('.el-dialog:visible')).toHaveCount(0, { timeout: 10_000 })
        const row = rightCard.locator('.el-table__row').filter({ hasText: code })
        await expect(row).toBeVisible()
        await row.locator('.el-switch').click()
        await expect(row.getByText('已停用')).toBeVisible({ timeout: 10_000 })
      } else {
        await page.locator('.el-dialog').getByRole('button', { name: '创建' }).click()
        await expect(page.locator('.el-dialog:visible')).toHaveCount(0, { timeout: 10_000 })
        await expect(rightCard.locator('.el-table__row').filter({ hasText: code })).toBeVisible()
      }
    }

    // ── 消费端点：只回启用项（prod）——业务表单选项语义 ──
    const items = await api(`/api/v1/dicts/${typeCode}/items`, { ...h, method: 'GET' })
    expect(items.env!.code).toBe(0)
    const data = items.env!.data as { items: Array<{ code: string }> }
    expect(data.items.map((i) => i.code)).toEqual(['prod'])
  } finally {
    await api('/api/v1/dicts/delete', { ...h, method: 'POST', body: { code: typeCode } }).catch(() => {})
  }
})
