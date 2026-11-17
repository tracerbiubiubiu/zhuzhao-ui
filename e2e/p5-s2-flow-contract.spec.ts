import { test, expect } from '@playwright/test'
import { api, apiLogin, loadState, mustData, tempTicketType, waitUserRateBudget } from './helpers'
import { uiLogin } from './ui'

test('CF12：画布删除保留态与JSON缺失明确阻保存，自定义态可保存', async ({ page }) => {
  const state = loadState()
  const login = await apiLogin(state.admin.employeeNo, state.admin.password, 'cf12-flow')
  const h = { token: login.env!.data.access_token }
  const tt = await tempTicketType(h, 'e2e_cf12')
  try {
    await waitUserRateBudget()
    await uiLogin(page, state.admin.employeeNo, state.admin.password)
    await page.waitForURL(/#\/home/)
    await page.goto('/#/tickets/types')
    await page.getByPlaceholder('按名称/编码过滤').fill(tt.code)
    const row = page.locator('tr').filter({ hasText: tt.code })
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    const dialog = page.locator('.el-dialog:visible').filter({ hasText: '编辑类型' })
    let writes = 0
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/ticket-types/update' && request.method() === 'POST') writes++ })
    await dialog.getByTestId('fg-canvas').getByText('assigned', { exact: true }).click()
    await dialog.getByTestId('fg-delete-selected').click()
    await expect(dialog.getByTestId('fg-errors')).toContainText('states 必须保留内置状态 "assigned"')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).toBeVisible()
    expect(writes).toBe(0)
    await dialog.getByRole('button', { name: '取消', exact: true }).click()
    await row.getByRole('button', { name: '编辑', exact: true }).click()
    await dialog.getByTestId('graph-mode').getByText('JSON 源码').click()
    const states = dialog.getByPlaceholder(/"open","assigned"/)
    const transitions = dialog.getByPlaceholder(/\{"open":\["assigned","closed"\]/)
    for (const missing of ['open', 'assigned', 'closed']) {
      await states.fill(JSON.stringify(['open', 'assigned', 'closed'].filter((name) => name !== missing)))
      await transitions.fill('{}')
      await dialog.getByRole('button', { name: '保存', exact: true }).click()
      await expect(dialog).toContainText(`states 必须保留内置状态 "${missing}"`)
      expect(writes).toBe(0)
    }
    const customStates = ['open', 'assigned', 'closed', 'security_review']
    const customTransitions = { open: ['assigned', 'security_review'], assigned: ['closed'], security_review: ['closed'], closed: ['open'] }
    await states.fill(JSON.stringify(customStates))
    await transitions.fill(JSON.stringify(customTransitions))
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(writes).toBe(1)
    const { types } = await mustData(api<{ types: Array<{ code: string; states: string[]; transitions: unknown }> }>('/api/v1/ticket-types', h), 'types readback')
    expect(Array.isArray(types)).toBe(true)
    const saved = types.find((item) => item.code === tt.code)
    expect(saved).toBeDefined()
    expect(saved?.states).toEqual(customStates)
    expect(saved?.transitions).toEqual(customTransitions)
  } finally { await tt.cleanup() }
})
